"""
Node Discovery & Topology WebSocket Server

Runs alongside the MPC cluster. Two roles:
  1. MPC nodes POST /announce on startup (HTTP on port 5880)
  2. Web clients connect via WebSocket ws://host:5880/ws for live topology

Protocol:
  - MPC node → POST /announce { party_id, port, hostname, status }
  - Web client ← WS message  { type: "topology", nodes: [...], epoch }
  - Stale nodes (no heartbeat in 30s) are pruned automatically
"""

import asyncio
import json
import time
import logging
from typing import Any

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] DISCOVERY - %(message)s')

# ── Node Registry ────────────────────────────────────────────────────────────

NODE_TTL = 30  # seconds before a node is considered stale

nodes: dict[str, dict[str, Any]] = {}
viewers: set[asyncio.StreamWriter] = set()
ws_viewers: list[Any] = []  # WebSocket connections

def node_key(party_id: int, port: int) -> str:
    return f"{party_id}:{port}"

def register_node(data: dict) -> None:
    key = node_key(data["party_id"], data["port"])
    is_new = key not in nodes
    nodes[key] = {
        "party_id": data["party_id"],
        "port": data["port"],
        "hostname": data.get("hostname", "127.0.0.1"),
        "status": data.get("status", "online"),
        "last_seen": time.time(),
        "joined_at": nodes[key]["joined_at"] if key in nodes else time.time(),
    }
    if is_new:
        logging.info(f"Node joined: party={data['party_id']} port={data['port']}")

def prune_stale() -> bool:
    """Remove stale nodes. Returns True if any were pruned."""
    now = time.time()
    stale = [k for k, v in nodes.items() if now - v["last_seen"] > NODE_TTL]
    for k in stale:
        logging.info(f"Pruning stale node: {k}")
        del nodes[k]
    return len(stale) > 0

def topology_message() -> str:
    """Build the topology JSON sent to web clients."""
    return json.dumps({
        "type": "topology",
        "nodes": [
            {
                "party_id": n["party_id"],
                "port": n["port"],
                "hostname": n["hostname"],
                "status": n["status"],
                "uptime": round(time.time() - n["joined_at"], 1),
            }
            for n in sorted(nodes.values(), key=lambda x: x["party_id"])
        ],
        "quorum_size": len(nodes),
        "threshold": 3,  # 3-of-5 Shamir threshold
        "epoch": int(time.time()),
    })

# ── WebSocket (RFC 6455 minimal implementation) ──────────────────────────────
# We implement bare-minimum WS framing to avoid external deps (no `websockets` package).

import struct
import hashlib
import base64

WS_MAGIC = b"258EAFA5-E914-47DA-95CA-5AB9DC85B11B"

def ws_accept_key(key: bytes) -> str:
    return base64.b64encode(hashlib.sha1(key + WS_MAGIC).digest()).decode()

def ws_encode_text(payload: str) -> bytes:
    data = payload.encode("utf-8")
    length = len(data)
    if length < 126:
        header = struct.pack("!BB", 0x81, length)
    elif length < 65536:
        header = struct.pack("!BBH", 0x81, 126, length)
    else:
        header = struct.pack("!BBQ", 0x81, 127, length)
    return header + data

async def ws_read_frame(reader: asyncio.StreamReader) -> bytes | None:
    """Read one WS frame. Returns payload bytes or None on close/error."""
    try:
        head = await reader.readexactly(2)
    except (asyncio.IncompleteReadError, ConnectionError):
        return None
    opcode = head[0] & 0x0F
    if opcode == 0x8:  # close
        return None
    masked = (head[1] & 0x80) != 0
    length = head[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if masked else b"\x00\x00\x00\x00"
    payload = bytearray(await reader.readexactly(length))
    if masked:
        for i in range(length):
            payload[i] ^= mask[i % 4]
    return bytes(payload)

# ── HTTP + WebSocket Hybrid Server ───────────────────────────────────────────

class DiscoveryServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 5880):
        self.host = host
        self.port = port
        self.ws_clients: list[tuple[asyncio.StreamReader, asyncio.StreamWriter]] = []

    async def handle_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Dispatch based on HTTP method: POST /announce or GET /ws (upgrade to WS)."""
        try:
            request_line = await asyncio.wait_for(reader.readline(), timeout=5.0)
            if not request_line:
                writer.close()
                return
            request = request_line.decode("utf-8", errors="replace").strip()
            # Read all headers
            headers: dict[str, str] = {}
            while True:
                line = await asyncio.wait_for(reader.readline(), timeout=5.0)
                decoded = line.decode("utf-8", errors="replace").strip()
                if not decoded:
                    break
                if ":" in decoded:
                    k, v = decoded.split(":", 1)
                    headers[k.strip().lower()] = v.strip()

            if request.startswith("POST /announce"):
                await self._handle_announce(reader, writer, headers)
            elif request.startswith("GET /ws") and "upgrade" in headers.get("connection", "").lower():
                await self._handle_ws_upgrade(reader, writer, headers)
            elif request.startswith("GET /health"):
                await self._send_http(writer, 200, json.dumps({"status": "ok", "nodes": len(nodes)}))
            elif request.startswith("GET /topology"):
                await self._send_http(writer, 200, topology_message())
            elif request.startswith("GET /resolve"):
                await self._handle_resolve(request, writer)
            else:
                await self._send_http(writer, 404, '{"error":"not found"}')
        except Exception as e:
            logging.error(f"Connection error: {e}")
            try:
                writer.close()
            except Exception:
                pass

    async def _handle_announce(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, headers: dict):
        """MPC node announces itself via HTTP POST."""
        content_length = int(headers.get("content-length", "0"))
        body = b""
        if content_length > 0:
            body = await asyncio.wait_for(reader.readexactly(content_length), timeout=5.0)
        try:
            data = json.loads(body.decode("utf-8"))
            if "party_id" not in data or "port" not in data:
                await self._send_http(writer, 400, '{"error":"party_id and port required"}')
                return
            register_node(data)
            await self._send_http(writer, 200, '{"status":"registered"}')
            # Broadcast updated topology to all WS clients
            await self._broadcast_topology()
        except json.JSONDecodeError:
            await self._send_http(writer, 400, '{"error":"invalid json"}')

    async def _handle_ws_upgrade(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, headers: dict):
        """Upgrade HTTP to WebSocket and stream topology."""
        ws_key = headers.get("sec-websocket-key", "")
        accept = ws_accept_key(ws_key.encode())
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "\r\n"
        )
        writer.write(response.encode())
        await writer.drain()

        self.ws_clients.append((reader, writer))
        logging.info(f"WebSocket viewer connected ({len(self.ws_clients)} total)")

        # Send current topology immediately
        try:
            writer.write(ws_encode_text(topology_message()))
            await writer.drain()
        except Exception:
            pass

        # Keep connection alive, read pings/messages
        try:
            while True:
                frame = await ws_read_frame(reader)
                if frame is None:
                    break
                # Client can send ping or messages; we just keep alive
        except Exception:
            pass
        finally:
            self.ws_clients = [(r, w) for r, w in self.ws_clients if w is not writer]
            logging.info(f"WebSocket viewer disconnected ({len(self.ws_clients)} remaining)")
            try:
                writer.close()
            except Exception:
                pass

    async def _handle_resolve(self, request: str, writer: asyncio.StreamWriter):
        """Resolve a party_id to its public hostname and port.
        GET /resolve?party=1 -> {"party_id":1,"hostname":"abc.freehold.lit.app","port":5871}
        Used by BOB to find ALICE's public address before connecting."""
        import urllib.parse
        try:
            # Parse query string from request line: "GET /resolve?party=1 HTTP/1.1"
            path = request.split(" ")[1]
            qs = urllib.parse.urlparse(path).query
            params = urllib.parse.parse_qs(qs)
            party_id = int(params.get("party", [0])[0])

            # Find node with matching party_id
            for n in nodes.values():
                if n["party_id"] == party_id and n["status"] == "online":
                    result = json.dumps({
                        "party_id": n["party_id"],
                        "hostname": n["hostname"],
                        "port": n["port"],
                    })
                    await self._send_http(writer, 200, result)
                    return

            await self._send_http(writer, 404, json.dumps({"error": f"party {party_id} not found"}))
        except Exception as e:
            await self._send_http(writer, 400, json.dumps({"error": str(e)}))

    async def _broadcast_topology(self):
        """Send current topology to all connected WS viewers."""
        msg = ws_encode_text(topology_message())
        dead: list[tuple] = []
        for r, w in self.ws_clients:
            try:
                w.write(msg)
                await w.drain()
            except Exception:
                dead.append((r, w))
        for d in dead:
            self.ws_clients.remove(d)

    async def _send_http(self, writer: asyncio.StreamWriter, status: int, body: str):
        status_text = {200: "OK", 400: "Bad Request", 404: "Not Found"}.get(status, "OK")
        response = (
            f"HTTP/1.1 {status} {status_text}\r\n"
            "Content-Type: application/json\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
            "Access-Control-Allow-Headers: Content-Type\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: close\r\n"
            "\r\n"
            f"{body}"
        )
        writer.write(response.encode())
        await writer.drain()
        writer.close()

    async def _prune_loop(self):
        """Periodically prune stale nodes and broadcast if topology changed."""
        while True:
            await asyncio.sleep(10)
            if prune_stale():
                await self._broadcast_topology()

    async def serve(self):
        server = await asyncio.start_server(
            self.handle_connection, self.host, self.port
        )
        logging.info(f"Discovery server listening on {self.host}:{self.port}")
        logging.info(f"  MPC nodes:   POST http://{self.host}:{self.port}/announce")
        logging.info(f"  Web clients: ws://{self.host}:{self.port}/ws")
        logging.info(f"  Health:      GET  http://{self.host}:{self.port}/health")

        asyncio.create_task(self._prune_loop())
        async with server:
            await server.serve_forever()


if __name__ == "__main__":
    discovery = DiscoveryServer()
    asyncio.run(discovery.serve())

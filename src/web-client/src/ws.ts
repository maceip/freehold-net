/**
 * ws.ts — Shared WebSocket singleton for MPC topology updates.
 *
 * Both NetworkViz and MpcTerminal subscribe here instead of owning
 * separate connections.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuorumNode {
  party_id: number;
  port: number;
  hostname: string;
  status: string;
  uptime: number;
  shard_id?: string;
  dns?: string;
  relay_registered?: boolean;
  relay_fqdn?: string;
}

export interface TopologyMessage {
  type: 'topology';
  nodes: QuorumNode[];
  quorum_size: number;
  threshold: number;
  epoch: number;
}

// ── Singleton state ──────────────────────────────────────────────────────────

const WS_URL = `ws://${window.location.host}/ws`;
const RECONNECT_INTERVAL = 3000;

type TopologyCallback = (msg: TopologyMessage) => void;
type MessageCallback = (data: any) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const topologyListeners: Set<TopologyCallback> = new Set();
const messageListeners: Set<MessageCallback> = new Set();

let connected = false;

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      messageListeners.forEach(fn => fn(data));
      if (data.type === 'topology') {
        topologyListeners.forEach(fn => fn(data as TopologyMessage));
      }
    } catch (e) {
      console.warn('[ws] Bad message:', e);
    }
  };

  ws.onclose = () => {
    connected = false;
    scheduleReconnect();
  };

  ws.onerror = () => {
    connected = false;
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_INTERVAL);
}

// Auto-connect on first import
connect();

// ── Public API ───────────────────────────────────────────────────────────────

export const sharedWS = {
  onTopology(fn: TopologyCallback) {
    topologyListeners.add(fn);
    return () => { topologyListeners.delete(fn); };
  },

  onMessage(fn: MessageCallback) {
    messageListeners.add(fn);
    return () => { messageListeners.delete(fn); };
  },

  send(data: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  },

  get connected() {
    return connected;
  },
};

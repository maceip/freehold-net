/**
 * NetworkViz — Live MPC Quorum Topology Visualization
 *
 * Connects to the discovery server via WebSocket to show real nodes.
 * Flow:  [User Avatar] → [WebSocket] → [MPC Quorum nodes] → [Email Provider]
 *
 * NO MOCKS — only renders nodes that are actually online.
 */

import * as THREE from 'three';

// ── Types ───────────────────────────────────────────────────────────────────

interface QuorumNode {
  party_id: number;
  port: number;
  hostname: string;
  status: string;
  uptime: number;
}

interface TopologyMessage {
  type: 'topology';
  nodes: QuorumNode[];
  quorum_size: number;
  threshold: number;
  epoch: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

// In dev, Vite proxies /ws → ws://127.0.0.1:5880/ws
// In prod, the discovery server is colocated or reverse-proxied to /ws
const WS_URL = `ws://${window.location.host}/ws`;
const RECONNECT_INTERVAL = 3000;

// Layout X positions for the 4 columns of the flow
const COL_USER = -8;
const COL_WS   = -3.5;
const COL_MPC  = 1.5;
const COL_EMAIL = 7;

// Colors
const CLR_USER     = 0x4fc3f7;  // cyan
const CLR_WS       = 0xffb74d;  // amber
const CLR_MPC_ON   = 0x66bb6a;  // green (online)
const CLR_MPC_OFF  = 0x616161;  // gray (offline/stale)
const CLR_EMAIL    = 0xef5350;  // red (Gmail)
const CLR_LINE     = 0x444444;
const CLR_LINE_ACT = 0x66bb6a;

// ── Gmail "M" shape geometry ────────────────────────────────────────────────

function createGmailMesh(): THREE.Group {
  const group = new THREE.Group();

  // Envelope body
  const envGeo = new THREE.BoxGeometry(1.6, 1.1, 0.15);
  const envMat = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x222222 });
  const env = new THREE.Mesh(envGeo, envMat);
  group.add(env);

  // Red "M" — left stroke, right stroke, center
  const barGeo = new THREE.BoxGeometry(0.12, 0.9, 0.2);
  const barMat = new THREE.MeshPhongMaterial({ color: CLR_EMAIL, emissive: 0xaa0000 });

  const left = new THREE.Mesh(barGeo, barMat);
  left.position.set(-0.55, 0, 0.05);
  group.add(left);

  const right = new THREE.Mesh(barGeo, barMat);
  right.position.set(0.55, 0, 0.05);
  group.add(right);

  // Diagonal strokes of M
  const diagGeo = new THREE.BoxGeometry(0.12, 0.7, 0.2);
  const diagL = new THREE.Mesh(diagGeo, barMat);
  diagL.position.set(-0.28, 0.05, 0.05);
  diagL.rotation.z = -0.45;
  group.add(diagL);

  const diagR = new THREE.Mesh(diagGeo, barMat);
  diagR.position.set(0.28, 0.05, 0.05);
  diagR.rotation.z = 0.45;
  group.add(diagR);

  return group;
}

// ── User avatar mesh ────────────────────────────────────────────────────────

function createUserAvatar(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: CLR_USER, emissive: 0x0077aa, shininess: 80 });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), mat);
  head.position.y = 0.7;
  group.add(head);

  // Body (capsule approximated with cylinder + spheres)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.9, 12), mat);
  body.position.y = -0.15;
  group.add(body);

  return group;
}

// ── WebSocket icon mesh ─────────────────────────────────────────────────────

function createWSIcon(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: CLR_WS, emissive: 0x996600, shininess: 60 });

  // Two interlocking arrows (simplified as offset boxes)
  const arrowGeo = new THREE.BoxGeometry(1.0, 0.15, 0.15);
  const top = new THREE.Mesh(arrowGeo, mat);
  top.position.y = 0.2;
  top.rotation.z = 0.15;
  group.add(top);

  const bot = new THREE.Mesh(arrowGeo, mat);
  bot.position.y = -0.2;
  bot.rotation.z = -0.15;
  group.add(bot);

  // Ring around them
  const ringGeo = new THREE.TorusGeometry(0.6, 0.06, 8, 24);
  const ringMat = new THREE.MeshPhongMaterial({ color: CLR_WS, emissive: 0x664400, transparent: true, opacity: 0.6 });
  group.add(new THREE.Mesh(ringGeo, ringMat));

  return group;
}

// ── MPC node sphere ─────────────────────────────────────────────────────────

function createMPCNode(online: boolean): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.35, 24, 24);
  const color = online ? CLR_MPC_ON : CLR_MPC_OFF;
  const mat = new THREE.MeshPhongMaterial({
    color,
    emissive: online ? 0x2e7d32 : 0x333333,
    shininess: 100,
    transparent: !online,
    opacity: online ? 1.0 : 0.4,
  });
  return new THREE.Mesh(geo, mat);
}

// ── Flow line ───────────────────────────────────────────────────────────────

function createFlowLine(from: THREE.Vector3, to: THREE.Vector3, active: boolean): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({
    color: active ? CLR_LINE_ACT : CLR_LINE,
    transparent: true,
    opacity: active ? 0.6 : 0.2,
  });
  return new THREE.Line(geo, mat);
}

// ── Label sprite ────────────────────────────────────────────────────────────

function createLabel(text: string, color: string = '#ffffff'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.5, 0.6, 1);
  return sprite;
}

// ── Status indicator ────────────────────────────────────────────────────────

function createStatusText(connected: boolean, nodeCount: number, threshold: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  const msg = connected
    ? `${nodeCount} node${nodeCount !== 1 ? 's' : ''} online — ${nodeCount >= threshold ? 'QUORUM MET' : `need ${threshold - nodeCount} more`}`
    : 'connecting to discovery...';
  ctx.fillStyle = connected ? (nodeCount >= threshold ? '#66bb6a' : '#ffb74d') : '#999';
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, 256, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6, 0.7, 1);
  return sprite;
}

// ── Main ────────────────────────────────────────────────────────────────────

export function initNetworkViz(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Prevent double-init
  if (container.querySelector('canvas')) return;

  // Scene setup
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 0, 16);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const point = new THREE.PointLight(0xffffff, 1);
  point.position.set(5, 8, 10);
  scene.add(point);

  // Static elements (always visible)
  const userAvatar = createUserAvatar();
  userAvatar.position.set(COL_USER, 0, 0);
  scene.add(userAvatar);

  const userLabel = createLabel('You');
  userLabel.position.set(COL_USER, -1.5, 0);
  scene.add(userLabel);

  const wsIcon = createWSIcon();
  wsIcon.position.set(COL_WS, 0, 0);
  scene.add(wsIcon);

  const wsLabel = createLabel('WebSocket');
  wsLabel.position.set(COL_WS, -1.5, 0);
  scene.add(wsLabel);

  const gmail = createGmailMesh();
  gmail.position.set(COL_EMAIL, 0, 0);
  scene.add(gmail);

  const emailLabel = createLabel('Gmail SMTP');
  emailLabel.position.set(COL_EMAIL, -1.5, 0);
  scene.add(emailLabel);

  // Static flow line: User → WS
  scene.add(createFlowLine(
    new THREE.Vector3(COL_USER + 0.6, 0, 0),
    new THREE.Vector3(COL_WS - 0.8, 0, 0),
    true
  ));

  // Dynamic state
  const mpcGroup = new THREE.Group();
  scene.add(mpcGroup);

  let statusSprite: THREE.Sprite | null = null;

  // State
  let currentNodes: QuorumNode[] = [];
  let wsConnected = false;
  let threshold = 3;

  function rebuildTopology() {
    // Clear MPC group
    while (mpcGroup.children.length) {
      const child = mpcGroup.children[0];
      mpcGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    // Remove old status
    if (statusSprite) {
      scene.remove(statusSprite);
      statusSprite = null;
    }

    const onlineNodes = currentNodes.filter(n => n.status === 'online');
    const quorumMet = onlineNodes.length >= threshold;

    // Place MPC nodes
    const count = Math.max(onlineNodes.length, 1);
    const ySpread = Math.min(count - 1, 4) * 1.2;

    onlineNodes.forEach((node, i) => {
      const y = count === 1 ? 0 : -ySpread / 2 + (i / (count - 1)) * ySpread;
      const sphere = createMPCNode(true);
      sphere.position.set(COL_MPC, y, 0);
      mpcGroup.add(sphere);

      // Party label
      const label = createLabel(`P${node.party_id}:${node.port}`, '#66bb6a');
      label.position.set(COL_MPC, y - 0.6, 0);
      label.scale.set(2.0, 0.5, 1);
      mpcGroup.add(label);

      // Line WS → this node
      mpcGroup.add(createFlowLine(
        new THREE.Vector3(COL_WS + 0.8, 0, 0),
        new THREE.Vector3(COL_MPC - 0.5, y, 0),
        true
      ));

      // Line this node → Email
      mpcGroup.add(createFlowLine(
        new THREE.Vector3(COL_MPC + 0.5, y, 0),
        new THREE.Vector3(COL_EMAIL - 1.0, 0, 0),
        quorumMet
      ));

      // Inter-node mesh lines (quorum connectivity)
      for (let j = 0; j < i; j++) {
        const yj = count === 1 ? 0 : -ySpread / 2 + (j / (count - 1)) * ySpread;
        mpcGroup.add(createFlowLine(
          new THREE.Vector3(COL_MPC + 0.1, y, 0.3),
          new THREE.Vector3(COL_MPC + 0.1, yj, 0.3),
          quorumMet
        ));
      }
    });

    // If no nodes, show placeholder
    if (onlineNodes.length === 0) {
      const empty = createMPCNode(false);
      empty.position.set(COL_MPC, 0, 0);
      mpcGroup.add(empty);

      const label = createLabel('no nodes', '#666666');
      label.position.set(COL_MPC, -0.8, 0);
      label.scale.set(2.0, 0.5, 1);
      mpcGroup.add(label);

      // Dim lines
      mpcGroup.add(createFlowLine(
        new THREE.Vector3(COL_WS + 0.8, 0, 0),
        new THREE.Vector3(COL_MPC - 0.5, 0, 0),
        false
      ));
      mpcGroup.add(createFlowLine(
        new THREE.Vector3(COL_MPC + 0.5, 0, 0),
        new THREE.Vector3(COL_EMAIL - 1.0, 0, 0),
        false
      ));
    }

    // Status bar
    statusSprite = createStatusText(wsConnected, onlineNodes.length, threshold);
    statusSprite.position.set(0, -3.5, 0);
    scene.add(statusSprite);
  }

  // Initial render (empty)
  rebuildTopology();

  // ── WebSocket connection to discovery server ──────────────────────────────

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connectWS() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      wsConnected = true;
      console.log('[NetworkViz] Connected to discovery server');
      rebuildTopology();
    };

    ws.onmessage = (event) => {
      try {
        const msg: TopologyMessage = JSON.parse(event.data);
        if (msg.type === 'topology') {
          currentNodes = msg.nodes;
          threshold = msg.threshold;
          rebuildTopology();
        }
      } catch (e) {
        console.warn('[NetworkViz] Bad message:', e);
      }
    };

    ws.onclose = () => {
      wsConnected = false;
      console.log('[NetworkViz] Disconnected from discovery server');
      rebuildTopology();
      scheduleReconnect();
    };

    ws.onerror = () => {
      wsConnected = false;
      ws?.close();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWS();
    }, RECONNECT_INTERVAL);
  }

  connectWS();

  // ── Animation loop ────────────────────────────────────────────────────────

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // Gentle breathing on user avatar
    userAvatar.position.y = Math.sin(t * 1.5) * 0.1;

    // WS icon rotation
    wsIcon.rotation.z = Math.sin(t * 2) * 0.15;

    // Gmail subtle bob
    gmail.position.y = Math.sin(t * 1.2 + 1) * 0.08;

    // Pulse MPC nodes
    mpcGroup.children.forEach((child, i) => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.SphereGeometry) {
        child.scale.setScalar(1 + Math.sin(t * 3 + i * 0.7) * 0.08);
      }
    });

    renderer.render(scene, camera);
  }

  animate();

  // ── Resize ────────────────────────────────────────────────────────────────

  const resizeObs = new ResizeObserver(() => {
    if (!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
  resizeObs.observe(container);
}

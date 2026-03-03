/**
 * MpcTerminal — Persistent MPC debug terminal with REPL console + 3D node viz.
 *
 * On the landing page it sits left-aligned (48vw). When a view opens it
 * animates with a magnetic-attract effect then splits the screen side-by-side.
 */

import * as THREE from 'three';
import { sharedWS, type QuorumNode, type TopologyMessage } from './ws';

// ── Glass Node Shader (reused from NetworkViz) ──────────────────────────────

const glassVert = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mv.xyz;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const glassFrag = `
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;
  void main() {
    vec3 vd = normalize(vViewPosition);
    vec3 n = normalize(vNormal);
    float fresnel = pow(1.0 - abs(dot(vd, n)), 2.5);
    vec3 c = uColor * 0.4 + uEmissive * fresnel * 1.5 + uEmissive * uPulse * 0.3;
    vec3 ld = normalize(vec3(5.0, 8.0, 10.0) - vWorldPosition);
    vec3 hd = normalize(vd + ld);
    c += vec3(1.0) * pow(max(dot(n, hd), 0.0), 64.0) * 0.4;
    gl_FragColor = vec4(c, 0.6 + fresnel * 0.4);
  }
`;

const flowVert = `
  varying float vLP;
  attribute float lineProgress;
  void main() { vLP = lineProgress; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const flowFrag = `
  uniform float uTime;
  uniform float uActive;
  uniform vec3 uColor;
  varying float vLP;
  void main() {
    float pulse = pow(sin((vLP - uTime * 2.0) * 6.283) * 0.5 + 0.5, 4.0) * uActive;
    vec3 base = uColor * (0.15 + uActive * 0.3);
    vec3 pc = uColor * pulse * 1.5;
    gl_FragColor = vec4(base + pc, (0.2 + uActive * 0.3) + pulse * 0.5);
  }
`;

const floorVert = `
  varying vec2 vUv; varying vec3 vWP;
  void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;

const floorFrag = `
  uniform sampler2D uReflectionMap; uniform float uTime; uniform float uOpacity;
  varying vec2 vUv; varying vec3 vWP;
  void main() {
    float d = length(vWP.xz);
    float sf = 1.0 - smoothstep(2.0, 8.0, d);
    float ff = exp(-0.02 * d * d);
    float grain = fract(sin(dot(vUv * 100.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453) * 0.02;
    vec4 r = texture2D(uReflectionMap, vUv);
    gl_FragColor = vec4(max(r.rgb * 0.5 * sf - grain, 0.0), uOpacity * ff * sf);
  }
`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface TerminalController {
  toggle(): void;
  enterSplitMode(): void;
  exitSplitMode(): void;
  isOpen(): boolean;
}

// ── Console line colors ──────────────────────────────────────────────────────

const LEVEL_CLASS: Record<string, string> = {
  log: 'term-line-log',
  info: 'term-line-info',
  warn: 'term-line-warn',
  error: 'term-line-error',
};

// ── Main init ────────────────────────────────────────────────────────────────

export function initMpcTerminal(_getViewId: () => string): TerminalController {
  // ── Build DOM ────────────────────────────────────────────────────────
  const el = document.createElement('div');
  el.id = 'mpc-terminal';
  el.className = 'term--landing term--hidden';
  el.innerHTML = `
    <div class="term-header">
      <span class="term-header-dot" style="background:#ff5f56"></span>
      <span class="term-header-dot" style="background:#ffbd2e"></span>
      <span class="term-header-dot" style="background:#27c93f"></span>
      <span class="term-header-title">MPC Debug Console</span>
      <span class="term-header-close">&times;</span>
    </div>
    <div class="term-body">
      <div class="term-repl-zone">
        <div class="term-log"></div>
        <div class="term-input-row">
          <span class="term-prompt">&gt;</span>
          <input class="term-input" type="text" spellcheck="false" autocomplete="off" placeholder="type help..." />
        </div>
      </div>
      <div class="term-viz-zone"></div>
    </div>
  `;
  document.body.appendChild(el);

  const logEl = el.querySelector('.term-log') as HTMLDivElement;
  const inputEl = el.querySelector('.term-input') as HTMLInputElement;
  const vizZone = el.querySelector('.term-viz-zone') as HTMLDivElement;
  const closeBtn = el.querySelector('.term-header-close') as HTMLSpanElement;

  let open = false;

  // ── Console interception ───────────────────────────────────────────
  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  function appendLine(level: string, args: any[]) {
    const line = document.createElement('div');
    line.className = `term-line ${LEVEL_CLASS[level] || 'term-line-log'}`;
    line.textContent = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    logEl.appendChild(line);
    // Keep max 500 lines
    while (logEl.children.length > 500) logEl.removeChild(logEl.firstChild!);
    logEl.scrollTop = logEl.scrollHeight;
  }

  console.log = (...args: any[]) => { origLog(...args); appendLine('log', args); };
  console.info = (...args: any[]) => { origInfo(...args); appendLine('info', args); };
  console.warn = (...args: any[]) => { origWarn(...args); appendLine('warn', args); };
  console.error = (...args: any[]) => { origError(...args); appendLine('error', args); };

  // ── Topology state ─────────────────────────────────────────────────
  let currentNodes: QuorumNode[] = [];
  let currentEpoch = 0;
  let currentThreshold = 3;

  sharedWS.onTopology((msg: TopologyMessage) => {
    currentNodes = msg.nodes;
    currentEpoch = msg.epoch;
    currentThreshold = msg.threshold;
    rebuildVizNodes();
  });

  // ── Command input ──────────────────────────────────────────────────
  inputEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const cmd = inputEl.value.trim();
    inputEl.value = '';
    if (!cmd) return;
    appendLine('log', [`> ${cmd}`]);
    processCommand(cmd);
  });

  function processCommand(cmd: string) {
    const lower = cmd.toLowerCase();
    if (lower === 'help') {
      appendLine('info', ['Available commands:']);
      appendLine('info', ['  help    — show this message']);
      appendLine('info', ['  clear   — clear log']);
      appendLine('info', ['  status  — connection status']);
      appendLine('info', ['  nodes   — list MPC nodes']);
      appendLine('info', ['  epoch   — current epoch']);
      appendLine('info', ['  mpc:*   — forward to MPC cluster']);
    } else if (lower === 'clear') {
      logEl.innerHTML = '';
    } else if (lower === 'status') {
      appendLine('info', [`WebSocket: ${sharedWS.connected ? 'CONNECTED' : 'DISCONNECTED'}`]);
      appendLine('info', [`Nodes online: ${currentNodes.filter(n => n.status === 'online').length}/${currentNodes.length}`]);
      appendLine('info', [`Threshold: ${currentThreshold}`]);
    } else if (lower === 'nodes') {
      if (currentNodes.length === 0) {
        appendLine('warn', ['No nodes in topology']);
      } else {
        currentNodes.forEach(n => {
          const shard = n.shard_id ? ` shard:0x${n.shard_id}` : '';
          const dns = n.dns ? ` dns:${n.dns}` : '';
          appendLine('info', [`  P${n.party_id} [${n.status}] :${n.port}${shard}${dns} uptime:${n.uptime}s`]);
        });
      }
    } else if (lower === 'epoch') {
      appendLine('info', [`Current epoch: ${currentEpoch}`]);
    } else if (lower.startsWith('mpc:')) {
      sharedWS.send({ type: 'command', payload: cmd.slice(4) });
      appendLine('log', ['Sent to MPC cluster']);
    } else {
      appendLine('warn', [`Unknown command: ${cmd}. Type "help" for commands.`]);
    }
  }

  // ── 3D Viz setup ───────────────────────────────────────────────────
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
  camera.position.set(0, 2, 8);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  vizZone.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const pt = new THREE.PointLight(0xffffff, 0.8);
  pt.position.set(4, 6, 8);
  scene.add(pt);

  // Reflection floor (smaller RT for perf)
  const FLOOR_Y = -1.8;
  const reflRT = new THREE.WebGLRenderTarget(256, 256, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const virtCam = new THREE.PerspectiveCamera();

  const floorMat = new THREE.ShaderMaterial({
    vertexShader: floorVert,
    fragmentShader: floorFrag,
    uniforms: {
      uReflectionMap: { value: reflRT.texture },
      uTime: { value: 0 },
      uOpacity: { value: 0.3 },
    },
    transparent: true, depthWrite: false,
  });
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = FLOOR_Y;
  scene.add(floorMesh);

  const floorBase = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({ color: 0x050510 }),
  );
  floorBase.rotation.x = -Math.PI / 2;
  floorBase.position.y = FLOOR_Y - 0.01;
  scene.add(floorBase);

  // Node group
  const nodeGroup = new THREE.Group();
  scene.add(nodeGroup);

  function makeLabel(text: string, color: string): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 24);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85 });
    const s = new THREE.Sprite(mat);
    s.scale.set(2.0, 0.4, 1);
    return s;
  }

  function makeFlowLine(from: THREE.Vector3, to: THREE.Vector3, active: boolean): THREE.Line {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    geo.setAttribute('lineProgress', new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
    const clr = active ? new THREE.Color(0x66bb6a) : new THREE.Color(0x444444);
    const mat = new THREE.ShaderMaterial({
      vertexShader: flowVert, fragmentShader: flowFrag,
      uniforms: { uTime: { value: 0 }, uActive: { value: active ? 1 : 0 }, uColor: { value: clr } },
      transparent: true, depthWrite: false,
      blending: active ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    return new THREE.Line(geo, mat);
  }

  function rebuildVizNodes() {
    while (nodeGroup.children.length) {
      const c = nodeGroup.children[0];
      nodeGroup.remove(c);
      if (c instanceof THREE.Mesh) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
    }

    const online = currentNodes.filter(n => n.status === 'online');
    const count = online.length || 1;
    const radius = Math.min(count * 0.5, 3);

    online.forEach((node, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 24, 24),
        new THREE.ShaderMaterial({
          vertexShader: glassVert, fragmentShader: glassFrag,
          uniforms: {
            uColor: { value: new THREE.Color(0x66bb6a) },
            uEmissive: { value: new THREE.Color(0x2e7d32) },
            uTime: { value: 0 }, uPulse: { value: 0 },
          },
          transparent: true, depthWrite: false,
        }),
      );
      sphere.position.set(x, 0, z);
      nodeGroup.add(sphere);

      // Shard label
      const shardText = node.shard_id ? `shard: 0x${node.shard_id}` : `P${node.party_id}`;
      const shardLabel = makeLabel(shardText, '#66bb6a');
      shardLabel.position.set(x, -0.55, z);
      nodeGroup.add(shardLabel);

      // DNS label
      const dnsText = node.dns || node.hostname || `port:${node.port}`;
      const dnsLabel = makeLabel(dnsText, '#888888');
      dnsLabel.position.set(x, -0.85, z);
      dnsLabel.scale.set(1.8, 0.35, 1);
      nodeGroup.add(dnsLabel);

      // Inter-node flow lines
      for (let j = 0; j < i; j++) {
        const aJ = (j / count) * Math.PI * 2 - Math.PI / 2;
        const xj = Math.cos(aJ) * radius;
        const zj = Math.sin(aJ) * radius;
        nodeGroup.add(makeFlowLine(
          new THREE.Vector3(x, 0, z),
          new THREE.Vector3(xj, 0, zj),
          true,
        ));
      }
    });

    if (online.length === 0) {
      const label = makeLabel('no nodes', '#666666');
      label.position.set(0, 0, 0);
      nodeGroup.add(label);
    }
  }

  rebuildVizNodes();

  // ── Animation loop ─────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let animRunning = false;

  function animate() {
    if (!animRunning) return;
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    nodeGroup.rotation.y = t * 0.15;

    // Update shader uniforms
    for (const child of nodeGroup.children) {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial) {
        const u = child.material.uniforms;
        if (u.uTime) u.uTime.value = t;
        if (u.uPulse) u.uPulse.value = Math.sin(t * 3) * 0.5 + 0.5;
      }
      if (child instanceof THREE.Line && child.material instanceof THREE.ShaderMaterial) {
        child.material.uniforms.uTime.value = t;
      }
    }

    floorMat.uniforms.uTime.value = t;

    // Reflection pass
    virtCam.copy(camera);
    const rm = new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 2 * FLOOR_Y, 0, 0, 1, 0, 0, 0, 0, 1);
    virtCam.matrixWorld.copy(camera.matrixWorld).premultiply(rm);
    virtCam.matrixWorld.decompose(virtCam.position, virtCam.quaternion, virtCam.scale);
    virtCam.projectionMatrix.copy(camera.projectionMatrix);
    virtCam.updateMatrixWorld(true);

    floorMesh.visible = false;
    floorBase.visible = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(reflRT);
    renderer.clear();
    renderer.render(scene, virtCam);
    renderer.setRenderTarget(prev);
    floorMesh.visible = true;
    floorBase.visible = true;

    renderer.render(scene, camera);
  }

  function startAnim() {
    if (animRunning) return;
    animRunning = true;
    clock.start();
    animate();
  }

  function stopAnim() {
    animRunning = false;
  }

  // ResizeObserver for responsive canvas
  const resizeObs = new ResizeObserver(() => {
    const w = vizZone.clientWidth;
    const h = vizZone.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObs.observe(vizZone);

  // ── Close button ───────────────────────────────────────────────────
  closeBtn.addEventListener('click', () => toggle());

  // ── Controller ─────────────────────────────────────────────────────
  function toggle() {
    open = !open;
    if (open) {
      el.classList.remove('term--hidden');
      startAnim();
      // Trigger reflow for transition
      void el.offsetHeight;
      resizeObs.observe(vizZone);
    } else {
      el.classList.add('term--hidden');
      stopAnim();
    }
  }

  function enterSplitMode() {
    if (!open) return;
    el.classList.add('term--attracting');
    setTimeout(() => {
      el.classList.remove('term--attracting', 'term--landing');
      el.classList.add('term--split');
      // Push sections right
      document.querySelectorAll('section:not(#discover-view)').forEach(s => {
        s.classList.add('term-displaced');
      });
    }, 600);
  }

  function exitSplitMode() {
    el.classList.remove('term--split');
    el.classList.add('term--landing');
    document.querySelectorAll('section').forEach(s => {
      s.classList.remove('term-displaced');
    });
  }

  return {
    toggle,
    enterSplitMode,
    exitSplitMode,
    isOpen: () => open,
  };
}

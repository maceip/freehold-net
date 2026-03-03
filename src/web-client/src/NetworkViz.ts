/**
 * NetworkViz — Live MPC Quorum Topology Visualization
 *
 * Upgraded from flat MeshPhongMaterial to Aircord-grade rendering:
 *   - Glass-like ShaderMaterial on MPC nodes (fresnel + specular glow)
 *   - Reflective floor plane with mirrored scene (virtual camera)
 *   - Animated fade-in for labels
 *   - Pulsing flow lines with traveling glow
 *   - Exponential fog at scene edges
 *
 * NO MOCKS — only renders nodes that are actually online.
 */

import * as THREE from 'three';
import { sharedWS, type QuorumNode, type TopologyMessage } from './ws';

// ── Constants ───────────────────────────────────────────────────────────────

const COL_USER = -8;
const COL_WS   = -3.5;
const COL_MPC  = 1.5;
const COL_EMAIL = 7;

const CLR_USER     = 0x4fc3f7;
const CLR_WS       = 0xffb74d;
const CLR_MPC_ON   = 0x66bb6a;
const CLR_MPC_OFF  = 0x616161;
const CLR_EMAIL    = 0xef5350;

// ── Glass Node Shader (Aircord: fresnel + specular glow) ────────────────────

const glassVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const glassFragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  uniform float uTime;
  uniform float uPulse;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 normal = normalize(vNormal);

    // Fresnel — edges glow brighter (glass rim light effect)
    float fresnel = 1.0 - abs(dot(viewDir, normal));
    fresnel = pow(fresnel, 2.5);

    // Base color with fresnel rim
    vec3 color = uColor * 0.4 + uEmissive * fresnel * 1.5;

    // Pulse glow (breathing animation from uniform)
    color += uEmissive * uPulse * 0.3;

    // Subtle specular highlight
    vec3 lightDir = normalize(vec3(5.0, 8.0, 10.0) - vWorldPosition);
    vec3 halfDir = normalize(viewDir + lightDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
    color += vec3(1.0) * spec * 0.4;

    // Slight transparency at center, more opaque at edges
    float alpha = 0.6 + fresnel * 0.4;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ── Glow Flow Line Shader ───────────────────────────────────────────────────

const flowVertexShader = `
  varying float vLineProgress;
  attribute float lineProgress;

  void main() {
    vLineProgress = lineProgress;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flowFragmentShader = `
  uniform float uTime;
  uniform float uActive;
  uniform vec3 uColor;

  varying float vLineProgress;

  void main() {
    // Traveling pulse along the line
    float pulse = sin((vLineProgress - uTime * 2.0) * 6.283) * 0.5 + 0.5;
    pulse = pow(pulse, 4.0) * uActive;

    vec3 baseColor = uColor * (0.15 + uActive * 0.3);
    vec3 pulseColor = uColor * pulse * 1.5;

    float alpha = (0.2 + uActive * 0.3) + pulse * 0.5;

    gl_FragColor = vec4(baseColor + pulseColor, alpha);
  }
`;

// ── Reflection Floor Shader (Aircord: virtual camera mirror) ────────────────

const floorVertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const floorFragmentShader = `
  uniform sampler2D uReflectionMap;
  uniform float uTime;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    float dist = length(vWorldPosition.xz);

    // Spatial fade — reflection fades with distance from center
    float spatialFade = 1.0 - smoothstep(3.0, 12.0, dist);

    // Exponential fog (Aircord pattern)
    float fogFactor = exp(-0.01 * dist * dist);

    // Noise subtraction for organic feel
    float grain = fract(sin(dot(vUv * 100.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453) * 0.02;

    // Sample reflection
    vec4 reflection = texture2D(uReflectionMap, vUv);

    vec3 color = reflection.rgb * 0.5 * spatialFade - grain;
    float alpha = uOpacity * fogFactor * spatialFade;

    gl_FragColor = vec4(max(color, 0.0), alpha);
  }
`;

// ── Gmail "M" shape geometry ────────────────────────────────────────────────

function createGmailMesh(): THREE.Group {
  const group = new THREE.Group();
  const envGeo = new THREE.BoxGeometry(1.6, 1.1, 0.15);
  const envMat = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x222222 });
  group.add(new THREE.Mesh(envGeo, envMat));

  const barGeo = new THREE.BoxGeometry(0.12, 0.9, 0.2);
  const barMat = new THREE.MeshPhongMaterial({ color: CLR_EMAIL, emissive: 0xaa0000 });

  const left = new THREE.Mesh(barGeo, barMat);
  left.position.set(-0.55, 0, 0.05);
  group.add(left);

  const right = new THREE.Mesh(barGeo, barMat);
  right.position.set(0.55, 0, 0.05);
  group.add(right);

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
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), mat);
  head.position.y = 0.7;
  group.add(head);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.9, 12), mat);
  body.position.y = -0.15;
  group.add(body);
  return group;
}

// ── WebSocket icon mesh ─────────────────────────────────────────────────────

function createWSIcon(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: CLR_WS, emissive: 0x996600, shininess: 60 });
  const arrowGeo = new THREE.BoxGeometry(1.0, 0.15, 0.15);
  const top = new THREE.Mesh(arrowGeo, mat);
  top.position.y = 0.2;
  top.rotation.z = 0.15;
  group.add(top);
  const bot = new THREE.Mesh(arrowGeo, mat);
  bot.position.y = -0.2;
  bot.rotation.z = -0.15;
  group.add(bot);
  const ringGeo = new THREE.TorusGeometry(0.6, 0.06, 8, 24);
  const ringMat = new THREE.MeshPhongMaterial({ color: CLR_WS, emissive: 0x664400, transparent: true, opacity: 0.6 });
  group.add(new THREE.Mesh(ringGeo, ringMat));
  return group;
}

// ── Glass MPC node (ShaderMaterial with fresnel) ────────────────────────────

function createMPCNode(online: boolean): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.35, 32, 32);
  const color = online ? CLR_MPC_ON : CLR_MPC_OFF;
  const emissive = online ? 0x2e7d32 : 0x333333;

  if (online) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: glassVertexShader,
      fragmentShader: glassFragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uEmissive: { value: new THREE.Color(emissive) },
        uTime: { value: 0 },
        uPulse: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    return new THREE.Mesh(geo, mat);
  } else {
    const mat = new THREE.MeshPhongMaterial({
      color,
      emissive: emissive,
      shininess: 100,
      transparent: true,
      opacity: 0.4,
    });
    return new THREE.Mesh(geo, mat);
  }
}

// ── Glow flow line ──────────────────────────────────────────────────────────

function createFlowLine(from: THREE.Vector3, to: THREE.Vector3, active: boolean): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const progress = new Float32Array([0, 1]);
  geo.setAttribute('lineProgress', new THREE.BufferAttribute(progress, 1));

  const color = active ? new THREE.Color(CLR_MPC_ON) : new THREE.Color(0x444444);

  const mat = new THREE.ShaderMaterial({
    vertexShader: flowVertexShader,
    fragmentShader: flowFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uActive: { value: active ? 1.0 : 0.0 },
      uColor: { value: color },
    },
    transparent: true,
    depthWrite: false,
    blending: active ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  return new THREE.Line(geo, mat);
}

// ── Label sprite (animated fade-in) ─────────────────────────────────────────

function createLabel(text: string, color: string = '#ffffff'): THREE.Sprite {
  const isLong = text.length > 12;
  const canvas = document.createElement('canvas');
  canvas.width = isLong ? 512 : 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.font = isLong ? 'bold 22px monospace' : 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(isLong ? 4.0 : 2.5, isLong ? 0.5 : 0.6, 1);
  (sprite as any)._fadeIn = true;
  (sprite as any)._birthTime = performance.now();
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

// ── Helpers for updating shader uniforms in scene graph ─────────────────────

function updateChildUniforms(children: THREE.Object3D[], t: number) {
  for (const child of children) {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial) {
      const u = child.material.uniforms;
      if (u.uTime) u.uTime.value = t;
      if (u.uPulse) u.uPulse.value = Math.sin(t * 3) * 0.5 + 0.5;
    }
    if (child instanceof THREE.Line && child.material instanceof THREE.ShaderMaterial) {
      const u = child.material.uniforms;
      if (u.uTime) u.uTime.value = t;
    }
    if (child instanceof THREE.Sprite && (child as any)._fadeIn) {
      const age = (performance.now() - (child as any)._birthTime) / 1000;
      const opacity = Math.min(age / 0.6, 1.0);
      (child.material as THREE.SpriteMaterial).opacity = opacity * 0.85;
      if (opacity >= 1) (child as any)._fadeIn = false;
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

export function initNetworkViz(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (container.querySelector('canvas')) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 1.5, 16);
  camera.rotation.x = -0.08;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const point = new THREE.PointLight(0xffffff, 1);
  point.position.set(5, 8, 10);
  scene.add(point);

  // ── Reflective floor (Aircord: virtual camera mirror) ─────────────────
  const FLOOR_Y = -2.5;

  const reflectionRT = new THREE.WebGLRenderTarget(
    Math.min(container.clientWidth, 1024),
    Math.min(container.clientHeight, 1024),
    { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
  );

  const virtualCamera = new THREE.PerspectiveCamera();
  const textureMatrix = new THREE.Matrix4();

  const floorMat = new THREE.ShaderMaterial({
    vertexShader: floorVertexShader,
    fragmentShader: floorFragmentShader,
    uniforms: {
      uReflectionMap: { value: reflectionRT.texture },
      uTextureMatrix: { value: textureMatrix },
      uTime: { value: 0 },
      uOpacity: { value: 0.35 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40, 1, 1),
    floorMat,
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = FLOOR_Y;
  scene.add(floorMesh);

  const floorBase = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ color: 0x080810 }),
  );
  floorBase.rotation.x = -Math.PI / 2;
  floorBase.position.y = FLOOR_Y - 0.01;
  scene.add(floorBase);

  // ── Static elements ───────────────────────────────────────────────────
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

  scene.add(createFlowLine(
    new THREE.Vector3(COL_USER + 0.6, 0, 0),
    new THREE.Vector3(COL_WS - 0.8, 0, 0),
    true
  ));

  const mpcGroup = new THREE.Group();
  scene.add(mpcGroup);

  let statusSprite: THREE.Sprite | null = null;
  let currentNodes: QuorumNode[] = [];
  let wsConnected = false;
  let threshold = 3;

  function rebuildTopology() {
    while (mpcGroup.children.length) {
      const child = mpcGroup.children[0];
      mpcGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    if (statusSprite) {
      scene.remove(statusSprite);
      statusSprite = null;
    }

    const onlineNodes = currentNodes.filter(n => n.status === 'online');
    const quorumMet = onlineNodes.length >= threshold;
    const count = Math.max(onlineNodes.length, 1);
    const ySpread = Math.min(count - 1, 4) * 1.2;

    onlineNodes.forEach((node, i) => {
      const y = count === 1 ? 0 : -ySpread / 2 + (i / (count - 1)) * ySpread;
      const sphere = createMPCNode(true);
      sphere.position.set(COL_MPC, y, 0);
      mpcGroup.add(sphere);

      const labelText = node.relay_fqdn || `P${node.party_id}:${node.port}`;
      const labelColor = node.relay_registered ? '#66bb6a' : '#ffb74d';
      const label = createLabel(labelText, labelColor);
      label.position.set(COL_MPC, y - 0.6, 0);
      mpcGroup.add(label);

      mpcGroup.add(createFlowLine(
        new THREE.Vector3(COL_WS + 0.8, 0, 0),
        new THREE.Vector3(COL_MPC - 0.5, y, 0),
        true
      ));

      mpcGroup.add(createFlowLine(
        new THREE.Vector3(COL_MPC + 0.5, y, 0),
        new THREE.Vector3(COL_EMAIL - 1.0, 0, 0),
        quorumMet
      ));

      for (let j = 0; j < i; j++) {
        const yj = count === 1 ? 0 : -ySpread / 2 + (j / (count - 1)) * ySpread;
        mpcGroup.add(createFlowLine(
          new THREE.Vector3(COL_MPC + 0.1, y, 0.3),
          new THREE.Vector3(COL_MPC + 0.1, yj, 0.3),
          quorumMet
        ));
      }
    });

    if (onlineNodes.length === 0) {
      const empty = createMPCNode(false);
      empty.position.set(COL_MPC, 0, 0);
      mpcGroup.add(empty);

      const label = createLabel('no nodes', '#666666');
      label.position.set(COL_MPC, -0.8, 0);
      label.scale.set(2.0, 0.5, 1);
      mpcGroup.add(label);

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

    statusSprite = createStatusText(wsConnected, onlineNodes.length, threshold);
    statusSprite.position.set(0, -3.5, 0);
    scene.add(statusSprite);
  }

  rebuildTopology();

  // ── Shared WebSocket subscription ─────────────────────────────────────
  wsConnected = sharedWS.connected;
  sharedWS.onTopology((msg: TopologyMessage) => {
    wsConnected = true;
    currentNodes = msg.nodes;
    threshold = msg.threshold;
    rebuildTopology();
  });

  // ── Animation loop ────────────────────────────────────────────────────
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    userAvatar.position.y = Math.sin(t * 1.5) * 0.1;
    wsIcon.rotation.z = Math.sin(t * 2) * 0.15;
    gmail.position.y = Math.sin(t * 1.2 + 1) * 0.08;

    // Update all shader uniforms + label fade-ins
    updateChildUniforms(scene.children as THREE.Object3D[], t);
    updateChildUniforms(mpcGroup.children as THREE.Object3D[], t);

    // ── Reflection pass (Aircord: virtual camera mirror) ────────────────
    floorMat.uniforms.uTime.value = t;

    virtualCamera.copy(camera);
    const reflectMatrix = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, -1, 0, 2 * FLOOR_Y,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    virtualCamera.matrixWorld.copy(camera.matrixWorld).premultiply(reflectMatrix);
    virtualCamera.matrixWorld.decompose(virtualCamera.position, virtualCamera.quaternion, virtualCamera.scale);
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
    virtualCamera.updateMatrixWorld(true);

    textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    textureMatrix.multiply(virtualCamera.projectionMatrix);
    textureMatrix.multiply(virtualCamera.matrixWorldInverse);

    floorMesh.visible = false;
    floorBase.visible = false;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(reflectionRT);
    renderer.clear();
    renderer.render(scene, virtualCamera);
    renderer.setRenderTarget(prevTarget);
    floorMesh.visible = true;
    floorBase.visible = true;

    renderer.render(scene, camera);
  }

  animate();

  const resizeObs = new ResizeObserver(() => {
    if (!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
  resizeObs.observe(container);
}

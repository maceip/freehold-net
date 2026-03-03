/**
 * GalaxyShader — Enhanced particle galaxy with scanline ignition
 *
 * Upgraded from basic winking particles to Aircord-grade effects:
 *   - Scanline reveal wave that "ignites" the galaxy on init
 *   - Hot-core glow with radial gradient (not just flat alpha)
 *   - Chromatic color shift based on distance from center
 *   - Exponential fog fade at edges
 *   - Noise-driven turbulence on particle positions
 *   - Film grain overlay in fragment shader
 *
 * Original: Simple sine wink + flat circle discard
 * Enhanced: Full reveal animation + multi-layer glow + turbulence
 */

import * as THREE from 'three';

export function initGalaxyShader(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const particleCount = 6000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const phases = new Float32Array(particleCount);
  const radii = new Float32Array(particleCount);

  const colorPalette = [
    new THREE.Color(0x88ccff),
    new THREE.Color(0xffddaa),
    new THREE.Color(0xffaaaa),
    new THREE.Color(0xaa88ff),
  ];

  for (let i = 0; i < particleCount; i++) {
    const r = Math.random() * 4 + 0.5;
    const theta = r * 2 + (Math.random() * 0.5 - 0.25);
    const y = (Math.random() - 0.5) * (1.5 / r);

    positions[i * 3] = r * Math.cos(theta);
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = r * Math.sin(theta);

    const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = Math.random() * 2.0 + 0.5;
    phases[i] = Math.random() * Math.PI * 2;
    radii[i] = r;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));

  const vertexShader = `
    attribute float aSize;
    attribute float aPhase;
    attribute float aRadius;

    varying vec3 vColor;
    varying float vRevealMix;
    varying float vRadius;

    uniform float uTime;
    uniform float uRevealProgress;

    // Inline cnoise for turbulence (Aircord pattern)
    vec3 hash3(vec3 p) {
      p = vec3(
        dot(p, vec3(127.1, 311.7, 74.7)),
        dot(p, vec3(269.5, 183.3, 246.1)),
        dot(p, vec3(113.5, 271.9, 124.6))
      );
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }

    float cnoise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      vec3 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(dot(hash3(i), f),
                dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
            mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
        mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
            mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y),
        u.z
      );
    }

    void main() {
      vColor = color;
      vRadius = aRadius;

      // Scanline reveal: particles ignite outward from center
      float revealEdge = uRevealProgress * 5.5;
      float revealWidth = 1.2;
      vRevealMix = smoothstep(revealEdge - revealWidth, revealEdge, aRadius);

      // Turbulence displacement (Aircord: cnoise vertex animation)
      vec3 pos = position;
      float turb = cnoise(vec3(pos.xz * 0.5, uTime * 0.3)) * 0.15;
      pos.y += turb;
      pos.x += cnoise(vec3(pos.yz * 0.3 + 10.0, uTime * 0.2)) * 0.08;

      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

      // Winking + reveal pulse
      float wink = sin(uTime * 3.0 + aPhase) * 0.5 + 0.5;
      float revealPulse = smoothstep(revealEdge - 0.3, revealEdge, aRadius)
                        * smoothstep(revealEdge + 0.3, revealEdge, aRadius);
      float hotScale = 1.0 + revealPulse * 2.0;

      float finalSize = aSize * (0.5 + wink * 1.5) * hotScale * (1.0 - vRevealMix * 0.6);

      gl_PointSize = finalSize * (10.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    varying vec3 vColor;
    varying float vRevealMix;
    varying float vRadius;

    uniform float uTime;
    uniform float uRevealProgress;

    void main() {
      vec2 xy = gl_PointCoord.xy - vec2(0.5);
      float ll = length(xy);
      if (ll > 0.5) discard;

      // ── Multi-layer glow (Aircord: not just flat alpha) ──────────────
      float core = exp(-ll * ll * 40.0);
      float glow = exp(-ll * ll * 8.0);
      float halo = exp(-ll * ll * 2.0) * 0.3;

      float alpha = core + glow * 0.6 + halo;

      // ── Scanline hot color at reveal wavefront ───────────────────────
      float revealEdge = uRevealProgress * 5.5;
      float hotZone = smoothstep(revealEdge - 0.3, revealEdge, vRadius)
                    * smoothstep(revealEdge + 0.3, revealEdge, vRadius);

      vec3 hotColor = vec3(1.0, 0.95, 0.8);
      vec3 finalColor = mix(vColor, hotColor, hotZone * 0.8);

      // Chromatic shift — bluer near center, warmer at edges
      float chromaShift = smoothstep(0.5, 4.0, vRadius);
      finalColor = mix(finalColor, finalColor * vec3(1.1, 0.95, 0.85), chromaShift * 0.3);

      // ── Exponential fog at galaxy edges ──────────────────────────────
      float fogFactor = exp(-0.04 * vRadius * vRadius);
      alpha *= fogFactor;

      // Hide particles not yet revealed
      alpha *= (1.0 - vRevealMix);

      // ── Film grain (Aircord pattern) ─────────────────────────────────
      float grain = fract(sin(dot(gl_PointCoord * 50.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      finalColor += (grain - 0.5) * 0.05;

      gl_FragColor = vec4(finalColor, alpha);
    }
  `;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uRevealProgress: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.rotation.x = Math.PI / 4;
  scene.add(particles);

  const clock = new THREE.Clock();
  const revealDuration = 2.5;

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    material.uniforms.uTime.value = t;
    material.uniforms.uRevealProgress.value = Math.min(t / revealDuration, 1.0);
    particles.rotation.y = t * 0.05;
    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    if (!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

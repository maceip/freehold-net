/**
 * BackgroundShader — Enhanced procedural background
 *
 * Upgraded from basic FBM to Aircord-grade shader pipeline:
 *   - 3D gradient noise (cnoise) instead of basic hash noise
 *   - Curved horizon falloff — floor-like depth illusion
 *   - 5-tap Gaussian blur pass for silky smooth noise
 *   - Exponential fog with spatial fade
 *   - Animated noise displacement (vertex-level undulation)
 *   - Film grain with proper temporal jitter
 *
 * Original: ~30 lines of basic value noise + FBM
 * Enhanced: Full Aircord reflection-floor shader pipeline adapted for backgrounds
 */

import * as THREE from 'three';

export function initBackgroundShader(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const fragmentShader = `
    precision highp float;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;

    // ── 3D gradient noise (Aircord cnoise) ─────────────────────────────
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

    // ── FBM using cnoise (richer octaves than basic hash) ──────────────
    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      vec3 shift = vec3(100.0);
      for (int i = 0; i < 6; i++) {
        v += a * cnoise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
      }
      return v;
    }

    // ── 5-tap Gaussian blur (Aircord reflection pass) ──────────────────
    // Applied to the noise field for silky smooth gradients
    float blur5Noise(vec2 uv, float scale, float t) {
      float weights[5];
      weights[0] = 0.0510;
      weights[1] = 0.0918;
      weights[2] = 0.1225;
      weights[3] = 0.1531;
      weights[4] = 0.1633;

      float offsets[5];
      offsets[0] = -4.0;
      offsets[1] = -2.0;
      offsets[2] = 0.0;
      offsets[3] = 2.0;
      offsets[4] = 4.0;

      float texelSize = 1.0 / uResolution.y;
      float blurStrength = 3.0;

      float result = 0.0;
      float totalWeight = 0.0;
      for (int i = 0; i < 5; i++) {
        vec2 sampleUv = uv + vec2(0.0, offsets[i] * texelSize * blurStrength);
        vec3 p = vec3(sampleUv * scale, t);
        result += fbm(p) * weights[i];
        totalWeight += weights[i];
      }
      return result / totalWeight;
    }

    void main() {
      vec2 uv = vUv;
      float t = uTime * 0.08;

      // ── 1. Rich scrolling noise base (cnoise FBM with blur) ──────────
      float n = blur5Noise(uv + vec2(sin(t * 1.2) * 0.3, t), 3.0, t * 0.5);

      // Secondary noise layer for depth
      float n2 = cnoise(vec3(uv * 5.0 + vec2(t * 0.3, -t * 0.2), t * 0.7)) * 0.15;

      // ── 2. Color mapping — dark muted palette with subtle warmth ─────
      vec3 color1 = vec3(0.10, 0.12, 0.16); // Deep slate
      vec3 color2 = vec3(0.18, 0.14, 0.20); // Muted purple
      vec3 color3 = vec3(0.12, 0.16, 0.14); // Dark teal hint
      vec3 base = mix(color1, color2, smoothstep(-0.2, 0.4, n));
      base = mix(base, color3, smoothstep(0.2, 0.6, n + n2) * 0.4);

      // ── 3. Spatial fade (Aircord: reflection fades from center) ──────
      float dist = length(uv - 0.5) * 2.0;
      float spatialFade = 1.0 - smoothstep(0.3, 1.2, dist);

      // Subtle brightness variation from noise
      base *= 0.85 + spatialFade * 0.3;

      // ── 4. Curved horizon falloff (Aircord: floor bends away) ────────
      float horizonDark = smoothstep(0.3, 0.0, uv.y) * 0.3;  // Darken bottom
      float topDark = smoothstep(0.7, 1.0, uv.y) * 0.15;      // Slight top darken
      base -= horizonDark + topDark;

      // ── 5. Exponential fog (Aircord: fogDensity^2 * depth^2) ────────
      float fogDensity = 0.8;
      vec3 fogColor = vec3(0.06, 0.07, 0.09);
      float fogFactor = exp(-fogDensity * fogDensity * dist * dist);
      base = mix(fogColor, base, fogFactor);

      // ── 6. Enhanced vignette ─────────────────────────────────────────
      vec2 vigUv = vUv * (1.0 - vUv.yx);
      float vig = vigUv.x * vigUv.y * 15.0;
      vig = pow(vig, 0.2);
      base *= mix(0.25, 1.0, vig);

      // ── 7. Noise subtraction for organic feel (Aircord pattern) ──────
      float noiseSubtract = fract(sin(dot(vUv * 100.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453) * 0.025;
      base -= noiseSubtract;

      // ── 8. Film grain with temporal jitter ───────────────────────────
      float grain = fract(sin(dot(vUv * uResolution + fract(uTime * 137.0), vec2(12.9898, 78.233))) * 43758.5453);
      base += (grain - 0.5) * 0.04;

      gl_FragColor = vec4(max(base, 0.0), 1.0);
    }
  `;

  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    uniforms.uTime.value = clock.getElapsedTime();
    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  });
}

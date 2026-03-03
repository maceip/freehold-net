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

  const fragmentShader = `
    precision highp float;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;

    // Procedural noise for privacy-preserving background
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }
    
    // Value noise
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    
    // FBM (Fractal Brownian Motion)
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 uv = vUv;
      
      // 1. Procedural Scrolling Base
      vec2 scrollUv = uv * 3.0 + vec2(sin(uTime * 0.1) * 0.5, uTime * 0.1);
      float n = fbm(scrollUv);
      
      // 2. Map to muted colors
      vec3 color1 = vec3(0.15, 0.18, 0.22); // Dark slate
      vec3 color2 = vec3(0.25, 0.2, 0.25);  // Dark purple/grey
      vec3 mutedColor = mix(color1, color2, n);
      
      // 3. Subtle Vignette
      vec2 vigUv = vUv * (1.0 - vUv.yx);
      float vig = vigUv.x * vigUv.y * 15.0;
      vig = pow(vig, 0.25);
      mutedColor *= mix(0.4, 1.0, vig); // Darken edges heavily
      
      // 4. Film Grain
      float grain = hash(vUv * 1000.0 + uTime * 100.0) * 0.05;
      mutedColor += grain - 0.025;

      gl_FragColor = vec4(mutedColor, 1.0);
    }
  `;

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
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

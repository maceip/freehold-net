import * as THREE from 'three';

export function initGalaxyShader(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Clear previous if any
  container.innerHTML = '';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Particles for Milky Way / Andromeda
  const particleCount = 5000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const phases = new Float32Array(particleCount); // For winking

  const colorPalette = [
    new THREE.Color(0x88ccff), // Blueish white
    new THREE.Color(0xffddaa), // Yellowish white
    new THREE.Color(0xffaaaa), // Reddish
    new THREE.Color(0xaa88ff), // Purpleish
  ];

  for (let i = 0; i < particleCount; i++) {
    // Spiral galaxy distribution
    const r = Math.random() * 4 + 0.5;
    const theta = r * 2 + (Math.random() * 0.5 - 0.25); // Spiral arms
    const y = (Math.random() - 0.5) * (1.5 / r); // Thicker in center

    positions[i * 3] = r * Math.cos(theta);
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = r * Math.sin(theta);

    const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = Math.random() * 2.0 + 0.5;
    phases[i] = Math.random() * Math.PI * 2;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const vertexShader = `
    attribute float aSize;
    attribute float aPhase;
    varying vec3 vColor;
    uniform float uTime;
    void main() {
      vColor = color;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      
      // Winking effect
      float wink = sin(uTime * 3.0 + aPhase) * 0.5 + 0.5;
      float finalSize = aSize * (0.5 + wink * 1.5);
      
      gl_PointSize = finalSize * (10.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    varying vec3 vColor;
    void main() {
      // Soft circular particle
      vec2 xy = gl_PointCoord.xy - vec2(0.5);
      float ll = length(xy);
      if(ll > 0.5) discard;
      
      // Glow
      float alpha = (0.5 - ll) * 2.0;
      gl_FragColor = vec4(vColor, alpha);
    }
  `;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const particles = new THREE.Points(geometry, material);
  // Tilt the galaxy
  particles.rotation.x = Math.PI / 4;
  scene.add(particles);

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    material.uniforms.uTime.value = t;
    
    // Slow rotation
    particles.rotation.y = t * 0.05;
    
    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    if(!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

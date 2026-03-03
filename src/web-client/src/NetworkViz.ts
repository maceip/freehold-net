import * as THREE from 'three';

export function initNetworkViz(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.z = 10;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Group for all nodes
  const clusterGroup = new THREE.Group();
  scene.add(clusterGroup);

  // Create Node geometry
  const nodeGeo = new THREE.SphereGeometry(0.4, 32, 32);
  const nodeMat = new THREE.MeshPhongMaterial({ color: 0x00ffff, emissive: 0x00aaaa, shininess: 100 });
  const forwarderMat = new THREE.MeshPhongMaterial({ color: 0xff3333, emissive: 0xaa0000, shininess: 100 });

  const nodeCount = 8; // Simulated nodes
  const nodes: THREE.Mesh[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const mesh = new THREE.Mesh(nodeGeo, i === 0 ? forwarderMat : nodeMat);
    const angle = (i / nodeCount) * Math.PI * 2;
    const radius = 5;
    mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, (Math.random() - 0.5) * 2);
    clusterGroup.add(mesh);
    nodes.push(mesh);
  }

  // Create Lines between all nodes (Mesh connectivity)
  const lineMat = new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.3 });
  for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      const geometry = new THREE.BufferGeometry().setFromPoints([nodes[i].position, nodes[j].position]);
      const line = new THREE.Line(geometry, lineMat);
      clusterGroup.add(line);
    }
  }

  // Light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  const pointLight = new THREE.PointLight(0xffffff, 1);
  pointLight.position.set(5, 5, 5);
  scene.add(pointLight);

  function animate() {
    requestAnimationFrame(animate);
    clusterGroup.rotation.y += 0.005;
    clusterGroup.rotation.x += 0.002;
    
    // Subtle pulsing of nodes
    const time = Date.now() * 0.002;
    nodes.forEach((n, idx) => {
      n.scale.setScalar(1 + Math.sin(time + idx) * 0.1);
    });

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

import * as THREE from 'three';

export class CreaturePresence {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private creatures: THREE.Group[] = [];
  private container: HTMLElement;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 5, 10);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, 10, 5);
    this.scene.add(sun);

    this.animate();
  }

  public addCreature() {
    const group = new THREE.Group();
    
    // Simple "Frog/Amphibian" body using primitives
    const bodyGeo = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
    const bodyMat = new THREE.MeshPhongMaterial({ 
        color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5),
        flatShading: true 
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.15, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.2, 0.6, 0.4);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(-0.2, 0.6, 0.4);
    group.add(eyeL, eyeR);

    // Random placement
    group.position.set(
      (Math.random() - 0.5) * 15,
      -2,
      (Math.random() - 0.5) * 10
    );
    group.rotation.y = Math.random() * Math.PI * 2;
    
    this.scene.add(group);
    this.creatures.push(group);
  }

  private animate() {
    requestAnimationFrame(() => this.animate());
    const t = Date.now() * 0.001;

    this.creatures.forEach((c, i) => {
      // Subtle breathing / hopping
      c.position.y = -2 + Math.abs(Math.sin(t + i)) * 0.2;
      c.rotation.z = Math.sin(t * 0.5 + i) * 0.1;
    });

    this.renderer.render(this.scene, this.camera);
  }
}

export function spawnShimmeringCard(container: HTMLElement) {
    const card = document.createElement('div');
    card.style.cssText = `
        position: fixed; bottom: 2rem; right: 2rem; width: 250px; height: 100px;
        background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.02));
        backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 16px; overflow: hidden; opacity: 0; transform: translateY(20px);
        transition: all 1s ease; z-index: 400;
    `;
    
    const shimmer = document.createElement('div');
    shimmer.style.cssText = `
        position: absolute; inset: -100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
        transform: rotate(25deg); animation: shimmer 3s infinite;
    `;
    
    const style = document.createElement('style');
    style.innerHTML = `@keyframes shimmer { from { left: -150%; } to { left: 150%; } }`;
    document.head.appendChild(style);
    
    card.appendChild(shimmer);
    container.appendChild(card);
    
    setTimeout(() => {
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";
    }, 100);
}

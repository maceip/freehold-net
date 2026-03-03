import * as THREE from 'three';

export class SignaturePen {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private pen: THREE.Mesh;
  private container: HTMLElement;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.1, 100);
    this.camera.position.set(0, 2, 5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.container.appendChild(this.renderer.domElement);

    const light = new THREE.PointLight(0xffffff, 1);
    light.position.set(2, 5, 2);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Simple Ballpoint Pen Mesh
    const penGeo = new THREE.CylinderGeometry(0.05, 0.05, 3, 16);
    const penMat = new THREE.MeshPhongMaterial({ color: 0x222222, specular: 0x555555, shininess: 30 });
    this.pen = new THREE.Mesh(penGeo, penMat);
    this.pen.rotation.z = -Math.PI / 4;
    this.scene.add(this.pen);

    this.animate();
  }

  public updatePosition(xPercent: number) {
    this.pen.position.x = (xPercent - 0.5) * 4;
    this.pen.rotation.y = Math.sin(Date.now() * 0.01) * 0.2;
  }

  private animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
  }
}

export function getMathEquation(): string {
    const equations = [
        "BooleanValue r = this->v ^ other.v;", // From Domain.h
        "C = g^m h^r \\pmod{p}", // Pedersen
        "RingValue::sample(prng, count);", // From Domain.h
        "e(P, Q) = e(Q, P)", // Bilinear
        "\\Delta = \\text{IT-MAC}(x, \\delta)", 
        "\\text{Garbled}(f, K) \\to (\\tilde{f}, \\tilde{K})",
        "BooleanValue operator*(const BooleanValue& other)", // From Domain.h
        "H(Email || PetitionID) \\to \\text{Nullifier}", // ZK Nullifier
        "S = \\sum_{i=1}^n w_i s_i", // LLSS
        "\\text{if}(c) \\{ r.v = \\sim this->v; \\}" // From Domain.h
    ];
    return equations[Math.floor(Math.random() * equations.length)];
}

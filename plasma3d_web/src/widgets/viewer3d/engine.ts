import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Modelo3D, type ElementType, type ModelSummary } from '@/entities/model3D/three/Modelo3D';
import { FLOOR_TEXTURE } from '@/entities/model3D/three/textures';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface SelectedInfo {
  name: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

type SelectionListener = (info: SelectedInfo | null) => void;

/**
 * EditorEngine — nucleo Three.js del editor.
 * Separado de React para no re-renderizar la escena.
 *
 * Nota: en three r169+ `TransformControls` ya no es Object3D; se agrega su
 * helper con `scene.add(controls.getHelper())`.
 */
export class EditorEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private transformControls: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private floor!: THREE.Mesh;

  public model: Modelo3D | null = null;
  public selected: THREE.Mesh | null = null;
  public creating: ElementType | null = null;
  private onSelection: SelectionListener = () => {};

  private pointerDown = { x: 0, y: 0, button: -1 };
  private justDraggedAt = 0;
  private resizeObserver: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    const { clientWidth: w, clientHeight: h } = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0xdddddd);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    this.camera.position.set(10, 15, 15);
    this.camera.lookAt(0, 0, 0);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.1;
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();

    // Luces y helpers
    this.scene.add(new THREE.GridHelper(30, 30));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));

    const intensity = 0.6;
    const target = new THREE.Vector3(0, 0, 0);
    const positions = [
      [0, 10, 10],
      [0, 10, -10],
      [10, 10, 0],
      [-10, 10, 0],
    ];
    positions.forEach(([x, y, z]) => {
      const light = new THREE.DirectionalLight(0xffffff, intensity);
      light.position.set(x, y, z);
      light.target.position.copy(target);
      this.scene.add(light);
      this.scene.add(light.target);
    });

    // Suelo con textura
    const textureLoader = new THREE.TextureLoader();
    const floorTexture = textureLoader.load(FLOOR_TEXTURE);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(10, 10);
    floorTexture.colorSpace = THREE.SRGBColorSpace;

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.8, metalness: 0.1 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0;
    this.scene.add(this.floor);

    // Gizmo de transformacion (fix three r169+)
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean((event as unknown as { value: boolean }).value);
      this.orbit.enabled = !dragging;
      if (!dragging) this.justDraggedAt = Date.now();
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (this.selected) this.emitSelection();
    });

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);

    this.renderer.setAnimationLoop(() => {
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    });

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(canvas);
  }

  setSelectionListener(listener: SelectionListener) {
    this.onSelection = listener;
  }

  private onResize() {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  private onPointerDown = (event: PointerEvent) => {
    this.pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.pointerDown.button !== 0) return;
    const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    if (moved > 4) return;
    if (Date.now() - this.justDraggedAt < 200) return;
    this.handleClick(event);
  };

  private handleClick(event: PointerEvent) {
    if (!this.model) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.creating) {
      const floorHit = this.raycaster.intersectObject(this.floor, true);
      if (floorHit.length > 0) {
        this.spawnElementAt(floorHit[0].point.clone());
        return;
      }
    }

    const meshes = [
      ...this.model.getWalls(),
      ...this.model.getDoors(),
      ...this.model.getWindows(),
    ];
    const intersects = this.raycaster.intersectObjects(meshes, true);

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      this.select(mesh);
    } else {
      this.clearSelection();
    }
  }

  private select(mesh: THREE.Mesh) {
    if (this.selected && this.selected !== mesh) {
      const prev = this.selected.material as THREE.MeshStandardMaterial;
      prev?.emissive?.setHex(0x000000);
    }
    this.selected = mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material?.emissive?.setHex(0x333333);
    this.transformControls.attach(mesh);
    this.emitSelection();
  }

  private clearSelection() {
    if (this.selected) {
      const prev = this.selected.material as THREE.MeshStandardMaterial;
      prev?.emissive?.setHex(0x000000);
    }
    this.selected = null;
    this.transformControls.detach();
    this.onSelection(null);
  }

  private emitSelection() {
    if (!this.selected) {
      this.onSelection(null);
      return;
    }
    const mesh = this.selected;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    this.onSelection({
      name: mesh.name,
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      rotation: {
        x: THREE.MathUtils.radToDeg(mesh.rotation.x),
        y: THREE.MathUtils.radToDeg(mesh.rotation.y),
        z: THREE.MathUtils.radToDeg(mesh.rotation.z),
      },
      scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
      size: { x: size.x, y: size.y, z: size.z },
    });
  }

  loadModel(url: string, textures: { name: string; url: string }[], onLoaded?: () => void) {
    this.model?.dispose();
    this.model = new Modelo3D(
      this.scene,
      url,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 1, 1),
      new THREE.Euler(0, 0, 0),
      textures,
      onLoaded,
    );
  }

  setMode(mode: TransformMode) {
    this.transformControls.setMode(mode);
  }

  setSpace(space: 'local' | 'world') {
    this.transformControls.setSpace(space);
  }

  setTranslationSnap(value: number | null) {
    this.transformControls.setTranslationSnap(value);
  }

  setRotationSnap(value: number | null) {
    this.transformControls.setRotationSnap(value ? THREE.MathUtils.degToRad(value) : null);
  }

  startCreate(type: ElementType) {
    this.creating = type;
  }

  private spawnElementAt(point: THREE.Vector3) {
    if (!this.model || !this.creating) return;
    const baseY = this.model.getWalls().length > 0 ? this.model.getWalls()[0].position.y : 0;
    point.y = baseY;

    const mesh = this.model.createElement(this.creating, 2, 3, 0.4, point);
    this.creating = null;
    this.select(mesh);
  }

  deleteSelected() {
    if (!this.selected || !this.model) return;
    this.model.removeElement(this.selected);
    this.clearSelection();
  }

  applyTexture(part: string, url: string) {
    if (!this.model) return;
    this.model.setTextureByName(part, url);
  }

  setSelectedColor(hex: string) {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hex),
      metalness: 0.3,
      roughness: 0.7,
    });
    if (this.selected) {
      this.selected.material = material;
    } else {
      this.model?.setMaterial(material);
    }
  }

  updatePosition(axis: 'x' | 'y' | 'z', value: number) {
    if (!this.selected) return;
    this.selected.position[axis] = value;
    this.emitSelection();
  }

  updateRotation(axis: 'x' | 'y' | 'z', deg: number) {
    if (!this.selected) return;
    this.selected.rotation[axis] = THREE.MathUtils.degToRad(deg);
    this.emitSelection();
  }

  updateScale(axis: 'x' | 'y' | 'z', value: number) {
    if (!this.selected) return;
    this.selected.scale[axis] = value;
    this.emitSelection();
  }

  resetScale() {
    if (!this.selected) return;
    this.selected.scale.set(1, 1, 1);
    this.emitSelection();
  }

  async exportGlb(filename: string) {
    if (!this.model) throw new Error('Sin modelo');
    return this.model.exportAsGLB(filename);
  }

  getSummary(): ModelSummary | null {
    return this.model ? this.model.toJSONSummary() : null;
  }

  updateLoadedModelPosition(axis: 'x' | 'y' | 'z', value: number) {
    if (this.selected || !this.model) return;
    const obj = this.model.getObject3D();
    if (!obj) return;
    obj.position[axis] = value;
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
    this.transformControls.detach();
    this.transformControls.dispose();
    this.orbit.dispose();
    this.model?.dispose();
    this.renderer.dispose();
  }
}

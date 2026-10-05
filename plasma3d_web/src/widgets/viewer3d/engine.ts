import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Modelo3D, type ElementType, type ModelSummary } from '@/entities/model3D/three/Modelo3D';
import type { Layer } from '@/entities/layers/types';
import type { Material } from '@/entities/materials/types';

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type ViewName = 'planta' | 'alzado' | 'perfil' | 'isometrica' | '3d';

export interface SelectedInfo {
  name: string;
  count: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  kind: string;
  layerId: string;
  color: string;
  effectiveColor: string;
  lineType: string;
  lineWidth: number;
  transparency: number;
  materialId: string;
  elevation: number;
  length: number;
  angle: number;
  thickness: number;
  height: number;
  width: number;
  sill: number;
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
  private persp!: THREE.PerspectiveCamera;
  private ortho!: THREE.OrthographicCamera;
  private camera!: THREE.Camera;
  private orbit: OrbitControls;
  private transformControls: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private grid!: THREE.GridHelper;
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private layers: Layer[] = [];
  private materials: Material[] = [];
  private currentLayerId = '';
  private showTextures = true;
  private textureLoader = new THREE.TextureLoader();
  private textureCache = new Map<string, THREE.Texture>();
  private viewSize = 20;
  private view: ViewName = 'planta';
  private tween: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    duration: number;
  } | null = null;

  public model: Modelo3D | null = null;
  public selected: THREE.Mesh | null = null;
  public selection: THREE.Mesh[] = [];
  public creating: ElementType | null = null;
  private onSelection: SelectionListener = () => {};
  private onDraft: (info: { type: ElementType; length: number } | null) => void = () => {};
  private onMarquee: (rect: { x: number; y: number; w: number; h: number } | null) => void = () => {};
  private drafting: { type: ElementType; start: THREE.Vector3; current: THREE.Vector3 } | null = null;
  private preview: THREE.Mesh | null = null;
  private orthoMode = false;
  private translationSnap: number | null = null;
  private pivot = new THREE.Object3D();
  private dragStart: { pivot: THREE.Matrix4; meshes: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] } | null = null;
  private marqueeStart: { x: number; y: number } | null = null;
  private marqueeActive = false;
  private toolMode: 'select' | 'hand' = 'select';

  private pointerDown = { x: 0, y: 0, button: -1 };
  private justDraggedAt = 0;
  private resizeObserver: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    const { clientWidth: w, clientHeight: h } = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x0a0e1a);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.scene = new THREE.Scene();

    const aspect = w / h;
    this.persp = new THREE.PerspectiveCamera(45, aspect, 0.1, 2000);
    this.persp.position.set(10, 15, 15);

    const orthoHalfH = this.viewSize / 2;
    const orthoHalfW = orthoHalfH * aspect;
    this.ortho = new THREE.OrthographicCamera(-orthoHalfW, orthoHalfW, orthoHalfH, -orthoHalfH, 0.1, 2000);
    this.camera = this.persp;

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.1;
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();

    // Luces y helpers
    this.grid = new THREE.GridHelper(30, 30, 0x334155, 0x1e293b);
    this.scene.add(this.grid);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

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

    // Preview (fantasma) para dibujar muros/puertas/ventanas por arrastre
    const previewGeometry = new THREE.BoxGeometry(1, 1, 1);
    const previewMaterial = new THREE.MeshBasicMaterial({
      color: 0x4f7cff,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.preview = new THREE.Mesh(previewGeometry, previewMaterial);
    this.preview.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(previewGeometry),
        new THREE.LineBasicMaterial({ color: 0x8ab4ff }),
      ),
    );
    this.preview.visible = false;
    this.scene.add(this.preview);

    // Gizmo de transformacion (fix three r169+)
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean((event as unknown as { value: boolean }).value);
      this.orbit.enabled = !dragging;
      if (!dragging) this.justDraggedAt = Date.now();
      if (dragging) this.captureTransformStart();
      else this.dragStart = null;
    });

    this.transformControls.addEventListener('objectChange', () => {
      this.applyTransformDelta();
    });

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: true });

    this.renderer.setAnimationLoop(() => {
      if (this.tween) {
        this.updateTween();
      } else {
        this.orbit.update();
      }
      this.renderer.render(this.scene, this.camera);
    });

    this.setView('planta');

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
    const aspect = clientWidth / clientHeight;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    this.updateOrthoFrustum();
  }

  private onPointerDown = (event: PointerEvent) => {
    this.tween = null;
    this.pointerDown = { x: event.clientX, y: event.clientY, button: event.button };

    if (event.button !== 0) return;

    if (this.creating && this.model) {
      const point = this.floorPoint(event.clientX, event.clientY);
      if (point) this.beginDraft(point);
      return;
    }

    if (this.transformControls.axis) return;

    if (this.toolMode === 'hand') return;

    // Seleccion por rectangulo: solo en vistas fijas (ortograficas, sin rotacion)
    if (!this.orbit.enableRotate && this.model) {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.selectableMeshes(), false);
      if (hit.length === 0) {
        this.marqueeStart = { x: event.clientX, y: event.clientY };
        this.marqueeActive = false;
        this.orbit.enabled = false;
      }
    }
  };

  private onWheel = () => {
    this.tween = null;
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.drafting) {
      const point = this.floorPoint(event.clientX, event.clientY);
      if (point) this.updateDraft(point, event.shiftKey);
      return;
    }
    if (this.marqueeStart) {
      const moved = Math.hypot(event.clientX - this.marqueeStart.x, event.clientY - this.marqueeStart.y);
      if (moved > 5) {
        this.marqueeActive = true;
        this.emitMarquee(this.marqueeStart, { x: event.clientX, y: event.clientY });
      }
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.drafting) {
      const point = this.floorPoint(event.clientX, event.clientY) ?? this.drafting.current;
      this.finalizeDraft(point, event.shiftKey);
      return;
    }

    if (this.marqueeStart) {
      const start = this.marqueeStart;
      const active = this.marqueeActive;
      this.marqueeStart = null;
      this.marqueeActive = false;
      this.orbit.enabled = true;
      this.onMarquee(null);
      this.justDraggedAt = Date.now();

      if (active) {
        this.selectInRect(start, { x: event.clientX, y: event.clientY }, event.ctrlKey || event.metaKey);
      } else {
        this.clearSelection();
      }
      return;
    }

    if (this.toolMode === 'hand') return;

    if (this.pointerDown.button !== 0) return;
    const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    if (moved > 4) return;
    if (Date.now() - this.justDraggedAt < 200) return;
    this.handleClick(event);
  };

  private emitMarquee(a: { x: number; y: number }, b: { x: number; y: number }) {
    const rect = this.canvas.getBoundingClientRect();
    this.onMarquee({
      x: Math.min(a.x, b.x) - rect.left,
      y: Math.min(a.y, b.y) - rect.top,
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    });
  }

  private selectInRect(a: { x: number; y: number }, b: { x: number; y: number }, additive: boolean) {
    const rect = this.canvas.getBoundingClientRect();
    const minX = Math.min(a.x, b.x) - rect.left;
    const maxX = Math.max(a.x, b.x) - rect.left;
    const minY = Math.min(a.y, b.y) - rect.top;
    const maxY = Math.max(a.y, b.y) - rect.top;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    const inside = (mesh: THREE.Mesh) => {
      const box = new THREE.Box3().setFromObject(mesh);
      const corners: [number, number, number][] = [
        [box.min.x, box.min.y, box.min.z],
        [box.min.x, box.min.y, box.max.z],
        [box.min.x, box.max.y, box.min.z],
        [box.min.x, box.max.y, box.max.z],
        [box.max.x, box.min.y, box.min.z],
        [box.max.x, box.min.y, box.max.z],
        [box.max.x, box.max.y, box.min.z],
        [box.max.x, box.max.y, box.max.z],
      ];
      return corners.some(([x, y, z]) => {
        const ndc = new THREE.Vector3(x, y, z).project(this.camera);
        const sx = (ndc.x * 0.5 + 0.5) * width;
        const sy = (-ndc.y * 0.5 + 0.5) * height;
        return sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
      });
    };

    const found = this.selectableMeshes().filter(inside);
    const next = additive ? Array.from(new Set([...this.selection, ...found])) : found;
    this.setSelection(next);
  }

  private floorPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    if (!point) return null;
    return this.snapPoint(point.clone());
  }

  private clampSelectionToFloor() {
    this.selection.forEach((mesh) => {
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.min.y < 0) {
        mesh.position.y += -box.min.y;
        mesh.updateMatrix();
      }
    });
  }

  private snapPoint(point: THREE.Vector3): THREE.Vector3 {
    const snap = this.translationSnap;
    if (snap && snap > 0) {
      point.x = Math.round(point.x / snap) * snap;
      point.z = Math.round(point.z / snap) * snap;
    }
    point.y = 0;
    return point;
  }

  private beginDraft(point: THREE.Vector3) {
    if (!this.creating) return;
    this.drafting = { type: this.creating, start: point.clone(), current: point.clone() };
    this.orbit.enabled = false;
    this.updatePreview();
    this.onDraft({ type: this.creating, length: 0 });
  }

  private updateDraft(point: THREE.Vector3, orthoOverride = false) {
    if (!this.drafting) return;
    const end = this.constrainPoint(point, this.drafting.start, orthoOverride);
    this.drafting.current = end;
    this.updatePreview();
    this.onDraft({ type: this.drafting.type, length: end.distanceTo(this.drafting.start) });
  }

  private constrainPoint(point: THREE.Vector3, start: THREE.Vector3, orthoOverride = false): THREE.Vector3 {
    const p = point.clone();
    if (this.orthoMode || orthoOverride) {
      const dx = Math.abs(p.x - start.x);
      const dz = Math.abs(p.z - start.z);
      if (dx >= dz) p.z = start.z;
      else p.x = start.x;
    }
    p.y = start.y;
    return p;
  }

  private elementDims(type: ElementType) {
    if (type === 'wall') return { thickness: 0.3, height: 3, sill: 0 };
    if (type === 'door') return { thickness: 0.2, height: 2.1, sill: 0 };
    return { thickness: 0.2, height: 1.2, sill: 0.9 };
  }

  private updatePreview() {
    if (!this.preview || !this.drafting) return;
    const { type, start, current } = this.drafting;
    const dir = new THREE.Vector3().subVectors(current, start);
    const length = dir.length();
    const dims = this.elementDims(type);
    if (length < 0.001) {
      this.preview.visible = false;
      return;
    }
    const mid = new THREE.Vector3().addVectors(start, current).multiplyScalar(0.5);
    this.preview.visible = true;
    this.preview.scale.set(dims.thickness, dims.height, length);
    this.preview.position.set(mid.x, dims.sill + dims.height / 2, mid.z);
    this.preview.rotation.y = Math.atan2(dir.x, dir.z);
  }

  private finalizeDraft(point: THREE.Vector3, orthoOverride = false) {
    if (!this.drafting || !this.model) return;
    const start = this.drafting.start.clone();
    const end = this.constrainPoint(point, start, orthoOverride);
    const type = this.drafting.type;

    this.drafting = null;
    if (this.preview) this.preview.visible = false;
    this.orbit.enabled = true;
    this.creating = null;
    this.onDraft(null);

    if (end.distanceTo(start) < 0.2) return;
    const dims = this.elementDims(type);
    const mesh = this.model.createElementSegment(type, start, end, dims.thickness, dims.height, dims.sill);
    if (mesh) {
      this.initMesh(mesh, this.currentLayerId);
      this.refreshVisibility();
      this.refreshAppearance();
      this.select(mesh);
    }
  }

  cancelDraft() {
    this.drafting = null;
    if (this.preview) this.preview.visible = false;
    this.creating = null;
    this.orbit.enabled = true;
    this.onDraft(null);
  }

  private handleClick(event: PointerEvent) {
    if (!this.model) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersects = this.raycaster.intersectObjects(this.selectableMeshes(), false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      if (event.ctrlKey || event.metaKey) {
        const exists = this.selection.includes(mesh);
        this.setSelection(
          exists ? this.selection.filter((m) => m !== mesh) : [...this.selection, mesh],
        );
      } else {
        this.select(mesh);
      }
    } else {
      this.clearSelection();
    }
  }

  private allMeshes(): THREE.Mesh[] {
    if (!this.model) return [];
    return [...this.model.getWalls(), ...this.model.getDoors(), ...this.model.getWindows()];
  }

  private syncPivot() {
    if (this.selection.length === 0) return;
    const centroid = new THREE.Vector3();
    this.selection.forEach((mesh) => centroid.add(mesh.position));
    centroid.multiplyScalar(1 / this.selection.length);
    this.pivot.position.copy(centroid);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
  }

  private setSelection(meshes: THREE.Mesh[]) {
    this.selection.forEach((mesh) => {
      (mesh.material as THREE.MeshStandardMaterial)?.emissive?.setHex(0x000000);
    });
    this.selection = meshes;
    meshes.forEach((mesh) => {
      (mesh.material as THREE.MeshStandardMaterial)?.emissive?.setHex(0x2a3550);
    });
    this.selected = meshes[0] ?? null;

    if (meshes.length === 0) {
      this.transformControls.detach();
    } else {
      this.syncPivot();
      this.transformControls.attach(this.pivot);
    }
    this.emitSelection();
  }

  private select(mesh: THREE.Mesh) {
    this.setSelection([mesh]);
  }

  private clearSelection() {
    this.setSelection([]);
  }

  private emitSelection() {
    const mesh = this.selected;
    if (!mesh) {
      this.onSelection(null);
      return;
    }
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    const layer = this.layerById(mesh.userData.layerId);
    const raw = (mesh.userData.color as string) ?? 'bylayer';
    const effectiveColor = raw && raw !== 'bylayer' ? raw : layer?.color ?? '#9aa4b2';
    const base = (mesh.userData.baseDims as { thickness: number; height: number; length: number }) ?? {
      thickness: size.x,
      height: size.y,
      length: size.z,
    };

    this.onSelection({
      name: this.selection.length > 1 ? `${this.selection.length} elementos` : mesh.name,
      count: this.selection.length,
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      rotation: {
        x: THREE.MathUtils.radToDeg(mesh.rotation.x),
        y: THREE.MathUtils.radToDeg(mesh.rotation.y),
        z: THREE.MathUtils.radToDeg(mesh.rotation.z),
      },
      scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
      size: { x: size.x, y: size.y, z: size.z },
      kind: (mesh.userData.kind as string) ?? 'mesh',
      layerId: (mesh.userData.layerId as string) ?? '',
      color: raw,
      effectiveColor,
      lineType: layer?.tipoLinea ?? 'continuous',
      lineWidth: layer?.grosorLinea ?? 0.25,
      transparency: layer?.transparencia ?? 0,
      materialId: (mesh.userData.materialId as string) ?? '',
      elevation: (mesh.userData.elevation as number) ?? 0,
      length: base.length,
      angle: THREE.MathUtils.radToDeg(mesh.rotation.y),
      thickness: base.thickness,
      height: base.height * mesh.scale.y,
      width: base.length * mesh.scale.z,
      sill: (mesh.userData.elevation as number) ?? 0,
    });
  }

  private captureTransformStart() {
    if (this.selection.length === 0) return;
    this.pivot.updateMatrix();
    this.dragStart = {
      pivot: this.pivot.matrix.clone(),
      meshes: this.selection.map((mesh) => {
        mesh.updateMatrix();
        return { mesh, matrix: mesh.matrix.clone() };
      }),
    };
  }

  private applyTransformDelta() {
    if (!this.dragStart) return;
    this.pivot.updateMatrix();
    const inverse = new THREE.Matrix4().copy(this.dragStart.pivot).invert();
    const delta = new THREE.Matrix4().multiplyMatrices(this.pivot.matrix, inverse);
    this.dragStart.meshes.forEach(({ mesh, matrix }) => {
      const next = new THREE.Matrix4().multiplyMatrices(delta, matrix);
      next.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrix();
    });
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
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
      () => {
        if (this.model) this.model.getObject3D().add(this.pivot);
        this.initAllMeshes();
        this.refreshVisibility();
        this.refreshAppearance();
        onLoaded?.();
      },
    );
  }

  setMode(mode: TransformMode) {
    this.transformControls.setMode(mode);
  }

  setSpace(space: 'local' | 'world') {
    this.transformControls.setSpace(space);
  }

  setGridVisible(visible: boolean) {
    this.grid.visible = visible;
  }

  getView(): ViewName {
    return this.view;
  }

  getCameraQuaternion(): THREE.Quaternion | null {
    return this.camera ? this.camera.quaternion.clone() : null;
  }

  private getModelBounds() {
    const box = new THREE.Box3();
    const obj = this.model?.getObject3D();
    if (obj) box.setFromObject(obj);
    if (box.isEmpty()) {
      box.setFromCenterAndSize(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(12, 3, 12));
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 4);
    return { center, maxDim };
  }

  private updateOrthoFrustum() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight || 1;
    const halfH = this.viewSize / 2;
    const halfW = halfH * aspect;
    this.ortho.left = -halfW;
    this.ortho.right = halfW;
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.updateProjectionMatrix();
  }

  private classifyDirection(dir: THREE.Vector3): ViewName {
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);
    if (ay > 0.8 && ax < 0.3 && az < 0.3) return 'planta';
    if (az > 0.8 && ax < 0.3 && ay < 0.3) return 'alzado';
    if (ax > 0.8 && ay < 0.3 && az < 0.3) return 'perfil';
    return 'isometrica';
  }

  private applyView(ortho: boolean, dir: THREE.Vector3, viewName: ViewName) {
    const { center, maxDim } = this.getModelBounds();
    const d = maxDim * 2.0;
    const n = dir.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(n.y) > 0.95) up.set(0, 0, -1);

    const toPos = new THREE.Vector3(center.x + n.x * d, center.y + n.y * d, center.z + n.z * d);
    const fromPos = this.camera.position.clone();
    const fromTarget = this.orbit.target.clone();

    this.camera = ortho ? this.ortho : this.persp;
    this.camera.up.copy(up);
    if (ortho) {
      this.ortho.zoom = 1;
      this.viewSize = maxDim * 1.3;
      this.updateOrthoFrustum();
    }
    this.orbit.object = this.camera;
    this.orbit.enableRotate = !ortho;
    this.transformControls.camera = this.camera;
    this.view = viewName;

    this.tween = {
      fromPos,
      toPos,
      fromTarget,
      toTarget: center.clone(),
      start: performance.now(),
      duration: 320,
    };
  }

  private updateTween() {
    if (!this.tween) return;
    const raw = (performance.now() - this.tween.start) / this.tween.duration;
    const t = Math.min(1, raw);
    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, e);
    this.orbit.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, e);
    this.camera.lookAt(this.orbit.target);
    if (t >= 1) this.tween = null;
  }

  /**
   * Cambiar entre vistas tipo CAD.
   * - planta / alzado / perfil / isometrica: proyeccion ORTOGRAFICA
   * - 3d: perspectiva libre
   */
  setView(name: ViewName) {
    const dirs: Record<ViewName, THREE.Vector3> = {
      planta: new THREE.Vector3(0, 1, 0),
      alzado: new THREE.Vector3(0, 0, 1),
      perfil: new THREE.Vector3(1, 0, 0),
      isometrica: new THREE.Vector3(1, 1, 1),
      '3d': new THREE.Vector3(1, 0.8, 1),
    };
    this.applyView(name !== '3d', dirs[name], name);
  }

  /** Colocar la camara mirando desde una direccion arbitraria (dado/ViewCube). */
  setViewDirection(x: number, y: number, z: number, ortho = true): ViewName {
    const dir = new THREE.Vector3(x, y, z);
    if (dir.lengthSq() === 0) dir.set(0, 1, 0);
    dir.normalize();
    const name = this.classifyDirection(dir);
    this.applyView(ortho, dir, name);
    return name;
  }

  setTranslationSnap(value: number | null) {
    this.translationSnap = value;
    this.transformControls.setTranslationSnap(value);
  }

  setOrthoMode(enabled: boolean) {
    this.orthoMode = enabled;
  }

  setToolMode(mode: 'select' | 'hand') {
    this.toolMode = mode;
    // En modo Mano el boton izquierdo desplaza la vista (pan), como Figma.
    this.orbit.mouseButtons = {
      LEFT: mode === 'hand' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
  }

  // ============================ Capas / Materiales / Color ============================

  private layerById(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  private materialById(id: string): Material | undefined {
    return this.materials.find((m) => m.id === id);
  }

  setLayers(layers: Layer[], currentLayerId: string) {
    this.layers = layers;
    this.currentLayerId = currentLayerId;
    this.refreshVisibility();
    this.refreshAppearance();
    this.emitSelection();
  }

  setCurrentLayer(id: string) {
    this.currentLayerId = id;
  }

  setMaterials(materials: Material[]) {
    this.materials = materials;
    this.refreshAppearance();
    this.emitSelection();
  }

  setShowTextures(value: boolean) {
    this.showTextures = value;
    this.refreshAppearance();
  }

  private kindOf(mesh: THREE.Mesh): 'wall' | 'door' | 'window' | 'mesh' {
    const n = mesh.name.toLowerCase();
    if (n.startsWith('wall_internal') || n.includes('wall')) return 'wall';
    if (n.includes('door')) return 'door';
    if (n.includes('window')) return 'window';
    return 'mesh';
  }

  private defaultLayerForKind(kind: string): string {
    if (kind === 'wall') return 'layer-paredes';
    if (kind === 'door') return 'layer-puertas';
    if (kind === 'window') return 'layer-ventanas';
    return 'layer-0';
  }

  private initMesh(mesh: THREE.Mesh, layerIdOverride?: string) {
    const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);
    mesh.userData.kind = kind;
    if (layerIdOverride) mesh.userData.layerId = layerIdOverride;
    else if (!mesh.userData.layerId) mesh.userData.layerId = this.defaultLayerForKind(kind);
    if (mesh.userData.color === undefined) mesh.userData.color = 'bylayer';
    if (mesh.userData.materialId === undefined) {
      const name = kind === 'wall' ? 'Ladrillo rojo' : kind === 'door' ? 'Roble' : kind === 'window' ? 'Vidrio transparente' : '';
      mesh.userData.materialId = name ? this.materials.find((m) => m.nombre === name)?.id ?? '' : '';
    }
    if (mesh.userData.elevation === undefined) mesh.userData.elevation = 0;
    if (!mesh.userData.baseDims) {
      mesh.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      mesh.userData.baseDims = {
        thickness: size.x || 0.2,
        height: size.y || 1,
        length: size.z || 1,
      };
    }
    this.ensureEdges(mesh);
  }

  private ensureEdges(mesh: THREE.Mesh) {
    mesh.children.filter((c) => c.name === '__edges').forEach((c) => mesh.remove(c));
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry as THREE.BufferGeometry, 30),
      new THREE.LineBasicMaterial({ color: 0x0b1220, transparent: true, opacity: 0.9 }),
    );
    edges.name = '__edges';
    edges.renderOrder = 2;
    mesh.add(edges);
  }

  private initAllMeshes() {
    this.allMeshes().forEach((mesh) => this.initMesh(mesh));
  }

  private isLocked(mesh: THREE.Mesh): boolean {
    return Boolean(this.layerById(mesh.userData.layerId)?.bloqueada);
  }

  private selectableMeshes(): THREE.Mesh[] {
    return this.allMeshes().filter((mesh) => mesh.visible && !this.isLocked(mesh));
  }

  private refreshVisibility() {
    this.allMeshes().forEach((mesh) => {
      const layer = this.layerById(mesh.userData.layerId);
      mesh.visible = layer ? layer.visible && !layer.congelada : true;
    });
  }

  private textureFor(url?: string): THREE.Texture | null {
    if (!url) return null;
    const cached = this.textureCache.get(url);
    if (cached) return cached;
    const texture = this.textureLoader.load(url);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textureCache.set(url, texture);
    return texture;
  }

  private applyMeshAppearance(mesh: THREE.Mesh) {
    const layer = this.layerById(mesh.userData.layerId);
    const raw = (mesh.userData.color as string) ?? 'bylayer';
    const effectiveColor = raw !== 'bylayer' ? raw : layer?.color ?? '#9aa4b2';
    const transparency = layer?.transparencia ?? 0;
    const material = this.showTextures ? this.materialById(mesh.userData.materialId) : undefined;

    if (material) {
      const map = this.textureFor(material.textura_url);
      if (map) map.repeat.set(material.escala_textura[0], material.escala_textura[1]);
      mesh.material = new THREE.MeshStandardMaterial({
        map: map ?? null,
        color: new THREE.Color(map ? '#ffffff' : material.color_difuso),
        roughness: material.rugosidad,
        metalness: material.metalico,
        transparent: material.opacidad < 1 || transparency > 0,
        opacity: material.opacidad * (1 - transparency / 100),
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    } else {
      mesh.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(effectiveColor),
        roughness: 0.9,
        metalness: 0.05,
        transparent: transparency > 0,
        opacity: 1 - transparency / 100,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    }
    (mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
  }

  private refreshAppearance() {
    this.allMeshes().forEach((mesh) => this.applyMeshAppearance(mesh));
  }

  setSelectedLayer(id: string) {
    if (this.selection.length === 0) return;
    this.selection.forEach((mesh) => (mesh.userData.layerId = id));
    this.refreshVisibility();
    this.refreshAppearance();
    this.emitSelection();
  }

  setSelectedColorOverride(value: string) {
    if (this.selection.length === 0) return;
    this.selection.forEach((mesh) => (mesh.userData.color = value));
    this.refreshAppearance();
    this.emitSelection();
  }

  setSelectedMaterial(id: string) {
    if (this.selection.length === 0) return;
    this.selection.forEach((mesh) => (mesh.userData.materialId = id));
    this.refreshAppearance();
    this.emitSelection();
  }

  setSelectedElevation(y: number) {
    if (this.selection.length === 0) return;
    const first = this.selected as THREE.Mesh;
    const delta = y - ((first.userData.elevation as number) ?? 0);
    this.selection.forEach((mesh) => {
      mesh.position.y += delta;
      mesh.userData.elevation = y;
      mesh.updateMatrix();
    });
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  setSelectedDimension(field: 'height' | 'thickness' | 'length' | 'width', value: number) {
    if (!this.selected) return;
    const mesh = this.selected;
    const base = (mesh.userData.baseDims as { thickness: number; height: number; length: number }) ?? {
      thickness: 1,
      height: 1,
      length: 1,
    };
    if (field === 'height') mesh.scale.y = value / (base.height || 1);
    else if (field === 'thickness') mesh.scale.x = value / (base.thickness || 1);
    else mesh.scale.z = value / (base.length || 1);
    mesh.updateMatrix();
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  setDraftListener(listener: (info: { type: ElementType; length: number } | null) => void) {
    this.onDraft = listener;
  }

  setMarqueeListener(
    listener: (rect: { x: number; y: number; w: number; h: number } | null) => void,
  ) {
    this.onMarquee = listener;
  }

  setRotationSnap(value: number | null) {
    this.transformControls.setRotationSnap(value ? THREE.MathUtils.degToRad(value) : null);
  }

  startCreate(type: ElementType) {
    this.cancelDraft();
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
    if (this.selection.length === 0 || !this.model) return;
    const meshes = [...this.selection];
    this.transformControls.detach();
    meshes.forEach((mesh) => this.model?.removeElement(mesh));
    this.selection = [];
    this.selected = null;
    this.onSelection(null);
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
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  updateRotation(axis: 'x' | 'y' | 'z', deg: number) {
    if (!this.selected) return;
    this.selected.rotation[axis] = THREE.MathUtils.degToRad(deg);
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  updateScale(axis: 'x' | 'y' | 'z', value: number) {
    if (!this.selected) return;
    this.selected.scale[axis] = value;
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  resetScale() {
    if (!this.selected) return;
    this.selected.scale.set(1, 1, 1);
    this.clampSelectionToFloor();
    this.syncPivot();
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
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
    this.transformControls.detach();
    this.transformControls.dispose();
    this.orbit.dispose();
    this.model?.dispose();
    this.renderer.dispose();
  }
}

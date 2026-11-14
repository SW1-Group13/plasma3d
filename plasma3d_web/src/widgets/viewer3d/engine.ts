import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  MEASURE_COLORS,
  measureMesh,
  openingVertical,
  pieceAxis,
  pieceQuantities,
  type MeasureDetail,
  type MeasureKind,
  type MeasureUnit,
} from '@/widgets/viewer3d/measurements';
import {
  Modelo3D,
  buildDoorGeometry,
  buildWindowFrameGeometry,
  classifyMeshName,
  type ElementType,
  type ModelSummary,
} from '@/entities/model3D/three/Modelo3D';
import {
  ensurePlanarUVs,
  horizontalRepeatFor,
  textureRepeatFor,
} from '@/entities/model3D/three/uv';
import {
  DOOR_HEIGHT_M,
  ROOF_THICKNESS_M,
  SLAB_THICKNESS_M,
  WALL_HEIGHT_M,
  WALL_THICKNESS_M,
  WINDOW_HEIGHT_M,
  WINDOW_SILL_M,
} from '@/entities/model3D/three/dimensions';
import type { Layer } from '@/entities/layers/types';
import type { Material } from '@/entities/materials/types';

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type ViewName = 'planta' | 'alzado' | 'perfil' | 'isometrica' | '3d';
/** Cómo se muestra el techo generado en el editor (solo vista, no se borra). */
export type RoofMode = 'visible' | 'transparente' | 'oculto';
/** Medidas de una puerta/ventana (metros). */
export interface OpeningDims {
  ancho: number;
  alto: number;
  alfeizar: number;
  espesor: number;
}

/** Lo que se puede dibujar desde la paleta: segmentos o rectángulos. */
export type DrawType = ElementType | 'floor' | 'roof';
export type RoofDrawKind = 'plano' | 'dos_aguas';
export interface DraftInfo {
  type: DrawType;
  length: number;
  /** Solo en rectángulos (piso/techo): ancho (X) y largo (Z) en metros. */
  width?: number;
  depth?: number;
}

/** Material del catálogo que recibe cada tipo de pieza al crearse. */
const DEFAULT_MATERIAL_BY_KIND: Record<MeasureKind, string> = {
  wall: 'Ladrillo rojo',
  door: 'Roble',
  window: 'Vidrio transparente',
  floor: 'Ceramica piso',
  roof: 'Cemento', // se tiñe con el color terracota de la capa Techos
};

function isRectType(type: DrawType): type is 'floor' | 'roof' {
  return type === 'floor' || type === 'roof';
}

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
  private roofMode: RoofMode = 'visible';
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
  public creating: DrawType | null = null;
  private roofDrawKind: RoofDrawKind = 'plano';
  private onSelection: SelectionListener = () => {};
  private onDraft: (info: DraftInfo | null) => void = () => {};
  private onMarquee: (rect: { x: number; y: number; w: number; h: number } | null) => void = () => {};
  private drafting: { type: DrawType; start: THREE.Vector3; current: THREE.Vector3 } | null = null;
  private preview: THREE.Mesh | null = null;
  private orthoMode = false;
  private lockVertical = false;
  private multiSelect = false;
  private translationSnap: number | null = null;
  private pivot = new THREE.Object3D();
  private dragStart: { pivot: THREE.Matrix4; meshes: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] } | null = null;
  private marqueeStart: { x: number; y: number } | null = null;
  private marqueeActive = false;
  private toolMode: 'select' | 'hand' = 'select';

  private pointerDown = { x: 0, y: 0, button: -1 };
  private justDraggedAt = 0;
  private resizeObserver: ResizeObserver;

  // Cotas (etiquetas HTML que siguen a las piezas)
  private labelRenderer: CSS2DRenderer;
  private measureGroup = new THREE.Group();
  private measureLabels = new Map<THREE.Mesh, { label: CSS2DObject; line: THREE.LineSegments }>();
  private measureRay = new THREE.Raycaster();
  private measureDetail: MeasureDetail = 'largo';
  private measureUnit: MeasureUnit = 'm';
  private measureKinds = new Set<MeasureKind>();
  private measureFrame = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const { clientWidth: w, clientHeight: h } = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Nítido en pantallas de alta densidad (celulares) sin pasar de 2x.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
      else {
        this.dragStart = null;
        // Escalar un vano: convertir la escala en medidas reales y
        // reconstruirlo (si no, el marco y la cruz quedan deformados).
        if (this.transformControls.mode === 'scale') {
          this.selection
            .filter((m) => this.isOpening(m) && (Math.abs(m.scale.x - 1) > 1e-3 || Math.abs(m.scale.y - 1) > 1e-3 || Math.abs(m.scale.z - 1) > 1e-3))
            .forEach((m) => this.rebuildOpening(m, this.openingDims(m)));
        }
      }
    });

    this.transformControls.addEventListener('objectChange', () => {
      this.applyTransformDelta();
    });

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: true });

    // Capa HTML de cotas sobre el canvas; no captura clics.
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    const labelDom = this.labelRenderer.domElement;
    labelDom.style.position = 'absolute';
    labelDom.style.inset = '0';
    labelDom.style.pointerEvents = 'none';
    labelDom.style.zIndex = '10';
    canvas.parentElement?.appendChild(labelDom);
    this.measureGroup.name = '__measures';
    this.scene.add(this.measureGroup);

    this.renderer.setAnimationLoop(() => {
      if (this.tween) {
        this.updateTween();
      } else {
        this.orbit.update();
      }
      // Refresco periódico: cubre mover/escalar/dibujar/borrar/capas sin
      // cablear cada evento.
      if (this.measureKinds.size > 0 && ++this.measureFrame % 10 === 0) this.refreshMeasures();
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
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
    this.labelRenderer.setSize(clientWidth, clientHeight);
    const aspect = clientWidth / clientHeight;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    this.updateOrthoFrustum();
  }

  /**
   * Cancela un dibujo o un marco a medio hacer y devuelve la cámara al usuario
   * (2º dedo = gesto de zoom/pan, o el sistema canceló el toque).
   */
  private abortGesture() {
    if (this.drafting) this.cancelDraft();
    if (this.marqueeStart) {
      this.marqueeStart = null;
      this.marqueeActive = false;
      this.onMarquee(null);
    }
    this.orbit.enabled = true;
  }

  private onPointerCancel = () => this.abortGesture();

  private onPointerDown = (event: PointerEvent) => {
    // Un 2º dedo no dibuja ni selecciona: pasa a ser zoom/paneo de la cámara.
    if (!event.isPrimary) {
      this.abortGesture();
      return;
    }
    // Gizmo de mover/rotar más grande con el dedo.
    this.transformControls.size = event.pointerType === 'touch' ? 1.6 : 1;
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

    // Seleccion por rectangulo: solo en vistas fijas (ortograficas, sin rotacion).
    // Con el dedo, arrastrar mueve el plano; el marco solo con Multiselección.
    const touch = event.pointerType === 'touch';
    if (!this.orbit.enableRotate && this.model && (!touch || this.multiSelect)) {
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
    if (!event.isPrimary) return;
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
    if (!event.isPrimary) return;
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
        this.selectInRect(
          start,
          { x: event.clientX, y: event.clientY },
          event.ctrlKey || event.metaKey || this.multiSelect,
        );
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
      // La losa de piso vive bajo y=0 (su cara superior es el nivel 0).
      if (((mesh.userData.kind as string) ?? this.kindOf(mesh)) === 'floor') return;
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
    const { type, start } = this.drafting;
    // Los rectángulos (piso/techo) no usan orto: las dos esquinas son libres.
    const end = isRectType(type)
      ? new THREE.Vector3(point.x, start.y, point.z)
      : this.constrainPoint(point, start, orthoOverride);
    this.drafting.current = end;
    this.updatePreview();
    this.onDraft({
      type,
      length: end.distanceTo(start),
      ...(isRectType(type)
        ? { width: Math.abs(end.x - start.x), depth: Math.abs(end.z - start.z) }
        : {}),
    });
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
    if (type === 'wall') return { thickness: WALL_THICKNESS_M, height: WALL_HEIGHT_M, sill: 0 };
    if (type === 'door') return { thickness: 0.2, height: DOOR_HEIGHT_M, sill: 0 };
    return { thickness: 0.2, height: WINDOW_HEIGHT_M, sill: WINDOW_SILL_M };
  }

  private updatePreview() {
    if (!this.preview || !this.drafting) return;
    const { type, start, current } = this.drafting;
    if (isRectType(type)) {
      const w = Math.abs(current.x - start.x);
      const d = Math.abs(current.z - start.z);
      if (w < 0.001 || d < 0.001) {
        this.preview.visible = false;
        return;
      }
      const thickness = type === 'floor' ? SLAB_THICKNESS_M : ROOF_THICKNESS_M;
      const y = type === 'floor' ? -SLAB_THICKNESS_M / 2 : WALL_HEIGHT_M + ROOF_THICKNESS_M / 2;
      this.preview.visible = true;
      this.preview.scale.set(w, thickness, d);
      this.preview.position.set((start.x + current.x) / 2, y, (start.z + current.z) / 2);
      this.preview.rotation.y = 0;
      return;
    }
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
    const type = this.drafting.type;
    const end = isRectType(type)
      ? new THREE.Vector3(point.x, start.y, point.z)
      : this.constrainPoint(point, start, orthoOverride);

    this.drafting = null;
    if (this.preview) this.preview.visible = false;
    this.orbit.enabled = true;
    this.creating = null;
    this.onDraft(null);

    if (isRectType(type)) {
      const parent = this.model.getObject3D();
      parent.updateMatrixWorld(true);
      const slab = this.model.createSlab(
        type,
        parent.worldToLocal(start.clone()),
        parent.worldToLocal(end.clone()),
        this.roofDrawKind,
      );
      if (slab) {
        this.initMesh(slab);
        this.refreshVisibility();
        this.refreshAppearance();
        // Un techo transparente/oculto no se puede seleccionar: solo avisar.
        if (this.selectableMeshes().includes(slab)) this.select(slab);
        else this.emitSelection();
      }
      return;
    }

    if (end.distanceTo(start) < 0.2) return;
    const dims = this.elementDims(type);
    // Los puntos vienen en coordenadas de mundo, pero los elementos se agregan
    // como hijos del objeto del modelo (que puede tener offset/escala).
    const parent = this.model.getObject3D();
    parent.updateMatrixWorld(true);
    const startLocal = parent.worldToLocal(start.clone());
    const endLocal = parent.worldToLocal(end.clone());
    const mesh = this.model.createElementSegment(
      type,
      startLocal,
      endLocal,
      dims.thickness,
      dims.height,
      dims.sill,
    );
    if (mesh) {
      // Asignar la capa segun el tipo (Paredes/Puertas/Ventanas) para que
      // `bylayer` tome el color correcto desde el momento de dibujarlo.
      this.initMesh(mesh);
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
      if (event.ctrlKey || event.metaKey || this.multiSelect) {
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
    return [
      ...this.model.getWalls(),
      ...this.model.getDoors(),
      ...this.model.getWindows(),
      ...this.model.getFloors(),
      ...this.model.getRoofs(),
    ];
  }

  /** Piso y techo son estructura generada: se seleccionan pero no se transforman. */
  private isStructural(mesh: THREE.Mesh): boolean {
    const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);
    return kind === 'floor' || kind === 'roof';
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
    // Resaltar al instante la cota de lo seleccionado.
    if (this.measureKinds.size > 0) this.refreshMeasures();
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

    const layer = this.resolveLayer(mesh);
    const raw = (mesh.userData.color as string) ?? 'bylayer';
    const effectiveColor = raw && raw !== 'bylayer' ? raw : layer?.color ?? '#9aa4b2';
    const base = (mesh.userData.baseDims as { thickness: number; height: number; length: number }) ?? {
      thickness: size.x,
      height: size.y,
      length: size.z,
    };

    // Vanos: mostrar sus medidas reales (ancho, alto, alféizar, espesor)
    const od = this.isOpening(mesh) ? this.openingDims(mesh) : null;

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
      length: od ? od.ancho : base.length,
      angle: THREE.MathUtils.radToDeg(mesh.rotation.y),
      thickness: od ? od.espesor : base.thickness,
      height: od ? od.alto : base.height * mesh.scale.y,
      width: od ? od.ancho : base.length * mesh.scale.z,
      sill: od ? od.alfeizar : (mesh.userData.elevation as number) ?? 0,
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
    // Shift: bloquear el movimiento vertical (arriba/abajo) al trasladar.
    if (this.lockVertical && this.transformControls.mode === 'translate') {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      delta.decompose(pos, quat, scale);
      pos.y = 0;
      delta.compose(pos, quat, scale);
    }
    this.dragStart.meshes.forEach(({ mesh, matrix }) => {
      const next = new THREE.Matrix4().multiplyMatrices(delta, matrix);
      next.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrix();
    });
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  loadModel(url: string | null, textures: { name: string; url: string }[], onLoaded?: () => void) {
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
    this.transformControls.showY = !(this.lockVertical && mode === 'translate');
  }

  setLockVertical(value: boolean) {
    this.lockVertical = value;
    if (this.transformControls.mode === 'translate') {
      this.transformControls.showY = !value;
    }
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
    this.updateTouchGestures();
    this.transformControls.camera = this.camera;
    this.view = viewName;
    this.refreshVisibility();
    this.refreshAppearance();

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
    this.updateTouchGestures();
  }

  /** Multiselección táctil: reemplaza a Ctrl+clic y habilita el marco con el dedo. */
  setMultiSelect(value: boolean) {
    this.multiSelect = value;
  }

  /**
   * Gestos con el dedo: 1 dedo rota en 3D y desplaza el plano en vistas fijas
   * (o en modo Mano); 2 dedos hacen zoom + desplazamiento.
   */
  private updateTouchGestures() {
    const panOneFinger = this.toolMode === 'hand' || !this.orbit.enableRotate;
    this.orbit.touches = {
      ONE: panOneFinger ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
  }

  // ============================ Capas / Materiales / Color ============================

  private layerById(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  private layerNameForKind(kind: string): string {
    if (kind === 'wall') return 'Paredes';
    if (kind === 'door') return 'Puertas';
    if (kind === 'window') return 'Ventanas';
    if (kind === 'floor') return 'Pisos';
    if (kind === 'roof') return 'Techos';
    return '';
  }

  /**
   * Resuelve la capa de una malla. Si su id quedo obsoleto (p.ej. tras
   * reemplazar las capas fallback por las del backend), la reasigna por
   * nombre para que `bylayer` siga tomando el color correcto.
   */
  private resolveLayer(mesh: THREE.Mesh): Layer | undefined {
    const direct = this.layerById(mesh.userData.layerId);
    if (direct) return direct;

    const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);
    const name = (mesh.userData.layerName as string) || this.layerNameForKind(kind);
    const found = this.layers.find((l) => l.nombre === name);
    if (found) {
      mesh.userData.layerId = found.id;
      mesh.userData.layerName = found.nombre;
    }
    return found;
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

  private kindOf(mesh: THREE.Mesh): 'wall' | 'door' | 'window' | 'floor' | 'roof' | 'mesh' {
    return classifyMeshName(mesh.name) ?? 'mesh';
  }

  private defaultLayerForKind(kind: string): string {
    const name = this.layerNameForKind(kind);
    const layer = this.layers.find((l) => l.nombre === name);
    return layer?.id ?? this.currentLayerId ?? '';
  }

  private initMesh(mesh: THREE.Mesh, layerIdOverride?: string) {
    const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);
    mesh.userData.kind = kind;
    if (layerIdOverride) mesh.userData.layerId = layerIdOverride;
    else if (!mesh.userData.layerId) mesh.userData.layerId = this.defaultLayerForKind(kind);
    const layer = this.layerById(mesh.userData.layerId);
    if (layer) mesh.userData.layerName = layer.nombre;
    if (mesh.userData.color === undefined) mesh.userData.color = 'bylayer';
    if (mesh.userData.materialId === undefined) {
      const name = DEFAULT_MATERIAL_BY_KIND[kind as MeasureKind] ?? '';
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
    return Boolean(this.resolveLayer(mesh)?.bloqueada);
  }

  private isRoof(mesh: THREE.Mesh): boolean {
    return ((mesh.userData.kind as string) ?? this.kindOf(mesh)) === 'roof';
  }

  private selectableMeshes(): THREE.Mesh[] {
    return this.allMeshes().filter(
      (mesh) =>
        mesh.visible &&
        !this.isLocked(mesh) &&
        // Techo transparente/oculto (o en Planta): el clic lo atraviesa.
        !(this.isRoof(mesh) && this.roofSeeThrough()),
    );
  }

  /** El techo se dibuja traslúcido y no captura clics. */
  private roofSeeThrough(): boolean {
    return this.roofMode !== 'visible' || this.view === 'planta';
  }

  setRoofDrawKind(kind: RoofDrawKind) {
    this.roofDrawKind = kind;
  }

  // ============================ Cotas ============================

  setMeasureConfig(unit: MeasureUnit, kinds: MeasureKind[], detail: MeasureDetail = 'largo') {
    this.measureUnit = unit;
    this.measureKinds = new Set(kinds);
    this.measureDetail = detail;
    this.refreshMeasures();
  }

  /**
   * ¿Otra pieza tapa el punto `anchor` (de `owner`) desde la cámara?
   * Funciona con cámara en perspectiva y ortográfica (rayo por NDC).
   */
  private isOccluded(anchor: THREE.Vector3, owner: THREE.Mesh, blockers: THREE.Mesh[]): boolean {
    const ndc = anchor.clone().project(this.camera);
    if (ndc.z > 1) return true; // detrás de la cámara
    this.measureRay.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const target = this.measureRay.ray.origin.distanceTo(anchor);
    const hits = this.measureRay.intersectObjects(blockers, false);
    return hits.some((h) => h.object !== owner && h.distance < target - 0.05);
  }

  private measureKindOf(mesh: THREE.Mesh): MeasureKind | null {
    const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);
    // El relleno de hastiales recorre todo el perímetro: su caja no es un muro.
    if (kind === 'wall' && mesh.name.toLowerCase().includes('gable')) return null;
    return kind === 'wall' || kind === 'door' || kind === 'window' || kind === 'floor' || kind === 'roof'
      ? kind
      : null;
  }

  private refreshMeasures() {
    const wanted = new Set<THREE.Mesh>();
    if (this.measureKinds.size > 0) {
      this.camera.updateMatrixWorld();
      const selected = new Set(this.selection);
      const hasSelection = selected.size > 0;
      // Lo que puede tapar una etiqueta: piezas visibles y opacas.
      const blockers = this.allMeshes().filter(
        (m) => m.visible && !(this.isRoof(m) && this.roofSeeThrough()),
      );

      this.allMeshes().forEach((mesh) => {
        const kind = this.measureKindOf(mesh);
        if (!kind || !this.measureKinds.has(kind) || !mesh.visible) return;
        // En Planta el techo es traslúcido: su etiqueta taparía las del plano.
        if (kind === 'roof' && this.view === 'planta') return;
        wanted.add(mesh);

        const active = selected.has(mesh);
        // Seleccionada: siempre con detalle completo (largo · alto · espesor).
        const { text, anchor, line } = measureMesh(
          mesh,
          kind,
          this.measureUnit,
          active ? 'completo' : this.measureDetail,
        );

        let entry = this.measureLabels.get(mesh);
        if (!entry) {
          const div = document.createElement('div');
          div.className = 'measure-label';
          div.style.setProperty('--m', MEASURE_COLORS[kind]);
          const label = new CSS2DObject(div);
          const lineObj = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: MEASURE_COLORS[kind], transparent: true }),
          );
          lineObj.renderOrder = 3;
          this.measureGroup.add(label, lineObj);
          entry = { label, line: lineObj };
          this.measureLabels.set(mesh, entry);
        }

        const { label, line: lineObj } = entry;
        if (label.element.textContent !== text) label.element.textContent = text;
        label.position.copy(anchor);

        // Línea de cota: muestra de punta a punta lo que mide el número.
        lineObj.geometry.setFromPoints(line);
        lineObj.visible = line.length > 0;
        const lineMat = lineObj.material as THREE.LineBasicMaterial;
        lineMat.color.set(active ? '#ffffff' : MEASURE_COLORS[kind]);
        lineMat.opacity = hasSelection && !active ? 0.35 : 1;

        // Tapada por otra pieza → tenue (salvo la seleccionada).
        const occluded = !active && this.isOccluded(anchor, mesh, blockers);
        const cls = label.element.classList;
        cls.toggle('measure-label--active', active);
        cls.toggle('measure-label--hidden', occluded);
        cls.toggle('measure-label--dim', hasSelection && !active && !occluded);
      });
    }
    this.measureLabels.forEach(({ label, line }, mesh) => {
      if (wanted.has(mesh)) return;
      label.element.remove();
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.measureGroup.remove(label, line);
      this.measureLabels.delete(mesh);
    });
  }

  hasRoof(): boolean {
    return (this.model?.getRoofs().length ?? 0) > 0;
  }

  setRoofMode(mode: RoofMode) {
    this.roofMode = mode;
    if (mode !== 'visible' && this.selection.some((mesh) => this.isRoof(mesh))) {
      this.setSelection(this.selection.filter((mesh) => !this.isRoof(mesh)));
    }
    this.refreshVisibility();
    this.refreshAppearance();
  }

  private refreshVisibility() {
    this.allMeshes().forEach((mesh) => {
      const layer = this.resolveLayer(mesh);
      const layerVisible = layer ? layer.visible && !layer.congelada : true;
      // En Planta el techo se ve traslúcido (ver applyMeshAppearance).
      const hiddenByMode = this.isRoof(mesh) && this.roofMode === 'oculto';
      mesh.visible = layerVisible && !hiddenByMode;
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
    const layer = this.resolveLayer(mesh);
    const raw = (mesh.userData.color as string) ?? 'bylayer';
    const hasOverride = raw !== 'bylayer';
    const effectiveColor = hasOverride ? raw : layer?.color ?? '#9aa4b2';
    const transparency = layer?.transparencia ?? 0;
    const material = this.showTextures ? this.materialById(mesh.userData.materialId) : undefined;
    const prevMaterial = mesh.material as THREE.MeshStandardMaterial | undefined;

    if (material) {
      const base = this.textureFor(material.textura_url);
      let map: THREE.Texture | null = null;
      if (base) {
        ensurePlanarUVs(mesh);
        map = base.clone();
        map.needsUpdate = true;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        const [u, v] = this.isStructural(mesh) ? horizontalRepeatFor(mesh) : textureRepeatFor(mesh);
        map.repeat.set(u * material.escala_textura[0], v * material.escala_textura[1]);
      }
      mesh.material = new THREE.MeshStandardMaterial({
        map,
        color: new THREE.Color(effectiveColor),
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
        roughness: 0.9,        metalness: 0.05,
        transparent: transparency > 0,
        opacity: 1 - transparency / 100,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    }
    const nextMaterial = mesh.material as THREE.MeshStandardMaterial;
    if (this.isRoof(mesh) && this.roofSeeThrough()) {
      nextMaterial.transparent = true;
      nextMaterial.opacity = Math.min(nextMaterial.opacity, 0.25);
      nextMaterial.depthWrite = false; // no tapa el interior al renderizar
    }
    // Ventanas sin textura: que el vidrio se vea como vidrio (no un bloque gris)
    if (!material && this.measureKindOf(mesh) === 'window') {
      nextMaterial.transparent = true;
      nextMaterial.opacity = Math.min(nextMaterial.opacity, 0.5);
    }
    nextMaterial.needsUpdate = true;
    if (prevMaterial && prevMaterial !== nextMaterial) {
      const prevMap = prevMaterial.map;
      if (prevMap && !Array.from(this.textureCache.values()).includes(prevMap)) prevMap.dispose();
      prevMaterial.dispose();
    }
  }

  private refreshAppearance() {
    this.allMeshes().forEach((mesh) => this.applyMeshAppearance(mesh));
  }

  setSelectedLayer(id: string) {
    if (this.selection.length === 0) return;
    const layer = this.layerById(id);
    this.selection.forEach((mesh) => {
      mesh.userData.layerId = id;
      if (layer) mesh.userData.layerName = layer.nombre;
    });
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
    if (this.isOpening(first)) {
      this.rebuildOpening(first, { ...this.openingDims(first), alfeizar: y });
      return;
    }
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

  // ============================ Vanos (puertas / ventanas) ============================

  private isOpening(mesh: THREE.Mesh): boolean {
    const k = this.measureKindOf(mesh);
    return k === 'door' || k === 'window';
  }

  /** Medidas actuales de un vano: ancho (a lo largo del muro), alto, alféizar, espesor. */
  openingDims(mesh: THREE.Mesh): OpeningDims {
    const kind = this.measureKindOf(mesh) === 'window' ? 'window' : 'door';
    const q = pieceQuantities(mesh, kind);
    const v = openingVertical(mesh, kind);
    return { ancho: q.length, alto: v.height, alfeizar: v.sill, espesor: q.thickness };
  }

  /**
   * Reconstruye la geometría del vano con nuevas medidas (marco y cruz no se
   * estiran). `place` permite reubicarlo sobre otro eje (Ajustar al muro).
   */
  rebuildOpening(
    mesh: THREE.Mesh,
    dims: OpeningDims,
    place?: { mid: THREE.Vector3; dir: THREE.Vector3 },
  ) {
    if (!this.model || !this.isOpening(mesh)) return;
    const kind = this.measureKindOf(mesh);
    const d: OpeningDims = {
      ancho: THREE.MathUtils.clamp(dims.ancho, 0.3, 20),
      alto: THREE.MathUtils.clamp(dims.alto, 0.3, WALL_HEIGHT_M),
      alfeizar: THREE.MathUtils.clamp(dims.alfeizar, 0, WALL_HEIGHT_M - 0.3),
      espesor: THREE.MathUtils.clamp(dims.espesor, 0.02, 1.5),
    };
    let mid: THREE.Vector3;
    let dir: THREE.Vector3;
    if (place) {
      ({ mid, dir } = place);
    } else {
      const { a, b } = pieceAxis(mesh);
      mid = a.clone().add(b).multiplyScalar(0.5);
      dir = b.clone().sub(a);
    }
    dir = dir.clone().setY(0);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    dir.normalize();

    const old = mesh.geometry;
    mesh.geometry =
      kind === 'window'
        ? buildWindowFrameGeometry(d.espesor, d.alto, d.ancho)
        : buildDoorGeometry(d.espesor, d.alto, d.ancho);
    old.dispose();

    const parent = mesh.parent ?? this.model.getObject3D();
    parent.updateMatrixWorld(true);
    mesh.position.copy(parent.worldToLocal(new THREE.Vector3(mid.x, d.alfeizar + d.alto / 2, mid.z)));
    mesh.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
    mesh.userData.opening = d;
    mesh.userData.elevation = d.alfeizar;
    mesh.userData.baseDims = { thickness: d.espesor, height: d.alto, length: d.ancho };
    this.ensureEdges(mesh);
    this.applyMeshAppearance(mesh);
    if (this.selection.includes(mesh)) {
      (mesh.material as THREE.MeshStandardMaterial)?.emissive?.setHex(0x2a3550);
      this.syncPivot();
    }
    this.emitSelection();
  }

  /**
   * Ajusta un vano a su muro más cercano: lo gira con el muro, lo centra en su
   * eje y le da su espesor. Con `fill`, estira el vano hasta los muros vecinos
   * si quedan huecos de hasta 30 cm a cada lado.
   */
  snapOpeningToWall(mesh: THREE.Mesh, fill = true): { ok: boolean; mensaje: string; ancho?: number; espesor?: number } {
    if (!this.isOpening(mesh)) return { ok: false, mensaje: 'Selecciona una puerta o ventana.' };
    const dims = this.openingDims(mesh);
    const { a, b } = pieceAxis(mesh);
    const mid = a.clone().add(b).multiplyScalar(0.5);

    const walls = this.allMeshes().filter((m) => this.measureKindOf(m) === 'wall' && m.visible);
    let host: { mesh: THREE.Mesh; a: THREE.Vector3; dir: THREE.Vector3; dist: number } | null = null;
    walls.forEach((w) => {
      const ax = pieceAxis(w);
      const seg = new THREE.Line3(ax.a, ax.b);
      const dist = seg.closestPointToPoint(mid, true, new THREE.Vector3()).distanceTo(mid);
      if (!host || dist < host.dist) {
        host = { mesh: w, a: ax.a, dir: ax.b.clone().sub(ax.a).normalize(), dist };
      }
    });
    const h = host as { mesh: THREE.Mesh; a: THREE.Vector3; dir: THREE.Vector3; dist: number } | null;
    if (!h || h.dist > 1.5) return { ok: false, mensaje: 'No hay un muro a menos de 1.5 m.' };

    const wallThickness = pieceQuantities(h.mesh, 'wall').thickness;
    const normal = new THREE.Vector3(-h.dir.z, 0, h.dir.x);
    const t = mid.clone().sub(h.a).dot(h.dir);
    let s0 = t - dims.ancho / 2;
    let s1 = t + dims.ancho / 2;

    if (fill) {
      const band = wallThickness / 2 + 0.05;
      let left: number | null = null;
      let right: number | null = null;
      // Vecinos: muros y también otras puertas/ventanas (ventana doble)
      const neighbors = [
        ...walls,
        ...this.allMeshes().filter((m) => m !== mesh && m.visible && this.isOpening(m)),
      ];
      neighbors.forEach((w) => {
        const box = new THREE.Box3().setFromObject(w);
        const corners = [
          new THREE.Vector3(box.min.x, 0, box.min.z),
          new THREE.Vector3(box.min.x, 0, box.max.z),
          new THREE.Vector3(box.max.x, 0, box.min.z),
          new THREE.Vector3(box.max.x, 0, box.max.z),
        ].map((c) => c.sub(h.a));
        const along = corners.map((c) => c.dot(h.dir));
        const across = corners.map((c) => c.dot(normal));
        if (Math.max(...across) < -band || Math.min(...across) > band) return; // fuera de la franja
        const p0 = Math.min(...along);
        const p1 = Math.max(...along);
        if (p1 <= s0 + 0.01 && s0 - p1 <= 0.3) left = left === null ? p1 : Math.max(left, p1);
        if (p0 >= s1 - 0.01 && p0 - s1 <= 0.3) right = right === null ? p0 : Math.min(right, p0);
      });
      if (left !== null) s0 = left;
      if (right !== null) s1 = right;
    }

    const ancho = s1 - s0;
    const center = h.a.clone().add(h.dir.clone().multiplyScalar((s0 + s1) / 2));
    this.rebuildOpening(mesh, { ...dims, ancho, espesor: wallThickness }, { mid: center, dir: h.dir });
    return {
      ok: true,
      mensaje: `Ajustada a ${h.mesh.name}: ancho ${ancho.toFixed(2)} m, espesor ${wallThickness.toFixed(2)} m.`,
      ancho,
      espesor: wallThickness,
    };
  }

  /** Ajusta al muro todos los vanos seleccionados. */
  snapSelectedOpenings(fill = true) {
    const results = this.selection.filter((m) => this.isOpening(m)).map((m) => this.snapOpeningToWall(m, fill));
    return results.length ? results : [{ ok: false, mensaje: 'Selecciona una puerta o ventana.' }];
  }

  setSelectedDimension(field: 'height' | 'thickness' | 'length' | 'width', value: number) {
    if (!this.selected) return;
    const mesh = this.selected;
    if (this.isOpening(mesh)) {
      // Vanos: se reconstruyen con la medida nueva (no se estiran con scale).
      const d = this.openingDims(mesh);
      if (field === 'height') d.alto = value;
      else if (field === 'thickness') d.espesor = value;
      else d.ancho = value;
      this.rebuildOpening(mesh, d);
      return;
    }
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

  setDraftListener(listener: (info: DraftInfo | null) => void) {
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

  startCreate(type: DrawType) {
    this.cancelDraft();
    this.creating = type;
  }

  private spawnElementAt(point: THREE.Vector3) {
    if (!this.model || !this.creating || isRectType(this.creating)) return;
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

  /**
   * Resumen para el presupuesto. Corrige lo que `toJSONSummary` no sabe:
   * - material = el del catálogo asignado a la pieza (no se adivina por la
   *   textura, así funciona igual con Texturas ON u OFF);
   * - medidas reales en ejes locales (puertas/ventanas giradas, pendiente).
   */
  /**
   * Resumen compacto del modelo para el Agente IA: por tipo (cantidad, m²,
   * materiales), totales clave y la pieza seleccionada. Medidas en metros;
   * `unidad` indica en qué unidad prefiere ver el usuario las respuestas.
   */
  getAgentContext(): Record<string, unknown> {
    const summary = this.getSummary();
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const piezas: Record<string, { cantidad: number; area_m2: number; largo_total_m: number; materiales: Record<string, number> }> = {};
    (summary?.objects ?? []).forEach((o) => {
      const p = (piezas[o.type] ??= { cantidad: 0, area_m2: 0, largo_total_m: 0, materiales: {} });
      p.cantidad += 1;
      p.area_m2 += o.area ?? 0;
      p.largo_total_m += o.length ?? 0;
      const mat = o.material?.name || 'Sin material';
      p.materiales[mat] = (p.materiales[mat] ?? 0) + 1;
    });
    Object.values(piezas).forEach((p) => {
      p.area_m2 = r2(p.area_m2);
      p.largo_total_m = r2(p.largo_total_m);
    });

    let seleccion: Record<string, unknown> | null = null;
    const mesh = this.selection[0];
    if (mesh) {
      const kind = this.measureKindOf(mesh);
      const q = kind ? pieceQuantities(mesh, kind) : null;
      seleccion = {
        nombre: mesh.name,
        tipo: kind ?? 'otro',
        material: this.materialById(mesh.userData.materialId as string)?.nombre ?? null,
        piezas_seleccionadas: this.selection.length,
        ...(q
          ? {
              largo_m: r2(q.length),
              alto_m: r2(q.height),
              espesor_m: r2(q.thickness),
              area_m2: r2(q.area),
              volumen_m3: r2(q.volume),
            }
          : {}),
      };
    }

    // Ubicación (metros, mundo): límites del plano y eje de cada muro, para que
    // el agente pueda colocar piezas "a la derecha", "sobre el muro norte"...
    const r1 = (n: number) => Math.round(n * 100) / 100;
    const bounds = new THREE.Box3();
    this.allMeshes().forEach((m) => m.visible && bounds.expandByObject(m));
    const limites = bounds.isEmpty()
      ? { min_x: 0, max_x: 0, min_z: 0, max_z: 0, vacio: true }
      : { min_x: r1(bounds.min.x), max_x: r1(bounds.max.x), min_z: r1(bounds.min.z), max_z: r1(bounds.max.z) };
    const ejes = (kind: MeasureKind) =>
      this.allMeshes()
        .filter((m) => this.measureKindOf(m) === kind)
        .slice(0, 80)
        .map((m) => {
          const { a, b } = pieceAxis(m);
          return { nombre: m.name, x1: r1(a.x), z1: r1(a.z), x2: r1(b.x), z2: r1(b.z) };
        });

    return {
      unidad: this.measureUnit,
      vista: this.view,
      tipos: { wall: 'muros', door: 'puertas', window: 'ventanas', floor: 'pisos', roof: 'techos' },
      piezas,
      techo: this.hasRoof() ? 'sí' : 'no',
      limites,
      muros: ejes('wall'),
      puertas: ejes('door'),
      ventanas: ejes('window'),
      seleccion,
      seleccion_nombres: this.selection.map((m) => m.name),
      materiales_catalogo: this.materials.map((m) => m.nombre),
      // Solo lo usa el backend para costos (no se envía al modelo de IA)
      objetos: (summary?.objects ?? []).map((o) => ({
        type: o.type,
        name: o.name,
        material: { name: o.material?.name },
        length: o.length,
        height: o.height,
        thickness: o.thickness,
        area: o.area,
        volume: o.volume,
      })),
    };
  }

  // ============================ API del Agente IA ============================
  // Coordenadas en metros del mundo (las mismas de getAgentContext): x → derecha,
  // z → abajo en Planta, piso en y = 0.

  private agentCounter = 0;

  /** Muro/puerta/ventana de (x1,z1) a (x2,z2). Devuelve la malla creada. */
  agentCreateSegment(
    type: ElementType,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    opts: { thickness?: number; height?: number } = {},
  ): THREE.Mesh | null {
    if (!this.model) return null;
    const dims = this.elementDims(type);
    const parent = this.model.getObject3D();
    parent.updateMatrixWorld(true);
    const a = parent.worldToLocal(new THREE.Vector3(x1, 0, z1));
    const b = parent.worldToLocal(new THREE.Vector3(x2, 0, z2));
    const mesh = this.model.createElementSegment(
      type,
      a,
      b,
      opts.thickness ?? dims.thickness,
      opts.height ?? dims.height,
      dims.sill,
    );
    if (!mesh) return null;
    mesh.name = `${mesh.name}_ia${++this.agentCounter}`; // nombres únicos en lote
    this.initMesh(mesh);
    return mesh;
  }

  /** Piso o techo rectangular entre dos esquinas. */
  agentCreateSlab(
    type: 'floor' | 'roof',
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    roofKind: RoofDrawKind = 'plano',
  ): THREE.Mesh | null {
    if (!this.model) return null;
    const parent = this.model.getObject3D();
    parent.updateMatrixWorld(true);
    const slab = this.model.createSlab(
      type,
      parent.worldToLocal(new THREE.Vector3(x1, 0, z1)),
      parent.worldToLocal(new THREE.Vector3(x2, 0, z2)),
      roofKind,
    );
    if (!slab) return null;
    slab.name = `${slab.name}_ia${++this.agentCounter}`;
    this.initMesh(slab);
    return slab;
  }

  /** Refresca la escena tras cambios del agente y selecciona lo indicado. */
  agentCommit(select: THREE.Mesh[] = []) {
    this.refreshVisibility();
    this.refreshAppearance();
    const visible = select.filter((m) => this.selectableMeshes().includes(m));
    if (visible.length > 0) this.setSelection(visible);
    else this.emitSelection();
  }

  /** Piezas por alcance: 'seleccion', una categoría, o por nombre (parcial). */
  agentFind(scope?: string, nombre?: string): THREE.Mesh[] {
    let meshes = scope === 'seleccion' ? [...this.selection] : this.allMeshes();
    if (scope && scope !== 'seleccion') meshes = meshes.filter((m) => this.measureKindOf(m) === scope);
    if (nombre) {
      const n = nombre.toLowerCase();
      meshes = meshes.filter((m) => m.name.toLowerCase().includes(n));
    }
    return meshes;
  }

  /** Material del catálogo por nombre (exacto, o el que lo contenga). */
  agentMaterialByName(name: string): Material | undefined {
    const n = name.trim().toLowerCase();
    return (
      this.materials.find((m) => m.nombre.toLowerCase() === n) ??
      this.materials.find((m) => m.nombre.toLowerCase().includes(n) || n.includes(m.nombre.toLowerCase()))
    );
  }

  /** Asigna material; devuelve los anteriores para poder deshacer. */
  agentSetMaterial(meshes: THREE.Mesh[], materialId: string): Map<THREE.Mesh, string> {
    const previous = new Map<THREE.Mesh, string>();
    meshes.forEach((m) => {
      previous.set(m, (m.userData.materialId as string) ?? '');
      m.userData.materialId = materialId;
    });
    this.refreshAppearance();
    this.emitSelection();
    return previous;
  }

  agentRestoreMaterials(previous: Map<THREE.Mesh, string>) {
    previous.forEach((id, m) => (m.userData.materialId = id));
    this.refreshAppearance();
    this.emitSelection();
  }

  /** Elimina piezas (las que estaban seleccionadas se deseleccionan). */
  agentRemove(meshes: THREE.Mesh[]) {
    if (!this.model) return;
    const set = new Set(meshes);
    if (this.selection.some((m) => set.has(m))) {
      this.setSelection(this.selection.filter((m) => !set.has(m)));
    }
    meshes.forEach((m) => this.model?.removeElement(m));
    this.emitSelection();
  }

  agentSelect(meshes: THREE.Mesh[]) {
    this.setSelection(meshes.filter((m) => this.selectableMeshes().includes(m)));
  }

  /** ¿La malla sigue en el modelo? (para deshacer con seguridad) */
  agentHas(mesh: THREE.Mesh): boolean {
    return this.allMeshes().includes(mesh);
  }

  getSummary(): ModelSummary | null {
    if (!this.model) return null;
    const summary = this.model.toJSONSummary();
    // toJSONSummary recorre walls, doors, windows, floors, roofs: mismo orden que allMeshes().
    const meshes = this.allMeshes();
    const objects = summary.objects.flatMap((obj, i) => {
      const mesh = meshes[i];
      if (!mesh || mesh.name !== obj.name) return [obj];
      const kind = this.measureKindOf(mesh);
      if (!kind) return []; // p. ej. relleno de hastiales: no es un muro medible
      if (mesh.userData.materialId === undefined) this.initMesh(mesh);
      const catalog = this.materialById(mesh.userData.materialId as string);
      const q = pieceQuantities(mesh, kind);
      return [
        {
          ...obj,
          material: { ...obj.material, name: catalog?.nombre ?? DEFAULT_MATERIAL_BY_KIND[kind] },
          height: q.height,
          length: Number(q.length.toFixed(4)),
          thickness: Number(q.thickness.toFixed(4)),
          area: Number(q.area.toFixed(4)),
          volume: Number(q.volume.toFixed(4)),
        },
      ];
    });
    return { ...summary, objects };
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
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
    this.measureKinds.clear();
    this.refreshMeasures();
    this.labelRenderer.domElement.remove();
    this.transformControls.detach();
    this.transformControls.dispose();
    this.orbit.dispose();
    this.model?.dispose();
    this.renderer.dispose();
  }
}

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
  type WallOpeningCut,
} from '@/entities/model3D/three/Modelo3D';
import {
  ensureBoxUVs,
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
import {
  BRAND_ACCENT,
  createPresentationRig,
  makeBackgroundTexture,
  makePresentationFog,
  type PresentationRig,
} from '@/widgets/viewer3d/presentation';
import { createMaterialEffect } from '@/widgets/viewer3d/materialEffects';
import { patternFor, patternMaps } from '@/widgets/viewer3d/proceduralTextures';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Texturas temporales del modo Animado para piezas sin textura propia
 * (assets de /static/textures, los mismos de `TEXTURES`).
 */
const PRESENTATION_LOOK: Record<string, { url?: string; tint: string }> = {
  // Muros: estuco liso cálido (una textura se estira en los muros generados).
  wall: { tint: '#e8d9bd' },
  floor: { url: '/static/textures/textura_suelo.jpg', tint: '#ffffff' },
  door: { url: '/static/textures/puerta-madera.jpg', tint: '#ffffff' },
  roof: { url: '/static/textures/tablas-desgastadas.jpg', tint: '#c0583a' },
};
/** Mapas de una pieza con textura (la foto del usuario no trae relieve). */
export interface TexturedMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

/** Milisegundos sin tocar la cámara antes de reanudar el giro automático. */
const PRESENTATION_RESUME_MS = 3000;

/** Todo lo que el modo Animado cambia, para dejarlo exactamente como estaba. */
interface PresentationState {
  rig: PresentationRig;
  background: THREE.Scene['background'];
  backgroundTexture: THREE.Texture;
  fog: THREE.Scene['fog'];
  exposure: number;
  shadows: boolean;
  gridVisible: boolean;
  hiddenLights: THREE.Light[];
  camera: THREE.Camera;
  persp: { position: THREE.Vector3; up: THREE.Vector3 };
  ortho: { position: THREE.Vector3; up: THREE.Vector3; zoom: number };
  target: THREE.Vector3;
  enableRotate: boolean;
  autoRotate: boolean;
  autoRotateSpeed: number;
  selection: THREE.Mesh[];
  helperVisible: boolean;
  measuresVisible: boolean;
  labelsDisplay: string;
  /** Material del editor de cada pieza (se restaura al salir). */
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  /** Material de presentación que se le puso a cada pieza. */
  looks: Map<THREE.Mesh, THREE.Material>;
  /** Animación por cuadro de cada pieza (según su material). */
  effects: Map<THREE.Mesh, (time: number) => void>;
  environment: THREE.Scene['environment'];
  envTexture: THREE.Texture;
  reducedMotion: boolean;
  startTime: number;
  resumeTimer?: number;
  onStart: () => void;
  onEnd: () => void;
}

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
  roof: 'Teja de arcilla', // se tiñe con el color terracota de la capa Techos
};

/** Si el material por defecto no está en el catálogo, se usa este. */
const FALLBACK_MATERIAL_BY_KIND: Partial<Record<MeasureKind, string>> = {
  roof: 'Cemento', // catálogos viejos (sin materiales de techo)
};

/** ¿Es el material por defecto de ese tipo de pieza (actual o anterior)? */
function isDefaultMaterial(kind: MeasureKind, nombre: string): boolean {
  return DEFAULT_MATERIAL_BY_KIND[kind] === nombre || FALLBACK_MATERIAL_BY_KIND[kind] === nombre;
}

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
type HandleId = 'len+' | 'len-' | 'side' | 'top';

/** Encaje calculado por el botón "Colocar" (paredes y pisos). */
type SnapPlan = {
  mesh: THREE.Mesh;
  kind: 'wall' | 'floor';
  rotate: number;
  center: THREE.Vector3;
  along: number;
  across: number;
  dy: number;
  oldMid: THREE.Vector3;
  shift: THREE.Vector3;
};

type SceneSnapshot = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  userData: Record<string, unknown>;
  material: THREE.Material | THREE.Material[];
}[];

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
  /** Copias de texturas que esperan a que su imagen termine de cargar. */
  private pendingTextureCopies = new Map<string, THREE.Texture[]>();
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
  private dragStart: { pivotWorld: THREE.Matrix4; meshes: { mesh: THREE.Mesh; matrixWorld: THREE.Matrix4 }[] } | null = null;
  private marqueeStart: { x: number; y: number } | null = null;
  private undoStack: SceneSnapshot[] = [];
  private redoStack: SceneSnapshot[] = [];
  private lastUndoKey: { key: string; at: number } | null = null;
  private cutMode = false;
  private mode: TransformMode = 'translate';
  private allowVertical = false;
  private handles = new THREE.Group();
  private handleDrag: {
    mesh: THREE.Mesh;
    id: HandleId;
    plane: THREE.Plane;
    startBox: THREE.Box3;
    startPos: THREE.Vector3;
    startQuat: THREE.Quaternion;
    startWorld: THREE.Matrix4;
    startInv: THREE.Matrix4;
    opening: OpeningDims | null;
    L: 'x' | 'z';
    T: 'x' | 'z';
  } | null = null;
  private moveDrag: {
    x: number;
    y: number;
    active: boolean;
    plane: THREE.Plane;
    start: THREE.Vector3;
    items: { mesh: THREE.Mesh; pos: THREE.Vector3 }[];
  } | null = null;
  private onChange: () => void = () => {};
  private onHistory: (info: { canUndo: boolean; canRedo: boolean; cutMode: boolean }) => void = () => {};
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

  // Modo Animado (presentación): solo vista, se revierte por completo.
  private presentation: PresentationState | null = null;
  private onPresentation: (on: boolean) => void = () => {};

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
      if (dragging) {
        this.pushUndo();
        this.captureTransformStart();
      } else {
        this.dragStart = null;
        this.clampSelectionToFloor();
        this.syncPivot();
        this.selection.forEach((mesh) => this.refreshHostedWallForOpening(mesh, true));
        this.emitSelection();
        // Escalar un vano: convertir la escala en medidas reales y
        // reconstruirlo (si no, el marco y la cruz quedan deformados).
        if (this.transformControls.mode === 'scale') {
          this.selection
            .filter((m) => this.isOpening(m) && (Math.abs(m.scale.x - 1) > 1e-3 || Math.abs(m.scale.y - 1) > 1e-3 || Math.abs(m.scale.z - 1) > 1e-3))
            .forEach((m) => this.rebuildOpening(m, this.openingDims(m)));
          // Paredes/pisos: la escala se convierte en medidas reales (sin estirar).
          this.selection.filter((m) => this.isBoxPiece(m)).forEach((m) => this.bakeScale(m));
          this.syncPivot();
          this.emitSelection();
        }
      }
    });

    this.transformControls.addEventListener('objectChange', () => {
      // Una sola pieza se transforma directamente: evita duplicar el delta
      // entre el objeto y un pivote auxiliar, especialmente en piezas recién creadas.
      if (this.selection.length === 1) {
        this.refreshHostedWallForOpening(this.selection[0], false);
        this.emitSelection();
        return;
      }
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
      this.updatePresentationEffects();
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
    // Modo Animado: solo se mira (rotar/zoom los maneja OrbitControls).
    if (this.presentation) {
      this.tween = null;
      return;
    }
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

    if (!this.cutMode && this.beginHandleDrag(event)) return;
    if (!this.cutMode && this.beginMoveDrag(event)) return;

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
    if (!event.isPrimary || this.presentation) return;
    if (this.handleDrag) {
      this.updateHandleDrag(event);
      return;
    }
    if (this.moveDrag) {
      this.updateMoveDrag(event);
      return;
    }
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
    if (!event.isPrimary || this.presentation) return;
    if (this.handleDrag) {
      this.endHandleDrag();
      return;
    }
    if (this.endMoveDrag()) return;
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
        const worldPosition = mesh.getWorldPosition(new THREE.Vector3());
        worldPosition.y += -box.min.y;
        if (mesh.parent) {
          mesh.parent.updateWorldMatrix(true, false);
          mesh.position.copy(mesh.parent.worldToLocal(worldPosition));
        } else {
          mesh.position.copy(worldPosition);
        }
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

    this.pushUndo();
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

    if (this.cutMode) {
      const hit = intersects.find((h) => this.isBoxPiece(h.object as THREE.Mesh));
      if (hit) this.cutAt(hit.object as THREE.Mesh, hit.point, event.shiftKey);
      return;
    }

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
    this.selection.forEach((mesh) => {
      mesh.updateWorldMatrix(true, false);
      centroid.add(mesh.getWorldPosition(new THREE.Vector3()));
    });
    centroid.multiplyScalar(1 / this.selection.length);
    const parentQuat = new THREE.Quaternion();
    if (this.pivot.parent) {
      this.pivot.parent.updateWorldMatrix(true, false);
      this.pivot.position.copy(this.pivot.parent.worldToLocal(centroid));
      this.pivot.parent.getWorldQuaternion(parentQuat);
    } else {
      this.pivot.position.copy(centroid);
    }
    // Una sola pieza: los ejes del gizmo siguen a la pieza (pared girada).
    if (this.selection.length === 1) {
      const worldQuat = this.selection[0].getWorldQuaternion(new THREE.Quaternion());
      this.pivot.quaternion.copy(parentQuat.invert().multiply(worldQuat));
    } else {
      this.pivot.quaternion.identity();
    }
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

    this.dragStart = null;
    this.refreshGizmo();
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
    if (!this.handleDrag) this.refreshHandles();
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
    this.pivot.updateWorldMatrix(true, false);
    this.dragStart = {
      pivotWorld: this.pivot.matrixWorld.clone(),
      meshes: this.selection.map((mesh) => {
        mesh.updateWorldMatrix(true, false);
        return { mesh, matrixWorld: mesh.matrixWorld.clone() };
      }),
    };
  }

  private applyTransformDelta() {
    if (!this.dragStart) return;
    this.pivot.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().copy(this.dragStart.pivotWorld).invert();
    const deltaWorld = new THREE.Matrix4().multiplyMatrices(this.pivot.matrixWorld, inverse);
    // Mover: sin altura salvo con Alt (y nunca con Shift).
    if ((this.lockVertical || !this.allowVertical) && this.transformControls.mode === 'translate') {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      deltaWorld.decompose(pos, quat, scale);
      pos.y = 0;
      deltaWorld.compose(pos, quat, scale);
    }
    this.dragStart.meshes.forEach(({ mesh, matrixWorld }) => {
      const nextWorld = new THREE.Matrix4().multiplyMatrices(deltaWorld, matrixWorld);
      const parent = mesh.parent;
      if (parent) parent.updateWorldMatrix(true, false);
      const nextLocal = parent
        ? new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(nextWorld)
        : nextWorld;
      nextLocal.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrix();
    });
    // Sin empujar al piso mientras se arrastra (eso hacía "dispararse" la pieza);
    // se corrige al soltar.
    this.selection.forEach((mesh) => this.refreshHostedWallForOpening(mesh, false));
    this.emitSelection();
  }

  loadModel(url: string | null, textures: { name: string; url: string }[], onLoaded?: () => void) {
    this.setPresentationMode(false);
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
        this.repairMaterialIds();
        this.refreshVisibility();
        this.refreshAppearance();
        onLoaded?.();
      },
    );
  }

  setMode(mode: TransformMode) {
    this.mode = mode;
    this.transformControls.setMode(mode);
    this.updateShowY();
    this.refreshGizmo();
  }

  setLockVertical(value: boolean) {
    this.lockVertical = value;
    this.updateShowY();
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
    // Cambiar de vista sale del modo Animado (restaura la escena primero).
    this.setPresentationMode(false);
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
    this.repairMaterialIds();
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
      const byName = (name?: string) => (name ? this.materials.find((m) => m.nombre === name)?.id : undefined);
      mesh.userData.materialId =
        byName(DEFAULT_MATERIAL_BY_KIND[kind as MeasureKind]) ?? byName(FALLBACK_MATERIAL_BY_KIND[kind as MeasureKind]) ?? '';
      // Catálogo aún sin cargar: se completa en repairMaterialIds().
      if (!mesh.userData.materialId && this.materials.length === 0) mesh.userData.materialPending = true;
    }
    if (mesh.userData.elevation === undefined) mesh.userData.elevation = 0;
    if (!mesh.userData.elementId) mesh.userData.elementId = THREE.MathUtils.generateUUID();
    if (!mesh.userData.baseDims) {
      mesh.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      mesh.userData.baseDims = {
        thickness: size.x || 0.2,
        height: size.y || 1,
        length: size.z || 1,
      };
    }
    if (!mesh.userData.originalBox) {
      const b = this.localBox(mesh);
      const s = mesh.scale;
      mesh.userData.originalBox = {
        min: [b.min.x * s.x, b.min.y * s.y, b.min.z * s.z],
        max: [b.max.x * s.x, b.max.y * s.y, b.max.z * s.z],
      };
      if (this.isOpening(mesh)) mesh.userData.originalOpening = { ...this.openingDims(mesh) };
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

  /** Copia de una textura que se refresca sola cuando la imagen termina de cargar. */
  private textureCopy(url: string): THREE.Texture | null {
    const base = this.textureFor(url);
    if (!base) return null;
    const copy = base.clone();
    const image = base.image as { width?: number } | undefined;
    if (image?.width) {
      copy.needsUpdate = true;
    } else {
      const waiting = this.pendingTextureCopies.get(url) ?? [];
      waiting.push(copy);
      this.pendingTextureCopies.set(url, waiting);
    }
    return copy;
  }

  private textureFor(url?: string): THREE.Texture | null {
    if (!url) return null;
    const cached = this.textureCache.get(url);
    if (cached) return cached;
    const texture = this.textureLoader.load(url, () => {
      this.pendingTextureCopies.get(url)?.forEach((copy) => (copy.needsUpdate = true));
      this.pendingTextureCopies.delete(url);
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textureCache.set(url, texture);
    return texture;
  }

  /**
   * Material que debe verse aunque Texturas esté OFF: el elegido por el
   * usuario (o el agente) o cualquiera distinto del de por defecto. El de por
   * defecto sin elegir conserva el color de la capa (aspecto de siempre).
   */
  private visibleMaterial(mesh: THREE.Mesh): Material | undefined {
    const material = this.materialById(mesh.userData.materialId);
    if (!material) return undefined;
    if (mesh.userData.materialExplicit) return material;
    const kind = ((mesh.userData.kind as string) ?? this.kindOf(mesh)) as MeasureKind;
    return isDefaultMaterial(kind, material.nombre) ? undefined : material;
  }

  /**
   * Color base del patrón: el propio del usuario, el de la capa para el techo
   * por defecto (terracota/café) o el del material.
   */
  private patternColor(mesh: THREE.Mesh, material: Material): string {
    const raw = (mesh.userData.color as string) ?? 'bylayer';
    if (raw !== 'bylayer') return raw;
    const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);
    if (kind === 'roof' && !mesh.userData.materialExplicit) {
      return this.resolveLayer(mesh)?.color ?? '#8a4a2a';
    }
    return material.color_difuso || '#cccccc';
  }

  /**
   * Mapas de textura a escala real: patrón generado para los materiales del
   * catálogo, o la foto subida por el usuario (1 repetición por metro).
   * Null para el vidrio (sin patrón).
   */
  private texturedMaps(mesh: THREE.Mesh, material: Material): TexturedMaps | null {
    const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);
    const pattern = patternFor(material, kind);
    if (pattern === 'vidrio') return null;
    ensureBoxUVs(mesh);
    const custom = material.textura_url && !material.textura_url.startsWith('/static/');
    if (custom) {
      const map = this.textureCopy(material.textura_url!);
      if (!map) return null;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1 / (material.escala_textura?.[0] || 1), 1 / (material.escala_textura?.[1] || 1));
      return { map, normalMap: null, roughnessMap: null };
    }
    return patternMaps(pattern, this.patternColor(mesh, material));
  }

  /**
   * Color que la pieza tiene con Texturas OFF: el propio, el del material
   * elegido o el de su capa (misma regla que applyMeshAppearance).
   */
  /**
   * Piezas con un material que ya no existe en el catálogo (ids de otra base o
   * borrados) o que se cargaron antes que el catálogo: pasan al material por
   * defecto de su tipo. "(sin material)" elegido a propósito se respeta.
   */
  private repairMaterialIds() {
    if (this.materials.length === 0) return;
    this.allMeshes().forEach((mesh) => {
      const id = mesh.userData.materialId as string | undefined;
      const missing = id ? !this.materialById(id) : Boolean(mesh.userData.materialPending);
      if (!missing) return;
      const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);
      mesh.userData.materialId = this.defaultMaterialFor(kind)?.id ?? '';
      mesh.userData.materialExplicit = false;
      delete mesh.userData.materialPending;
    });
  }

  /** Material por defecto del catálogo para un tipo de pieza (o su respaldo). */
  private defaultMaterialFor(kind: string): Material | undefined {
    const byName = (name?: string) => (name ? this.materials.find((m) => m.nombre === name) : undefined);
    return byName(DEFAULT_MATERIAL_BY_KIND[kind as MeasureKind]) ?? byName(FALLBACK_MATERIAL_BY_KIND[kind as MeasureKind]);
  }

  private offColor(mesh: THREE.Mesh): string {
    const raw = (mesh.userData.color as string) ?? 'bylayer';
    if (raw !== 'bylayer') return raw;
    const shown = this.visibleMaterial(mesh);
    if (shown) return shown.color_difuso;
    return this.resolveLayer(mesh)?.color ?? '#9aa4b2';
  }

  private applyMeshAppearance(mesh: THREE.Mesh) {
    const layer = this.resolveLayer(mesh);
    const raw = (mesh.userData.color as string) ?? 'bylayer';
    const hasOverride = raw !== 'bylayer';
    const effectiveColor = hasOverride ? raw : layer?.color ?? '#9aa4b2';
    const transparency = layer?.transparencia ?? 0;
    // El material asignado se ve siempre: con Texturas ON además su imagen;
    // con OFF, su color (salvo el material por defecto, que usa el de la capa).
    const assigned = this.materialById(mesh.userData.materialId);
    const material = this.showTextures ? assigned : undefined;
    const shown = this.showTextures ? undefined : this.visibleMaterial(mesh);
    const prevMaterial = mesh.material as THREE.MeshStandardMaterial | undefined;

    if (shown) {
      mesh.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hasOverride ? raw : shown.color_difuso),
        roughness: shown.rugosidad,
        metalness: shown.metalico,
        transparent: shown.opacidad < 1 || transparency > 0,
        opacity: shown.opacidad * (1 - transparency / 100),
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    } else if (material) {
      // Texturas ON: patrón realista a escala (ladrillo, piedra, tejas…).
      const textured = this.texturedMaps(mesh, material);
      mesh.material = new THREE.MeshStandardMaterial({
        map: textured?.map ?? null,
        normalMap: textured?.normalMap ?? null,
        roughnessMap: textured?.roughnessMap ?? null,
        normalScale: new THREE.Vector2(0.8, 0.8),
        color: new THREE.Color(textured ? '#ffffff' : this.patternColor(mesh, material)),
        roughness: textured ? 1 : material.rugosidad,
        metalness: material.metalico,
        transparent: material.opacidad < 1 || transparency > 0,
        opacity: material.opacidad * (1 - transparency / 100),
        side: THREE.DoubleSide,
        // Las piezas no traen normales: se calculan por cara en el shader.
        flatShading: true,
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
      prevMaterial.normalMap?.dispose();
      prevMaterial.roughnessMap?.dispose();
      prevMaterial.dispose();
    }
    // En modo Animado la pieza mantiene su aspecto de presentación.
    if (this.presentation) this.applyPresentationLook(mesh);
  }

  private refreshAppearance() {
    this.allMeshes().forEach((mesh) => this.applyMeshAppearance(mesh));
  }

  setSelectedLayer(id: string) {
    if (this.selection.length === 0) return;
    this.pushUndo();
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
    this.pushUndo();
    this.selection.forEach((mesh) => (mesh.userData.color = value));
    this.refreshAppearance();
    this.emitSelection();
  }

  setSelectedMaterial(id: string) {
    if (this.selection.length === 0) return;
    this.pushUndo();
    this.selection.forEach((mesh) => {
      mesh.userData.materialId = id;
      mesh.userData.materialExplicit = Boolean(id);
    });
    this.refreshAppearance();
    this.emitSelection();
  }

  setSelectedElevation(y: number) {
    if (this.selection.length === 0) return;
    this.pushUndo('elev');
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

  private refreshHostedWallForOpening(mesh: THREE.Mesh, detachOutside: boolean) {
    if (!this.isOpening(mesh) || !this.model) return;
    const hostId = mesh.userData.hostWallId as string | undefined;
    if (!hostId) return;
    const wall = this.model.getWalls().find((candidate) => candidate.userData.elementId === hostId);
    if (!wall) {
      delete mesh.userData.hostWallId;
      return;
    }
    this.refreshWallOpeningGeometry(wall, detachOutside);
  }

  private refreshWallOpeningGeometry(wall: THREE.Mesh, detachOutside: boolean) {
    if (!this.model || !wall.userData.generatedSegment) return;
    const dims = wall.userData.baseDims as { thickness: number; height: number; length: number } | undefined;
    if (!dims) return;

    wall.updateWorldMatrix(true, false);
    const hosted = [...this.model.getDoors(), ...this.model.getWindows()].filter(
      (opening) => opening.userData.hostWallId === wall.userData.elementId,
    );
    const cuts: WallOpeningCut[] = [];
    hosted.forEach((opening) => {
      opening.updateWorldMatrix(true, false);
      const centerLocal = wall.worldToLocal(opening.getWorldPosition(new THREE.Vector3()));
      const openingDims = this.openingDims(opening);
      const bottom = centerLocal.y - openingDims.alto / 2 + dims.height / 2;
      const outside =
        Math.abs(centerLocal.x) > dims.thickness / 2 + 0.25 ||
        centerLocal.z - openingDims.ancho / 2 < -dims.length / 2 - 0.1 ||
        centerLocal.z + openingDims.ancho / 2 > dims.length / 2 + 0.1 ||
        bottom < -0.05 ||
        bottom + openingDims.alto > dims.height + 0.05;

      if (detachOutside && outside) {
        delete opening.userData.hostWallId;
        return;
      }
      cuts.push({ center: centerLocal.z, width: openingDims.ancho, bottom, height: openingDims.alto });
    });

    this.model.setWallOpenings(wall, cuts);
    if (detachOutside) this.ensureEdges(wall);
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
    this.refreshHostedWallForOpening(mesh, false);
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
    if (!h.mesh.userData.generatedSegment) {
      return { ok: false, mensaje: 'El hueco automático solo está disponible en muros dibujados en el editor.' };
    }

    const wallDims = h.mesh.userData.baseDims as { thickness: number; height: number; length: number };
    const wallThickness = wallDims.thickness;
    const normal = new THREE.Vector3(-h.dir.z, 0, h.dir.x);
    if (dims.ancho > wallDims.length) {
      return { ok: false, mensaje: 'La abertura es más ancha que el muro seleccionado.' };
    }
    const t = THREE.MathUtils.clamp(
      mid.clone().sub(h.a).dot(h.dir),
      dims.ancho / 2,
      wallDims.length - dims.ancho / 2,
    );
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
    s0 = Math.max(0, s0);
    s1 = Math.min(wallDims.length, s1);

    const ancho = s1 - s0;
    const center = h.a.clone().add(h.dir.clone().multiplyScalar((s0 + s1) / 2));
    const oldHostId = mesh.userData.hostWallId as string | undefined;
    const newHostId = h.mesh.userData.elementId as string;
    if (oldHostId && oldHostId !== newHostId) {
      delete mesh.userData.hostWallId;
      const oldHost = this.model?.getWalls().find((wall) => wall.userData.elementId === oldHostId);
      if (oldHost) this.refreshWallOpeningGeometry(oldHost, true);
    }
    mesh.userData.hostWallId = newHostId;
    this.rebuildOpening(mesh, { ...dims, ancho, espesor: wallThickness }, { mid: center, dir: h.dir });
    this.refreshHostedWallForOpening(mesh, true);
    return {
      ok: true,
      mensaje: `Ajustada a ${h.mesh.name}: ancho ${ancho.toFixed(2)} m, espesor ${wallThickness.toFixed(2)} m.`,
      ancho,
      espesor: wallThickness,
    };
  }

  /** Ajusta al muro todos los vanos seleccionados. */
  snapSelectedOpenings(fill = true) {
    this.pushUndo();
    const results = this.selection.filter((m) => this.isOpening(m)).map((m) => this.snapOpeningToWall(m, fill));
    return results.length ? results : [{ ok: false, mensaje: 'Selecciona una puerta o ventana.' }];
  }

  // ============================ Colocar (auto-encaje) ============================

  /** Distancia máxima (m) a la que una pared/piso se engancha a sus vecinos. */
  private snapThreshold = 0.15;

  setSnapThreshold(value: number) {
    this.snapThreshold = Math.max(0.01, value);
  }

  /** Rectángulo en planta de una pieza caja: eje, dirección, largo y espesor (mundo). */
  private pieceFrame(mesh: THREE.Mesh) {
    const { a, b } = pieceAxis(mesh);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const s = this.localSize(mesh);
    const across = s.x >= s.z ? s.z * Math.abs(mesh.scale.z) : s.x * Math.abs(mesh.scale.x);
    return { a, b, dir, len, across, mid: a.clone().add(b).multiplyScalar(0.5) };
  }

  /**
   * Calcula cómo encajar una pared o piso con sus vecinos sin aplicar nada:
   * endereza el giro, alinea caras/ejes, une extremos y la asienta sobre el piso.
   */
  private computeSnap(mesh: THREE.Mesh): SnapPlan | null {
    if (!this.isBoxPiece(mesh) || !mesh.visible) return null;
    const kind = this.measureKindOf(mesh);
    if (kind !== 'wall' && kind !== 'floor') return null;
    const thr = this.snapThreshold;
    const f = this.pieceFrame(mesh);
    if (f.len < 1e-3) return null;
    const selected = new Set(this.selection);
    const others = this.allMeshes().filter(
      (m) => m !== mesh && !selected.has(m) && m.visible && this.isBoxPiece(m) && this.measureKindOf(m) !== null,
    );
    const neighbors = others.map((m) => ({ mesh: m, kind: this.measureKindOf(m), f: this.pieceFrame(m) }));

    // 1) Enderezar el giro: ángulo de un vecino o múltiplo de 90°.
    const angleOf = (d: THREE.Vector3) => Math.atan2(-d.z, d.x);
    const quarter = Math.PI / 2;
    const diffTo = (target: number, ang: number) => {
      let d = (target - ang) % quarter;
      if (d > quarter / 2) d -= quarter;
      if (d < -quarter / 2) d += quarter;
      return d;
    };
    const ang = angleOf(f.dir);
    const maxTurn = THREE.MathUtils.degToRad(6);
    let rotate = 0;
    let best = Infinity;
    neighbors.forEach((n) => {
      const d = diffTo(angleOf(n.f.dir), ang);
      if (Math.abs(d) < maxTurn && Math.abs(d) < best) {
        best = Math.abs(d);
        rotate = d;
      }
    });
    if (best === Infinity) {
      const d = diffTo(0, ang);
      if (Math.abs(d) < maxTurn) rotate = d;
    }
    if (Math.abs(rotate) < 1e-5) rotate = 0;
    const Y = new THREE.Vector3(0, 1, 0);
    const dir = f.dir.clone().applyAxisAngle(Y, rotate);
    const normal = new THREE.Vector3(-dir.z, 0, dir.x);
    const mid = f.mid;

    let s0 = -f.len / 2;
    let s1 = f.len / 2;
    let across = f.across;
    let offN = 0;

    // Rectángulo de cada vecino proyectado en el marco de la pieza.
    const rects = neighbors
      .filter((n) => (kind === 'floor' ? true : n.kind === 'wall'))
      .map((n) => {
        const nn = new THREE.Vector3(-n.f.dir.z, 0, n.f.dir.x).multiplyScalar(n.f.across / 2);
        const corners = [n.f.a.clone().add(nn), n.f.a.clone().sub(nn), n.f.b.clone().add(nn), n.f.b.clone().sub(nn)].map((c) =>
          c.sub(mid),
        );
        const P = corners.map((c) => c.dot(dir));
        const Q = corners.map((c) => c.dot(normal));
        const dot = Math.abs(n.f.dir.dot(dir));
        return {
          kind: n.kind,
          p0: Math.min(...P),
          p1: Math.max(...P),
          q0: Math.min(...Q),
          q1: Math.max(...Q),
          pc: n.f.mid.clone().sub(mid).dot(dir),
          qc: n.f.mid.clone().sub(mid).dot(normal),
          parallel: dot > 0.999,
          perpendicular: dot < 0.035,
        };
      })
      .filter((r) => r.parallel || r.perpendicular);

    const gapP = (r: { p0: number; p1: number }) => Math.max(r.p0 - s1, s0 - r.p1, 0);
    const gapQ = (r: { q0: number; q1: number }) => Math.max(r.q0 - (offN + across / 2), offN - across / 2 - r.q1, 0);

    // 2) Alinear de costado (misma línea que la pared vecina / borde con borde).
    if (kind === 'wall') {
      let shift = 0;
      let bestShift = thr;
      rects
        .filter((r) => r.parallel && r.kind === 'wall' && gapP(r) < thr)
        .forEach((r) => {
          [r.qc, r.q0 + across / 2, r.q1 - across / 2].forEach((c) => {
            if (Math.abs(c) < bestShift) {
              bestShift = Math.abs(c);
              shift = c;
            }
          });
        });
      offN = shift;
    } else {
      let n0 = -across / 2;
      let n1 = across / 2;
      let b0 = thr;
      let b1 = thr;
      rects
        .filter((r) => gapP(r) < thr)
        .forEach((r) => {
          [r.q0, r.q1].forEach((c) => {
            if (Math.abs(c - n0) < b0) {
              b0 = Math.abs(c - n0);
              n0 = c;
            }
            if (Math.abs(c - n1) < b1) {
              b1 = Math.abs(c - n1);
              n1 = c;
            }
          });
        });
      if (n1 - n0 > 0.05) {
        offN = (n0 + n1) / 2;
        across = n1 - n0;
      }
    }

    // 3) Unir extremos (esquinas en L, continuación en línea, bordes de piso).
    let e0 = s0;
    let e1 = s1;
    let b0 = thr;
    let b1 = thr;
    rects
      .filter((r) => gapQ(r) < thr)
      .forEach((r) => {
        const targets = [r.p0, r.p1];
        if (kind === 'wall' && r.perpendicular) targets.push(r.pc);
        targets.forEach((c) => {
          if (Math.abs(c - s0) < b0) {
            b0 = Math.abs(c - s0);
            e0 = c;
          }
          if (Math.abs(c - s1) < b1) {
            b1 = Math.abs(c - s1);
            e1 = c;
          }
        });
      });
    if (e1 - e0 > 0.1) {
      s0 = e0;
      s1 = e1;
    }

    // 4) Asentar la pared sobre el piso que tiene debajo.
    let dy = 0;
    if (kind === 'wall') {
      const minY = new THREE.Box3().setFromObject(mesh).min.y;
      const foot = mid.clone().add(dir.clone().multiplyScalar((s0 + s1) / 2)).add(normal.clone().multiplyScalar(offN));
      let bestDy = 0.3;
      let found = false;
      neighbors
        .filter((n) => n.kind === 'floor')
        .forEach((n) => {
          const box = new THREE.Box3().setFromObject(n.mesh);
          if (foot.x < box.min.x - 0.05 || foot.x > box.max.x + 0.05 || foot.z < box.min.z - 0.05 || foot.z > box.max.z + 0.05) return;
          const d = box.max.y - minY;
          if (Math.abs(d) < bestDy) {
            bestDy = Math.abs(d);
            dy = d;
            found = true;
          }
        });
      if (!found && Math.abs(minY) < thr) dy = -minY;
      if (Math.abs(dy) < 1e-4) dy = 0;
    }

    const along = s1 - s0;
    const changed =
      rotate !== 0 ||
      Math.abs(offN) > 1e-3 ||
      Math.abs(s0 + f.len / 2) > 1e-3 ||
      Math.abs(s1 - f.len / 2) > 1e-3 ||
      Math.abs(across - f.across) > 1e-3 ||
      dy !== 0;
    if (!changed) return null;
    const center = mid.clone().add(dir.clone().multiplyScalar((s0 + s1) / 2)).add(normal.clone().multiplyScalar(offN));
    return { mesh, kind, rotate, center, along, across, dy, oldMid: mid, shift: normal.clone().multiplyScalar(offN) };
  }

  private applySnap(plan: SnapPlan) {
    const { mesh } = plan;
    const Y = new THREE.Vector3(0, 1, 0);
    const hosted =
      this.model && mesh.userData.generatedSegment
        ? [...this.model.getDoors(), ...this.model.getWindows()].filter(
            (o) => o.userData.hostWallId && o.userData.hostWallId === mesh.userData.elementId,
          )
        : [];

    this.bakeScale(mesh);
    if (plan.rotate) mesh.rotateOnWorldAxis(Y, plan.rotate);
    const s = this.localSize(mesh);
    const L: 'x' | 'z' = s.x >= s.z ? 'x' : 'z';
    const T: 'x' | 'z' = L === 'x' ? 'z' : 'x';
    const box = this.localBox(mesh);
    box.min[L] = -plan.along / 2;
    box.max[L] = plan.along / 2;
    box.min[T] = -plan.across / 2;
    box.max[T] = plan.across / 2;
    this.setBoxGeometry(mesh, box);
    mesh.updateMatrixWorld(true);
    const origin = mesh.localToWorld(new THREE.Vector3(0, 0, 0));
    mesh.position.x += plan.center.x - origin.x;
    mesh.position.z += plan.center.z - origin.z;
    mesh.position.y += plan.dy;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);

    // Puertas/ventanas de la pared se mueven con ella.
    hosted.forEach((o) => {
      if (plan.rotate) {
        const rel = o.position.clone().sub(plan.oldMid).applyAxisAngle(Y, plan.rotate);
        o.position.set(plan.oldMid.x + rel.x, o.position.y, plan.oldMid.z + rel.z);
        o.rotateOnWorldAxis(Y, plan.rotate);
      }
      o.position.add(plan.shift);
      o.position.y += plan.dy;
      o.updateMatrix();
      o.updateMatrixWorld(true);
    });
    if (hosted.length) this.refreshWallOpeningGeometry(mesh, false);
    this.applyMeshAppearance(mesh);
  }

  /** ¿La selección tiene algo que "Colocar" pueda encajar? */
  canSnapSelected(): boolean {
    return this.selection.some((m) => this.isOpening(m) || this.computeSnap(m) !== null);
  }

  /** Botón "Colocar": encaja paredes, pisos, puertas y ventanas seleccionadas. */
  snapSelectedPieces(): { ok: boolean; mensaje: string }[] {
    const sel = [...this.selection];
    const plans = sel.map((m) => this.computeSnap(m)).filter((p): p is NonNullable<typeof p> => p !== null);
    const openings = sel.filter((m) => this.isOpening(m));
    if (plans.length === 0 && openings.length === 0) {
      return [{ ok: false, mensaje: 'Ya está alineada o no hay otra pieza cerca.' }];
    }
    this.pushUndo();
    plans.forEach((p) => this.applySnap(p));
    const results = [
      ...plans.map((p) => ({ ok: true, mensaje: `${p.mesh.name} colocada.` })),
      ...openings.map((m) => this.snapOpeningToWall(m, true)),
    ];
    this.syncPivot();
    this.emitSelection();
    if (this.measureKinds.size > 0) this.refreshMeasures();
    return results;
  }

  setSelectedDimension(field: 'height' | 'thickness' | 'length' | 'width', value: number) {
    if (!this.selected) return;
    this.pushUndo('dim-' + field);
    const mesh = this.selected;
    if (this.isBoxPiece(mesh) && value > 0.01) {
      // Paredes/pisos: geometría nueva con la medida real (no se estira).
      this.bakeScale(mesh);
      const size = this.localSize(mesh);
      const len = this.lengthAxis(mesh);
      const axis: 'x' | 'y' | 'z' =
        field === 'height' ? 'y' : field === 'length' ? len : len === 'x' ? 'z' : 'x';
      mesh.scale.set(1, 1, 1);
      mesh.scale[axis] = value / (size[axis] || 1);
      this.bakeScale(mesh);
      this.clampSelectionToFloor();
      this.syncPivot();
      this.emitSelection();
      return;
    }
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

  // ============================ Deshacer / Rehacer ============================

  setHistoryListener(listener: (info: { canUndo: boolean; canRedo: boolean; cutMode: boolean }) => void) {
    this.onHistory = listener;
    this.emitHistory();
  }

  private emitHistory() {
    this.onHistory({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, cutMode: this.cutMode });
  }

  private snapshot(): SceneSnapshot {
    return this.allMeshes().map((mesh) => ({
      mesh,
      geometry: mesh.geometry,
      position: mesh.position.clone(),
      quaternion: mesh.quaternion.clone(),
      scale: mesh.scale.clone(),
      userData: JSON.parse(JSON.stringify(mesh.userData)),
      material: mesh.material,
    }));
  }

  /**
   * Guarda el estado antes de un cambio. `key` agrupa cambios seguidos del
   * mismo campo (p. ej. teclear en el panel) en un solo paso de deshacer.
   */
  pushUndo(key?: string) {
    if (!this.model) return;
    // Avisar al editor (autoguardado) justo después de aplicar el cambio.
    queueMicrotask(() => this.onChange());
    const now = Date.now();
    if (key && this.lastUndoKey?.key === key && now - this.lastUndoKey.at < 1500) {
      this.lastUndoKey.at = now;
      return;
    }
    this.lastUndoKey = key ? { key, at: now } : null;
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistory();
  }

  private restore(snap: SceneSnapshot) {
    const model = this.model;
    if (!model) return;
    this.transformControls.detach();
    const keep = new Set(snap.map((s) => s.mesh));
    this.allMeshes().forEach((m) => {
      if (keep.has(m)) return;
      // Sacar de escena sin liberar la geometría (rehacer puede reusarla).
      const geo = m.geometry;
      m.geometry = new THREE.BufferGeometry();
      model.removeElement(m);
      m.geometry = geo;
    });
    snap.forEach((s) => {
      const m = s.mesh;
      m.geometry = s.geometry;
      m.position.copy(s.position);
      m.quaternion.copy(s.quaternion);
      m.scale.copy(s.scale);
      m.userData = JSON.parse(JSON.stringify(s.userData));
      m.material = s.material;
      m.updateMatrix();
      model.addExisting(m);
      this.ensureEdges(m);
    });
    this.lastUndoKey = null;
    this.refreshVisibility();
    this.refreshAppearance();
    this.clearSelection();
  }

  setChangeListener(listener: () => void) {
    this.onChange = listener;
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    queueMicrotask(() => this.onChange());
    this.redoStack.push(this.snapshot());
    this.restore(snap);
    this.emitHistory();
    return true;
  }

  redo() {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    queueMicrotask(() => this.onChange());
    this.undoStack.push(this.snapshot());
    this.restore(snap);
    this.emitHistory();
    return true;
  }

  // ============================ Medidas reales y Cortar ============================

  /** Paredes y pisos son cajas: se pueden redimensionar y cortar sin deformar. */
  private isBoxPiece(mesh: THREE.Mesh): boolean {
    const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);
    return kind === 'wall' || kind === 'floor';
  }

  private localBox(mesh: THREE.Mesh): THREE.Box3 {
    const g = mesh.geometry as THREE.BufferGeometry;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox!.clone();
  }

  private localSize(mesh: THREE.Mesh): THREE.Vector3 {
    return this.localBox(mesh).getSize(new THREE.Vector3());
  }

  /** Eje local horizontal más largo (el "largo" de la pieza). */
  private lengthAxis(mesh: THREE.Mesh): 'x' | 'z' {
    const s = this.localSize(mesh);
    return s.x > s.z ? 'x' : 'z';
  }

  /** Reemplaza la geometría por una caja nueva con la escala aplicada (scale = 1). */
  private bakeScale(mesh: THREE.Mesh) {
    const sc = mesh.scale;
    if (Math.abs(sc.x - 1) < 1e-4 && Math.abs(sc.y - 1) < 1e-4 && Math.abs(sc.z - 1) < 1e-4) return;
    const box = this.localBox(mesh);
    box.min.multiply(sc);
    box.max.multiply(sc);
    mesh.scale.set(1, 1, 1);
    this.setBoxGeometry(mesh, box);
    mesh.updateMatrix();
  }

  private setBoxGeometry(mesh: THREE.Mesh, box: THREE.Box3) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01));
    geo.translate(center.x, center.y, center.z);
    geo.computeBoundingBox();
    // No se libera la geometría vieja: deshacer puede volver a usarla.
    mesh.geometry = geo;
    const len = this.lengthAxis(mesh);
    mesh.userData.baseDims = {
      thickness: len === 'z' ? size.x : size.z,
      height: size.y,
      length: len === 'z' ? size.z : size.x,
    };
    this.ensureEdges(mesh);
  }

  setCutMode(on: boolean) {
    this.cutMode = on;
    if (on) this.cancelDraft();
    this.canvas.style.cursor = on ? 'crosshair' : '';
    this.emitHistory();
  }

  isCutMode() {
    return this.cutMode;
  }

  /**
   * Corta una pared o piso en el punto clicado, en dos piezas. El corte es
   * perpendicular al largo de la pieza; con Shift, en el otro eje.
   * Queda seleccionado el trozo más pequeño para borrarlo rápido (Supr).
   */
  private cutAt(mesh: THREE.Mesh, worldPoint: THREE.Vector3, otherAxis: boolean) {
    if (!this.model) return;
    this.pushUndo();
    this.bakeScale(mesh);
    mesh.updateMatrixWorld(true);
    const local = mesh.worldToLocal(worldPoint.clone());
    const box = this.localBox(mesh);
    let axis: 'x' | 'z' = this.lengthAxis(mesh);
    if (otherAxis) axis = axis === 'x' ? 'z' : 'x';
    let at = local[axis];
    if (this.translationSnap) {
      const snapped = Math.round(at / this.translationSnap) * this.translationSnap;
      if (snapped > box.min[axis] && snapped < box.max[axis]) at = snapped;
    }
    const minPiece = 0.05;
    if (at - box.min[axis] < minPiece || box.max[axis] - at < minPiece) return;
    const boxA = box.clone();
    boxA.max[axis] = at;
    const boxB = box.clone();
    boxB.min[axis] = at;

    const piece = mesh.clone(false) as THREE.Mesh;
    piece.name = `${mesh.name.replace(/_cut\d+$/, '')}_cut${Date.now()}`;
    piece.userData = JSON.parse(JSON.stringify(mesh.userData));
    this.setBoxGeometry(mesh, boxA);
    this.setBoxGeometry(piece, boxB);
    mesh.userData.originalBox = { min: boxA.min.toArray(), max: boxA.max.toArray() };
    piece.userData.originalBox = { min: boxB.min.toArray(), max: boxB.max.toArray() };
    this.model.addExisting(piece);
    if (mesh.parent && piece.parent !== mesh.parent) mesh.parent.add(piece);
    this.applyMeshAppearance(mesh);
    this.applyMeshAppearance(piece);
    this.refreshVisibility();
    const sizeA = boxA.max[axis] - boxA.min[axis];
    const sizeB = boxB.max[axis] - boxB.min[axis];
    this.select(sizeA <= sizeB ? mesh : piece);
  }

  // ============================ Construcción fácil ============================

  private rayFrom(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /** Piezas con tiradores de medida (paredes, pisos, puertas, ventanas). */
  private isHandleable(mesh: THREE.Mesh): boolean {
    return this.isBoxPiece(mesh) || this.isOpening(mesh);
  }

  /** Eje del largo y del grosor/ancho en coordenadas locales de la pieza. */
  private axesOf(mesh: THREE.Mesh): { L: 'x' | 'z'; T: 'x' | 'z' } {
    // Los vanos se construyen siempre con el ancho en Z.
    const L = this.isOpening(mesh) ? 'z' : this.lengthAxis(mesh);
    return { L, T: L === 'x' ? 'z' : 'x' };
  }

  private usesHandles(): boolean {
    return this.mode === 'scale' && this.selection.length === 1 && this.isHandleable(this.selection[0]);
  }

  /** En modo Escalar con una pieza: tiradores en lugar del gizmo de escala. */
  private refreshGizmo() {
    if (this.selection.length === 0 || this.usesHandles()) {
      this.transformControls.detach();
    } else {
      this.syncPivot();
      this.transformControls.attach(this.pivot);
    }
    this.refreshHandles();
  }

  private ensureHandles() {
    if (this.handles.children.length > 0) return;
    const make = (id: HandleId, color: number) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 20, 14),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
      );
      m.renderOrder = 10;
      m.name = `__handle_${id}`;
      m.userData.handle = id;
      this.handles.add(m);
    };
    make('len+', 0xf59e0b);
    make('len-', 0xf59e0b);
    make('side', 0x22d3ee);
    make('top', 0x22c55e);
    this.scene.add(this.handles);
  }

  private refreshHandles() {
    this.ensureHandles();
    if (!this.usesHandles()) {
      this.handles.visible = false;
      return;
    }
    const mesh = this.selection[0];
    mesh.updateMatrixWorld(true);
    const box = this.localBox(mesh);
    const { L, T } = this.axesOf(mesh);
    const c = box.getCenter(new THREE.Vector3());
    const at = (id: HandleId) => {
      const p = c.clone();
      if (id === 'len+') p[L] = box.max[L];
      else if (id === 'len-') p[L] = box.min[L];
      else if (id === 'side') p[T] = box.max[T];
      else p.y = box.max.y;
      return mesh.localToWorld(p);
    };
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    this.handles.children.forEach((h) => {
      const id = h.userData.handle as HandleId;
      h.position.copy(at(id));
      // Vista desde arriba: el alto no se puede arrastrar.
      h.visible = !(id === 'top' && Math.abs(camDir.y) > 0.95);
      const dist = this.camera.position.distanceTo(h.position);
      const s = (this.camera as THREE.OrthographicCamera).isOrthographicCamera
        ? 1
        : THREE.MathUtils.clamp(dist / 12, 0.4, 3);
      h.scale.setScalar(s);
    });
    this.handles.visible = true;
  }

  /** Clic sobre un tirador visible: empieza a cambiar la medida. */
  private beginHandleDrag(event: PointerEvent): boolean {
    if (!this.handles.visible || !this.usesHandles()) return false;
    this.rayFrom(event);
    const hit = this.raycaster.intersectObjects(this.handles.children.filter((h) => h.visible), false)[0];
    if (!hit) return false;
    const id = hit.object.userData.handle as HandleId;
    const mesh = this.selection[0];
    this.pushUndo();
    this.bakeScale(mesh);
    mesh.updateMatrixWorld(true);
    let plane: THREE.Plane;
    if (id === 'top') {
      const n = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize().negate();
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.object.position);
    } else {
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hit.object.position);
    }
    this.handleDrag = {
      mesh,
      id,
      plane,
      startBox: this.localBox(mesh),
      startPos: mesh.position.clone(),
      startQuat: mesh.quaternion.clone(),
      startWorld: mesh.matrixWorld.clone(),
      startInv: mesh.matrixWorld.clone().invert(),
      opening: this.isOpening(mesh) ? { ...this.openingDims(mesh) } : null,
      ...this.axesOf(mesh),
    };
    this.orbit.enabled = false;
    return true;
  }

  private updateHandleDrag(event: PointerEvent) {
    const d = this.handleDrag;
    if (!d) return;
    this.rayFrom(event);
    const p = this.raycaster.ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!p) return;
    const { mesh, id, L, T } = d;

    // Imán: extremo de pared cerca de otro extremo de pared (unir esquinas).
    if ((id === 'len+' || id === 'len-') && this.isBoxPiece(mesh)) {
      const ends: THREE.Vector3[] = [];
      this.allMeshes()
        .filter((m) => m !== mesh && ((m.userData.kind as string) ?? this.kindOf(m)) === 'wall')
        .forEach((m) => {
          const { a, b } = pieceAxis(m);
          ends.push(a, b);
        });
      const flat = p.clone().setY(0);
      const near = ends.find((e) => e.distanceTo(flat) < 0.15);
      if (near) p.set(near.x, p.y, near.z);
    }

    const local = p.clone().applyMatrix4(d.startInv);
    const box = d.startBox.clone();
    const minSize = 0.1;
    const snap = (len: number) => (this.translationSnap ? Math.max(this.translationSnap, Math.round(len / this.translationSnap) * this.translationSnap) : len);
    if (id === 'len+') box.max[L] = box.min[L] + Math.max(minSize, snap(local[L] - box.min[L]));
    else if (id === 'len-') box.min[L] = box.max[L] - Math.max(minSize, snap(box.max[L] - local[L]));
    else if (id === 'side') {
      // Grosor/ancho simétrico respecto al eje de la pieza.
      const mid = (box.min[T] + box.max[T]) / 2;
      const half = Math.max(minSize / 2, snap(Math.abs(local[T] - mid) * 2) / 2);
      box.min[T] = mid - half;
      box.max[T] = mid + half;
    } else box.max.y = box.min.y + Math.max(minSize, snap(local.y - box.min.y));

    const c = box.getCenter(new THREE.Vector3());
    if (d.opening) {
      const size = box.getSize(new THREE.Vector3());
      const dims = { ...d.opening };
      if (id === 'top') dims.alto = size.y;
      else if (id === 'side') dims.espesor = size[T];
      else dims.ancho = size[L];
      const mid = new THREE.Vector3(c.x, 0, c.z).applyMatrix4(d.startWorld);
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(d.startQuat);
      this.rebuildOpening(mesh, dims, { mid, dir });
    } else {
      // Recentrar: el lado opuesto al tirador queda quieto.
      const offset = new THREE.Vector3(c.x, 0, c.z).applyQuaternion(d.startQuat);
      mesh.position.copy(d.startPos).add(offset);
      box.translate(new THREE.Vector3(-c.x, 0, -c.z));
      this.setBoxGeometry(mesh, box);
      this.applyMeshAppearance(mesh);
      (mesh.material as THREE.MeshStandardMaterial)?.emissive?.setHex(0x2a3550);
      mesh.updateMatrix();
      this.emitSelection();
    }
    if (this.measureKinds.size > 0) this.refreshMeasures();
  }

  private endHandleDrag() {
    if (!this.handleDrag) return;
    this.handleDrag = null;
    this.orbit.enabled = true;
    this.justDraggedAt = Date.now();
    this.syncPivot();
    this.emitSelection();
  }

  /** Clic sobre una pieza ya seleccionada: prepara el arrastre sobre el piso. */
  private beginMoveDrag(event: PointerEvent): boolean {
    if (this.selection.length === 0 || event.ctrlKey || event.metaKey) return false;
    this.rayFrom(event);
    const hit = this.raycaster.intersectObjects(this.selectableMeshes(), false)[0];
    if (!hit || !this.selection.includes(hit.object as THREE.Mesh)) return false;
    this.moveDrag = {
      x: event.clientX,
      y: event.clientY,
      active: false,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hit.point),
      start: hit.point.clone(),
      items: [],
    };
    this.orbit.enabled = false;
    return true;
  }

  private updateMoveDrag(event: PointerEvent) {
    const d = this.moveDrag;
    if (!d || !this.model) return;
    if (!d.active) {
      if (Math.hypot(event.clientX - d.x, event.clientY - d.y) < 5) return;
      d.active = true;
      this.pushUndo();
      d.items = this.selection.map((m) => ({ mesh: m, pos: m.position.clone() }));
    }
    this.rayFrom(event);
    const p = this.raycaster.ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!p) return;
    const parent = this.model.getObject3D();
    parent.updateMatrixWorld(true);
    const delta = parent.worldToLocal(p.clone()).sub(parent.worldToLocal(d.start.clone()));
    delta.y = 0; // Nunca cambia de altura al arrastrar.
    if (this.translationSnap) {
      delta.x = Math.round(delta.x / this.translationSnap) * this.translationSnap;
      delta.z = Math.round(delta.z / this.translationSnap) * this.translationSnap;
    }
    d.items.forEach(({ mesh, pos }) => {
      mesh.position.copy(pos).add(delta);
      mesh.updateMatrix();
    });
    this.syncPivot();
    this.refreshHandles();
    this.emitSelection();
    if (this.measureKinds.size > 0) this.refreshMeasures();
  }

  private endMoveDrag(): boolean {
    const d = this.moveDrag;
    if (!d) return false;
    this.moveDrag = null;
    this.orbit.enabled = true;
    if (!d.active) return false;
    this.justDraggedAt = Date.now();
    this.clampSelectionToFloor();
    // Puertas/ventanas sueltas cerca de una pared se pegan solas.
    this.selection.filter((m) => this.isOpening(m)).forEach((m) => this.snapOpeningToWall(m, false));
    this.syncPivot();
    this.refreshHandles();
    this.emitSelection();
    return true;
  }

  /** Alt: permitir mover en altura con el gizmo. */
  setAllowVertical(value: boolean) {
    this.allowVertical = value;
    this.updateShowY();
  }

  private updateShowY() {
    this.transformControls.showY =
      this.transformControls.mode !== 'translate' || (this.allowVertical && !this.lockVertical);
  }

  /** Vuelve a la medida con la que se creó o cargó la pieza. */
  resetToOriginal() {
    if (this.selection.length === 0) return;
    this.pushUndo();
    this.selection.forEach((mesh) => {
      const orig = mesh.userData.originalOpening as OpeningDims | undefined;
      if (this.isOpening(mesh) && orig) {
        this.rebuildOpening(mesh, { ...orig });
        return;
      }
      const ob = mesh.userData.originalBox as { min: number[]; max: number[] } | undefined;
      mesh.scale.set(1, 1, 1);
      if (this.isBoxPiece(mesh) && ob) {
        this.setBoxGeometry(mesh, new THREE.Box3(new THREE.Vector3(...ob.min), new THREE.Vector3(...ob.max)));
        this.applyMeshAppearance(mesh);
        (mesh.material as THREE.MeshStandardMaterial)?.emissive?.setHex(0x2a3550);
      }
      mesh.updateMatrix();
    });
    this.clampSelectionToFloor();
    this.syncPivot();
    this.refreshHandles();
    this.emitSelection();
  }

  /** Gira 90° la selección sobre el centro de cada pieza. */
  rotateSelection90() {
    if (this.selection.length === 0 || !this.model) return;
    this.pushUndo();
    const parent = this.model.getObject3D();
    parent.updateMatrixWorld(true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    this.selection.forEach((mesh) => {
      mesh.updateMatrixWorld(true);
      const center = parent.worldToLocal(new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()));
      const rel = mesh.position.clone().sub(center);
      rel.y = 0;
      rel.applyQuaternion(q);
      mesh.position.set(center.x + rel.x, mesh.position.y, center.z + rel.z);
      mesh.quaternion.premultiply(q);
      mesh.updateMatrix();
    });
    this.syncPivot();
    this.refreshGizmo();
    this.emitSelection();
  }

  /** Ctrl+D: copia la selección desplazada 50 cm. */
  duplicateSelection() {
    if (this.selection.length === 0 || !this.model) return;
    this.pushUndo();
    const copies = this.selection.map((mesh, i) => {
      const copy = mesh.clone(false) as THREE.Mesh;
      copy.geometry = (mesh.geometry as THREE.BufferGeometry).clone();
      copy.userData = JSON.parse(JSON.stringify(mesh.userData));
      copy.name = `${mesh.name.replace(/_(cut|dup)\d+$/, '')}_dup${Date.now()}${i}`;
      copy.position.add(new THREE.Vector3(0.5, 0, 0.5));
      copy.updateMatrix();
      this.model!.addExisting(copy);
      if (mesh.parent && copy.parent !== mesh.parent) mesh.parent.add(copy);
      this.ensureEdges(copy);
      this.applyMeshAppearance(copy);
      return copy;
    });
    this.refreshVisibility();
    this.setSelection(copies);
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
    if (this.presentation) return;
    this.cancelDraft();
    this.creating = type;
  }

  private spawnElementAt(point: THREE.Vector3) {
    if (!this.model || !this.creating || isRectType(this.creating)) return;
    const baseY = this.model.getWalls().length > 0 ? this.model.getWalls()[0].position.y : 0;
    point.y = baseY;

    this.pushUndo();
    const mesh = this.model.createElement(this.creating, 2, 3, 0.4, point);
    this.creating = null;
    this.select(mesh);
  }

  deleteSelected() {
    if (this.selection.length === 0 || !this.model) return;
    this.pushUndo();
    const meshes = [...this.selection];
    const removedWallIds = new Set(
      meshes.filter((mesh) => mesh.userData.generatedSegment).map((mesh) => mesh.userData.elementId as string),
    );
    const hostIds = new Set(
      meshes.map((mesh) => mesh.userData.hostWallId as string | undefined).filter((id): id is string => Boolean(id)),
    );
    [...this.model.getDoors(), ...this.model.getWindows()].forEach((opening) => {
      if (removedWallIds.has(opening.userData.hostWallId as string)) delete opening.userData.hostWallId;
    });
    this.transformControls.detach();
    meshes.forEach((mesh) => this.model?.removeElement(mesh));
    hostIds.forEach((id) => {
      const wall = this.model?.getWalls().find((candidate) => candidate.userData.elementId === id);
      if (wall) this.refreshWallOpeningGeometry(wall, true);
    });
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
    this.pushUndo('updatePosition-' + axis);
    this.selected.position[axis] = value;
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  updateRotation(axis: 'x' | 'y' | 'z', deg: number) {
    if (!this.selected) return;
    this.pushUndo('updateRotation-' + axis);
    this.selected.rotation[axis] = THREE.MathUtils.degToRad(deg);
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  updateScale(axis: 'x' | 'y' | 'z', value: number) {
    if (!this.selected) return;
    this.pushUndo('updateScale-' + axis);
    this.selected.scale[axis] = value;
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  resetScale() {
    if (!this.selected) return;
    this.pushUndo();
    this.selected.scale.set(1, 1, 1);
    this.clampSelectionToFloor();
    this.syncPivot();
    this.emitSelection();
  }

  async exportGlb(filename: string) {
    if (!this.model) throw new Error('Sin modelo');
    // Nunca exportar/guardar con los materiales o luces de presentación.
    this.setPresentationMode(false);
    return this.model.exportAsGLB(filename);
  }

  async exportGltf(filename: string) {
    if (!this.model) throw new Error('Sin modelo');
    this.setPresentationMode(false);
    return this.model.exportAsGLTF(filename);
  }

  async exportStl(filename: string) {
    if (!this.model) throw new Error('Sin modelo');
    this.setPresentationMode(false);
    return this.model.exportAsSTL(filename);
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
    if (visible.length > 0 && !this.presentation) this.setSelection(visible);
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
      m.userData.materialExplicit = Boolean(materialId);
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

  // ------------------------------------------------------------------
  // Modo Animado (presentación)
  // ------------------------------------------------------------------

  setPresentationListener(listener: (on: boolean) => void) {
    this.onPresentation = listener;
  }

  isPresentationMode(): boolean {
    return this.presentation !== null;
  }

  /**
   * Activa/desactiva la vista de presentación del modelo abierto: luces de
   * color, sombras, grilla azul, texturas temporales y giro automático.
   * Al desactivarla todo vuelve exactamente a como estaba (cámara, luces,
   * materiales, bordes, selección). No modifica el modelo ni lo que se guarda.
   */
  setPresentationMode(on: boolean) {
    if (on === (this.presentation !== null)) return;
    if (on) this.enterPresentation();
    else this.exitPresentation();
    this.onPresentation(this.presentation !== null);
  }

  private enterPresentation() {
    if (!this.model) return;
    this.cancelDraft();
    this.creating = null;
    this.tween = null;

    const savedSelection = [...this.selection];
    this.clearSelection();

    // Límites del modelo: centro, tamaño y base (piso).
    const box = new THREE.Box3().setFromObject(this.model.getObject3D());
    const { center, maxDim } = this.getModelBounds();
    const groundY = box.isEmpty() ? 0 : box.min.y;
    const radius = maxDim / 2;

    const rig = createPresentationRig(center, radius, groundY);
    const backgroundTexture = makeBackgroundTexture();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const helper = this.transformControls.getHelper();

    const state: PresentationState = {
      rig,
      background: this.scene.background,
      backgroundTexture,
      fog: this.scene.fog,
      exposure: this.renderer.toneMappingExposure,
      shadows: this.renderer.shadowMap.enabled,
      gridVisible: this.grid.visible,
      hiddenLights: [],
      camera: this.camera,
      persp: { position: this.persp.position.clone(), up: this.persp.up.clone() },
      ortho: { position: this.ortho.position.clone(), up: this.ortho.up.clone(), zoom: this.ortho.zoom },
      target: this.orbit.target.clone(),
      enableRotate: this.orbit.enableRotate,
      autoRotate: this.orbit.autoRotate,
      autoRotateSpeed: this.orbit.autoRotateSpeed,
      selection: savedSelection,
      helperVisible: helper.visible,
      measuresVisible: this.measureGroup.visible,
      labelsDisplay: this.labelRenderer.domElement.style.display,
      originals: new Map(),
      looks: new Map(),
      effects: new Map(),
      environment: this.scene.environment,
      envTexture: this.createEnvironment(),
      reducedMotion,
      startTime: performance.now(),
      onStart: () => {
        window.clearTimeout(state.resumeTimer);
        this.orbit.autoRotate = false;
      },
      onEnd: () => {
        if (reducedMotion) return;
        window.clearTimeout(state.resumeTimer);
        state.resumeTimer = window.setTimeout(() => {
          if (this.presentation === state) this.orbit.autoRotate = true;
        }, PRESENTATION_RESUME_MS);
      },
    };
    this.presentation = state;

    // Escena: luces y piso de presentación en lugar de los del editor.
    this.scene.children.forEach((child) => {
      const light = child as THREE.Light;
      if (light.isLight && light.visible) {
        light.visible = false;
        state.hiddenLights.push(light);
      }
    });
    this.scene.add(rig.group);
    this.grid.visible = false;
    this.scene.background = backgroundTexture;
    this.scene.fog = makePresentationFog(radius);
    // Entorno para que metales, vidrios y barnices reflejen.
    this.scene.environment = state.envTexture;
    this.scene.environmentIntensity = 0.6;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMappingExposure = 1.15;

    // Ocultar herramientas: gizmo, cotas y fantasma de dibujo.
    helper.visible = false;
    this.measureGroup.visible = false;
    this.labelRenderer.domElement.style.display = 'none';
    if (this.preview) this.preview.visible = false;

    // Materiales de presentación (sobre copias) y sin bordes negros.
    this.allMeshes().forEach((mesh) => this.applyPresentationLook(mesh));

    // Cámara en perspectiva, vista 3/4 encuadrando el modelo, girando despacio.
    this.camera = this.persp;
    this.persp.up.set(0, 1, 0);
    this.orbit.object = this.persp;
    this.orbit.enableRotate = true;
    this.updateTouchGestures();
    this.transformControls.camera = this.persp;
    const target = new THREE.Vector3(center.x, groundY + (center.y - groundY) * 0.8, center.z);
    const dir = new THREE.Vector3(1, 0.62, 1).normalize();
    this.persp.position.copy(target).addScaledVector(dir, maxDim * 1.25 + 2);
    this.orbit.target.copy(target);
    this.persp.lookAt(target);
    this.orbit.autoRotateSpeed = 0.8;
    this.orbit.autoRotate = !reducedMotion;
    this.orbit.addEventListener('start', state.onStart);
    this.orbit.addEventListener('end', state.onEnd);
    this.orbit.update();
  }

  private exitPresentation() {
    const state = this.presentation;
    if (!state) return;
    this.presentation = null;
    window.clearTimeout(state.resumeTimer);
    this.orbit.removeEventListener('start', state.onStart);
    this.orbit.removeEventListener('end', state.onEnd);

    // Materiales del editor, bordes y sombras.
    state.originals.forEach((original, mesh) => {
      const look = state.looks.get(mesh);
      if (look && mesh.material === look) {
        mesh.material = original;
        this.disposeLook(look);
      } else {
        // El editor ya le puso otro material mientras tanto: el guardado sobra.
        this.disposeEditorMaterial(original);
      }
    });
    this.allMeshes().forEach((mesh) => {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.children.forEach((child) => {
        if (child.name === '__edges') child.visible = true;
      });
    });

    // Escena del editor.
    this.scene.remove(state.rig.group);
    state.rig.dispose();
    state.hiddenLights.forEach((light) => (light.visible = true));
    this.grid.visible = state.gridVisible;
    this.scene.background = state.background;
    this.scene.fog = state.fog;
    this.scene.environment = state.environment;
    this.scene.environmentIntensity = 1;
    this.scene.environmentRotation.set(0, 0, 0);
    state.envTexture.dispose();
    state.effects.clear();
    state.backgroundTexture.dispose();
    this.renderer.shadowMap.enabled = state.shadows;
    this.renderer.toneMappingExposure = state.exposure;

    // Herramientas.
    this.transformControls.getHelper().visible = state.helperVisible;
    this.measureGroup.visible = state.measuresVisible;
    this.labelRenderer.domElement.style.display = state.labelsDisplay;

    // Cámara exactamente donde estaba.
    this.orbit.autoRotate = state.autoRotate;
    this.orbit.autoRotateSpeed = state.autoRotateSpeed;
    this.persp.position.copy(state.persp.position);
    this.persp.up.copy(state.persp.up);
    this.ortho.position.copy(state.ortho.position);
    this.ortho.up.copy(state.ortho.up);
    this.ortho.zoom = state.ortho.zoom;
    this.ortho.updateProjectionMatrix();
    this.camera = state.camera;
    this.orbit.object = this.camera;
    this.orbit.enableRotate = state.enableRotate;
    this.updateTouchGestures();
    this.transformControls.camera = this.camera;
    this.orbit.target.copy(state.target);
    this.camera.lookAt(state.target);
    this.orbit.update();

    // Selección previa (si las piezas siguen en el modelo).
    const selection = state.selection.filter((mesh) => this.agentHas(mesh));
    if (selection.length > 0) this.setSelection(selection);
  }

  /** Pone a la pieza su material de presentación (guardando el del editor). */
  private applyPresentationLook(mesh: THREE.Mesh) {
    const state = this.presentation;
    if (!state) return;
    const current = mesh.material as THREE.Material;
    const previousLook = state.looks.get(mesh);
    if (previousLook && previousLook === current) return;

    // Si el editor reemplazó el material (y ya liberó el de presentación),
    // el original guardado quedó viejo: liberarlo.
    const stale = state.originals.get(mesh);
    if (stale && stale !== current) this.disposeEditorMaterial(stale);

    state.originals.set(mesh, mesh.material);
    state.effects.delete(mesh);
    const look = this.buildPresentationLook(mesh, current as THREE.MeshStandardMaterial);
    mesh.material = look;
    state.looks.set(mesh, look);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.children.forEach((child) => {
      if (child.name === '__edges') child.visible = false;
    });
  }

  private buildPresentationLook(mesh: THREE.Mesh, current: THREE.MeshStandardMaterial): THREE.Material {
    const kind = (mesh.userData.kind as string) ?? this.kindOf(mesh);

    // Material de la pieza (elegido o por defecto): patrón realista + efecto.
    // Sin material del catálogo (ids viejos): se usa el de por defecto de su tipo.
    const assigned = this.materialById(mesh.userData.materialId) ?? this.defaultMaterialFor(kind);
    if (assigned) {
      // Animado sigue el modo: ON → patrón con relieve; OFF → colores lisos del editor.
      const maps = this.showTextures ? this.texturedMaps(mesh, assigned) : null;
      const color = this.showTextures ? this.patternColor(mesh, assigned) : this.offColor(mesh);
      const effect = createMaterialEffect(assigned, maps, color);
      const standard = effect.material as THREE.MeshStandardMaterial;
      if (!maps && standard.isMeshStandardMaterial && !standard.transparent && standard.metalness < 0.5) {
        // Liso: rugosidad media y algo de reflejo para que no quede plano ni quemado.
        standard.roughness = 0.75;
        standard.envMapIntensity = 0.5;
      }
      effect.material.userData.ownMap = Boolean(maps);
      if (effect.update) this.presentation?.effects.set(mesh, effect.update);
      return effect.material;
    }

    // Ventanas: vidrio que brilla en cian.
    if (kind === 'window') {
      return new THREE.MeshStandardMaterial({
        map: current.map ?? null,
        color: current.map ? current.color.clone() : new THREE.Color(0xbfe9ff),
        emissive: new THREE.Color(BRAND_ACCENT),
        emissiveIntensity: 0.45,
        roughness: 0.1,
        metalness: 0.2,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        // Las piezas generadas no traen normales: el shader las calcula por cara.
        flatShading: true,
      });
    }

    const look = (current.isMeshStandardMaterial ? current.clone() : new THREE.MeshStandardMaterial()) as THREE.MeshStandardMaterial;
    const preset = PRESENTATION_LOOK[kind];
    // Sin textura propia: textura temporal según el tipo de pieza.
    if (!current.map && preset && this.showTextures) {
      look.color.set(preset.tint);
      const map = preset.url ? this.textureCopy(preset.url) : null;
      if (map) {
        ensurePlanarUVs(mesh);
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        const [u, v] = this.isStructural(mesh) ? horizontalRepeatFor(mesh) : textureRepeatFor(mesh);
        map.repeat.set(u, v);
        look.map = map;
        look.userData.ownMap = true;
        look.color.set(preset.tint);
      }
    }
    // Siempre opaco (el techo en Planta se ve traslúcido en el editor).
    look.transparent = false;
    look.opacity = 1;
    look.depthWrite = true;
    look.emissive?.setHex(0x000000);
    look.roughness = Math.min(look.roughness ?? 0.9, 0.85);
    // Las piezas generadas no traen normales: sin esto las luces direccionales
    // las dejan negras. flatShading calcula la normal de cada cara en el shader
    // sin tocar la geometría (el editor queda igual al salir).
    look.flatShading = true;
    look.needsUpdate = true;
    return look;
  }

  /** Entorno de reflejos (sala neutra de three) para el modo Animado. */
  private createEnvironment(): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    room.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
    });
    pmrem.dispose();
    return texture;
  }

  /** Animaciones de los materiales en modo Animado (cada cuadro). */
  private updatePresentationEffects() {
    const state = this.presentation;
    if (!state || state.reducedMotion) return;
    const t = (performance.now() - state.startTime) / 1000;
    // Reflejos que recorren las piezas (metal, vidrio, barniz).
    this.scene.environmentRotation.y = t * 0.25;
    state.effects.forEach((update) => update(t));
  }

  private disposeLook(material: THREE.Material) {
    const standard = material as THREE.MeshStandardMaterial;
    if (material.userData.ownMap) {
      standard.map?.dispose();
      standard.normalMap?.dispose();
      standard.roughnessMap?.dispose();
    }
    material.dispose();
  }

  private disposeEditorMaterial(material: THREE.Material | THREE.Material[]) {
    const list = Array.isArray(material) ? material : [material];
    const cached = Array.from(this.textureCache.values());
    list.forEach((m) => {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map && !cached.includes(map)) map.dispose();
      m.dispose();
    });
  }

  dispose() {
    this.setPresentationMode(false);
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

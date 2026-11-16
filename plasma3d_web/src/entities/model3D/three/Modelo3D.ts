import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { ModelJson, TextureRef } from '@/entities/model3D/types';
import { ensurePlanarUVs, textureRepeatFor } from '@/entities/model3D/three/uv';
import {
  DOOR_LEAF_M,
  FRAME_M,
  GLASS_M,
  ROOF_OVERHANG_M,
  ROOF_PITCH_DEG,
  ROOF_THICKNESS_M,
  SLAB_THICKNESS_M,
  WALL_HEIGHT_M,
  WALL_THICKNESS_M,
  WINDOW_BAR_THICK_M,
} from '@/entities/model3D/three/dimensions';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Caja centrada en (y, z) dentro de un vano (x = espesor, y = alto, z = largo). */
function part(x: number, y: number, z: number, cy = 0, cz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(x, 0.001), Math.max(y, 0.001), Math.max(z, 0.001));
  g.translate(0, cy, cz);
  return g;
}

function merge(parts: THREE.BufferGeometry[], fallback: () => THREE.BufferGeometry) {
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged ?? fallback();
}

/**
 * Ventana (solo el hueco, sin antepecho): marco perimetral + vidrio + cruz,
 * igual que el backend (`_window_mesh`). Centrada en el origen; x = espesor,
 * y = alto, z = largo. El antepecho y el dintel son parte del muro.
 */
export function buildWindowFrameGeometry(
  thickness: number,
  height: number,
  length: number,
): THREE.BufferGeometry {
  const F = Math.min(FRAME_M, length / 4, height / 4);
  const fd = Math.min(thickness, 0.08);
  const innerL = length - 2 * F;
  const innerH = height - 2 * F;
  return merge(
    [
      part(fd, height, F, 0, -length / 2 + F / 2), // jamba
      part(fd, height, F, 0, length / 2 - F / 2), // jamba
      part(fd, F, innerL, -height / 2 + F / 2), // riel inferior
      part(fd, F, innerL, height / 2 - F / 2), // riel superior
      part(GLASS_M, innerH, innerL), // vidrio
      part(0.05, innerH, WINDOW_BAR_THICK_M), // parteluz
      part(0.05, WINDOW_BAR_THICK_M, innerL), // travesaño
    ],
    () => new THREE.BoxGeometry(thickness, height, length),
  );
}

/** Puerta: jambas + cabezal y hoja delgada centrada (igual que `_door_mesh`). */
export function buildDoorGeometry(thickness: number, height: number, length: number): THREE.BufferGeometry {
  const F = Math.min(FRAME_M, length / 4, height / 4);
  const fd = Math.min(thickness, 0.12);
  const innerL = length - 2 * F;
  return merge(
    [
      part(fd, height, F, 0, -length / 2 + F / 2),
      part(fd, height, F, 0, length / 2 - F / 2),
      part(fd, F, innerL, height / 2 - F / 2), // cabezal
      part(DOOR_LEAF_M, height - F, innerL, -F / 2), // hoja
    ],
    () => new THREE.BoxGeometry(thickness, height, length),
  );
}

export interface WallOpeningCut {
  /** Centro a lo largo del eje local Z del muro. */
  center: number;
  width: number;
  /** Altura del borde inferior medida desde la base del muro. */
  bottom: number;
  height: number;
}

/** Geometría de muro con huecos pasantes para puertas y ventanas. */
export function buildWallWithOpeningsGeometry(
  thickness: number,
  height: number,
  length: number,
  openings: WallOpeningCut[],
): THREE.BufferGeometry {
  if (openings.length === 0) return new THREE.BoxGeometry(thickness, height, length);

  const halfLength = length / 2;
  const halfHeight = height / 2;
  const cuts = openings
    .map((opening) => ({
      left: Math.max(-halfLength, opening.center - opening.width / 2),
      right: Math.min(halfLength, opening.center + opening.width / 2),
      bottom: Math.max(0, opening.bottom),
      top: Math.min(height, opening.bottom + opening.height),
    }))
    .filter((cut) => cut.right - cut.left > 0.001 && cut.top - cut.bottom > 0.001);
  if (cuts.length === 0) return new THREE.BoxGeometry(thickness, height, length);

  const uniqueSorted = (values: number[]) =>
    values.sort((a, b) => a - b).filter((value, index, all) => index === 0 || Math.abs(value - all[index - 1]) > 0.001);
  const xCuts = uniqueSorted([-halfLength, halfLength, ...cuts.flatMap((cut) => [cut.left, cut.right])]);
  const yCuts = uniqueSorted([0, height, ...cuts.flatMap((cut) => [cut.bottom, cut.top])]);
  const pieces: THREE.BufferGeometry[] = [];

  for (let xi = 0; xi < xCuts.length - 1; xi += 1) {
    const left = xCuts[xi];
    const right = xCuts[xi + 1];
    const center = (left + right) / 2;
    for (let yi = 0; yi < yCuts.length - 1; yi += 1) {
      const bottom = yCuts[yi];
      const top = yCuts[yi + 1];
      const middleY = (bottom + top) / 2;
      const insideOpening = cuts.some(
        (cut) => center > cut.left && center < cut.right && middleY > cut.bottom && middleY < cut.top,
      );
      if (insideOpening) continue;

      const piece = new THREE.BoxGeometry(thickness, top - bottom, right - left);
      piece.translate(0, middleY - halfHeight, center);
      pieces.push(piece);
    }
  }

  if (pieces.length === 0) return new THREE.BoxGeometry(thickness, height, length);
  return merge(pieces, () => new THREE.BoxGeometry(thickness, height, length));
}

/**
 * Techo a dos aguas sobre un rectángulo (largo L en X, luz S en Z), con la
 * base y=0 en el arranque de los muros. Dos faldones + los dos hastiales,
 * unidos en una sola geometría. La cumbrera va a lo largo de X.
 */
function buildGableRoofGeometry(L: number, S: number): THREE.BufferGeometry {
  const o = ROOF_OVERHANG_M;
  const t = ROOF_THICKNESS_M;
  const H = WALL_HEIGHT_M;
  const p = THREE.MathUtils.degToRad(ROOF_PITCH_DEG);
  const hs = S / 2 + o; // semiluz con alero
  const slope = hs / Math.cos(p);
  // Altura del eje del faldón para que su cara inferior apoye en y=H sobre
  // la línea del muro (z = ±S/2).
  const ty = H + (S / 2 - hs / 2) * Math.tan(p) + t / (2 * Math.cos(p));

  const parts: THREE.BufferGeometry[] = [];
  [1, -1].forEach((side) => {
    const slab = new THREE.BoxGeometry(L + 2 * o, t, slope);
    slab.rotateX(side * p);
    slab.translate(0, ty, side * (hs / 2));
    parts.push(slab.toNonIndexed());
    slab.dispose();
  });

  // Hastiales: triángulos de muro que cierran los extremos bajo el techo.
  const rise = (S / 2) * Math.tan(p);
  const tri = new THREE.Shape();
  tri.moveTo(-S / 2, 0);
  tri.lineTo(S / 2, 0);
  tri.lineTo(0, rise);
  tri.closePath();
  [1, -1].forEach((end) => {
    const gable = new THREE.ExtrudeGeometry(tri, { depth: WALL_THICKNESS_M, bevelEnabled: false });
    gable.rotateY(Math.PI / 2); // forma: x→z, extrusión: z→x
    const x0 = end > 0 ? L / 2 - WALL_THICKNESS_M : -L / 2;
    gable.translate(x0, H, 0);
    parts.push(gable.index ? gable.toNonIndexed() : gable);
  });

  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged ?? new THREE.BoxGeometry(L, t, S);
}

export type ElementType = 'wall' | 'door' | 'window';
/** Piezas estructurales generadas por el backend (no se dibujan a mano). */
export type StructureType = 'floor' | 'roof';

/** Clasifica una malla por su nombre de nodo del GLB. */
export function classifyMeshName(name: string): ElementType | StructureType | null {
  const lname = name.toLowerCase();
  if (lname.includes('floor')) return 'floor';
  if (lname.includes('roof')) return 'roof';
  if (lname.includes('wall')) return 'wall';
  if (lname.includes('door')) return 'door';
  if (lname.includes('window')) return 'window';
  return null;
}

export interface ModelSummaryObject {
  type: string;
  name: string;
  width: number;
  height: number;
  depth: number;
  position: { x: number; y: number; z: number };
  material: { name: string; color?: string };
  /** m² reales: cara frontal (muros/vanos) o superior con pendiente (piso/techo). */
  area?: number;
  /** Medidas en ejes locales de la pieza (las agrega el editor). */
  length?: number;
  thickness?: number;
  volume?: number;
}

/** Suma el área (en mundo) de los triángulos que miran hacia arriba. */
export function upwardSurfaceArea(mesh: THREE.Mesh): number {
  const geom = mesh.geometry as THREE.BufferGeometry;
  const pos = geom.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return 0;
  mesh.updateMatrixWorld(true);
  const m = mesh.matrixWorld;
  const index = geom.index;
  const count = index ? index.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let area = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(m);
    b.fromBufferAttribute(pos, ib).applyMatrix4(m);
    c.fromBufferAttribute(pos, ic).applyMatrix4(m);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const cross = ab.cross(ac);
    const len = cross.length();
    // El winding puede venir invertido: se mira |n.y| y se toman solo las
    // caras casi horizontales (|n.y| > 0.5); la cara superior e inferior
    // tienen la misma área, por eso se divide por 2.
    if (len > 0 && Math.abs(cross.y) / len > 0.5) area += len / 2;
  }
  return area / 2;
}

export interface ModelSummary {
  counts: { walls: number; doors: number; windows: number; floors: number; roofs: number };
  objects: ModelSummaryObject[];
}

/**
 * Modelo3D — wrapper de Three.js para cargar/editar/exportar un modelo.
 */
export class Modelo3D {
  private scene: THREE.Scene;
  public objeto!: THREE.Object3D;
  private onLoadCallbacks: Array<() => void> = [];
  private loader = new THREE.TextureLoader();
  private walls: THREE.Mesh[] = [];
  private doors: THREE.Mesh[] = [];
  private windows: THREE.Mesh[] = [];
  private floors: THREE.Mesh[] = [];
  private roofs: THREE.Mesh[] = [];

  constructor(
    scene: THREE.Scene | null,
    private url: string | null,
    public position = new THREE.Vector3(0, 0, 0),
    public scale = new THREE.Vector3(1, 1, 1),
    public rotation = new THREE.Euler(0, 0, 0),
    private textures: TextureRef[] = [],
    onLoad?: () => void,
  ) {
    this.scene = scene ?? new THREE.Scene();
    if (onLoad) this.onLoadCallbacks.push(onLoad);
    void this.load();
  }

  private async load(): Promise<void> {
    if (!this.url) {
      this.objeto = new THREE.Group();
      this.objeto.name = 'ModeloVacio';
      this.scene.add(this.objeto);
      this.emitLoad();
      return;
    }

    if (this.url.endsWith('.json')) {
      try {
        const res = await fetch(this.url);
        if (!res.ok) throw new Error(`Error HTTP ${res.status}`);
        const model = (await res.json()) as ModelJson;

        this.objeto = new THREE.Group();

        const globalScale = 0.01;

        model.points.forEach((p, i) => {
          const w = (p.x2 - p.x1) * globalScale;
          const h = (p.y2 - p.y1) * globalScale;
          const cx = ((p.x1 + p.x2) / 2) * globalScale;
          const cy = ((p.y1 + p.y2) / 2) * globalScale;

          const cls = model.classes[i]?.name ?? 'wall';
          let color = 0xaaaaaa;
          if (cls === 'wall') color = 0x444444;
          if (cls === 'door') color = 0x00ff00;
          if (cls === 'window') color = 0x0000ff;

          const geometry = new THREE.BoxGeometry(w, h, 0.1);
          const material = new THREE.MeshStandardMaterial({ color });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(cx, -cy, 0);
          this.objeto.add(mesh);
        });

        this.objeto.scale.copy(this.scale);
        this.objeto.rotation.copy(this.rotation);
        this.objeto.position.add(this.position);
        this.scene.add(this.objeto);
        this.emitLoad();
      } catch (error) {
        console.error('Error cargando modelo JSON:', error);
      }
      return;
    }

    const loader = new GLTFLoader();
    loader.load(this.url, (gltf) => {
      this.objeto = gltf.scene;

      this.objeto.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.2,
            roughness: 0.8,
            side: THREE.DoubleSide,
          });
          mesh.name = child.name || `mesh_${THREE.MathUtils.generateUUID()}`;

          const kind = classifyMeshName(mesh.name);
          if (kind === 'wall') this.walls.push(mesh);
          else if (kind === 'door') this.doors.push(mesh);
          else if (kind === 'window') this.windows.push(mesh);
          else if (kind === 'floor') this.floors.push(mesh);
          else if (kind === 'roof') this.roofs.push(mesh);
        }
      });

      this.objeto.scale.copy(this.scale);
      let box = new THREE.Box3().setFromObject(this.objeto);
      const center = box.getCenter(new THREE.Vector3());
      this.objeto.position.sub(center);

      box = new THREE.Box3().setFromObject(this.objeto);
      const height = box.getSize(new THREE.Vector3()).y;
      this.objeto.position.y += height / 2;
      // La losa queda bajo el nivel 0: su cara superior coincide con el
      // plano de dibujo y los muros arrancan en y=0.
      if (this.floors.length > 0) {
        const floorBox = new THREE.Box3();
        this.floors.forEach((f) => floorBox.expandByObject(f));
        this.objeto.position.y -= floorBox.getSize(new THREE.Vector3()).y;
      }
      this.objeto.position.add(this.position);
      this.objeto.rotation.copy(this.rotation);

      this.scene.add(this.objeto);

      this.setTextureByName('wall_internal', this.textures[0]?.url ?? '');
      this.setTextureByName('door', this.textures[3]?.url ?? '');
      this.setTextureByName('window', this.textures[6]?.url ?? '');

      this.emitLoad();
    });
  }

  private emitLoad() {
    this.onLoadCallbacks.forEach((cb) => cb());
  }

  setPosition(x: number, y: number, z: number) {
    if (!this.objeto) return;
    this.objeto.position.set(x, y, z);
  }

  setScale(x: number, y: number, z: number) {
    if (!this.objeto) return;
    this.objeto.scale.set(x, y, z);
  }

  setRotation(x: number, y: number, z: number) {
    if (!this.objeto) return;
    this.objeto.rotation.set(x, y, z);
  }

  setMaterial(material: THREE.Material) {
    if (!this.objeto) return;
    this.objeto.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = material;
    });
  }

  setMaterialByName(partialName: string, material: THREE.Material) {
    if (!this.objeto) return;
    this.objeto.traverse((child) => {
      if (
        (child as THREE.Mesh).isMesh &&
        child.name.toLowerCase().includes(partialName.toLowerCase())
      ) {
        (child as THREE.Mesh).material = material;
      }
    });
  }

  addOnLoadCallback(callback: () => void) {
    this.onLoadCallbacks.push(callback);
  }

  getObject3D(): THREE.Object3D {
    return this.objeto;
  }

  getWalls(): THREE.Mesh[] {
    return this.walls;
  }

  getDoors(): THREE.Mesh[] {
    return this.doors;
  }

  getWindows(): THREE.Mesh[] {
    return this.windows;
  }

  getFloors(): THREE.Mesh[] {
    return this.floors;
  }

  getRoofs(): THREE.Mesh[] {
    return this.roofs;
  }

  private ensureUVs(mesh: THREE.Mesh) {
    ensurePlanarUVs(mesh);
  }

  setTexture(url: string) {
    if (!this.objeto) return;

    const baseTexture = this.loader.load(url, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
    });

    this.objeto.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        this.ensureUVs(mesh);
        const map = baseTexture.clone();
        map.needsUpdate = true;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        const [u, v] = textureRepeatFor(mesh);
        map.repeat.set(u, v);
        mesh.material = new THREE.MeshStandardMaterial({
          map,
          color: 0xffffff,
          metalness: 0,
          roughness: 1,
          side: THREE.DoubleSide,
        });
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  setTextureByName(partialName: string, url: string) {
    if (!this.objeto || !url) return;

    const lowerName = partialName.toLowerCase();
    const textureName = this.textures.find((t) => t.url === url)?.name ?? 'Personalizado';

    const baseTexture = this.loader.load(url);
    baseTexture.wrapS = baseTexture.wrapT = THREE.RepeatWrapping;
    baseTexture.colorSpace = THREE.SRGBColorSpace;

    this.objeto.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const lname = mesh.name.toLowerCase();

      const isWall = lowerName === 'wall_internal' && lname.startsWith('wall_internal');
      const isDoor = lowerName === 'door' && lname.includes('door');
      const isWindow = lowerName === 'window' && lname.includes('window');
      if (!isWall && !isDoor && !isWindow) return;

      this.ensureUVs(mesh);

      const map = baseTexture.clone();
      map.needsUpdate = true;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      const [u, v] = textureRepeatFor(mesh);
      map.repeat.set(u, v);

      const newMat = new THREE.MeshStandardMaterial({
        map,
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.9,
        side: THREE.DoubleSide,
        transparent: isWindow,
        opacity: isWindow ? 0.9 : 1,
      });
      (newMat as THREE.Material & { _textureName?: string })._textureName = textureName;

      mesh.material = newMat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }

  exportAsGLB(filename = 'modelo.glb'): Promise<{ blob: Blob; filename: string }> {
    return new Promise((resolve, reject) => {
      if (!this.objeto) {
        reject(new Error('No hay modelo cargado'));
        return;
      }

      const detached: { parent: THREE.Object3D; child: THREE.Object3D }[] = [];
      this.objeto.traverse((child) => {
        if (child.name === '__edges' && child.parent) {
          detached.push({ parent: child.parent, child });
        }
      });
      detached.forEach(({ child }) => child.removeFromParent());
      const restore = () => detached.forEach(({ parent, child }) => parent.add(child));

      const exporter = new GLTFExporter();
      exporter.parse(
        this.objeto,
        (result) => {
          restore();
          const blob =
            result instanceof ArrayBuffer
              ? new Blob([result], { type: 'model/gltf-binary' })
              : new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
          resolve({ blob, filename });
        },
        (error) => {
          restore();
          reject(error);
        },
        // onlyVisible:false → lo oculto en pantalla (techo, capas apagadas)
        // se sigue guardando; ocultar es solo una opción de vista.
        { binary: true, onlyVisible: false },
      );
    });
  }

  downloadBlob(blob: Blob, filename: string) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  toJSONSummary(): ModelSummary {
    const findMaterialName = (mat?: THREE.Material): string => {
      if (!mat) return 'Sin textura';
      const m = mat as THREE.Material & { _textureName?: string };
      if (m._textureName) return m._textureName;
      const map = (mat as THREE.MeshStandardMaterial).map;
      if (map?.image && 'src' in map.image) {
        const url = String((map.image as HTMLImageElement).src).toLowerCase();
        const tex = this.textures.find((t) => url.includes(t.url.toLowerCase()));
        if (tex) return tex.name;
      }
      return 'Personalizado';
    };

    const extractData = (mesh: THREE.Mesh, type: string): ModelSummaryObject => {
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      box.getSize(size);
      const material = mesh.material as THREE.MeshStandardMaterial;

      return {
        type,
        name: mesh.name,
        width: size.x,
        height: size.y,
        depth: size.z,
        position: {
          x: mesh.position.x,
          y: mesh.position.y,
          z: mesh.position.z,
        },
        material: {
          name: findMaterialName(material),
          color: material.color?.getHexString?.(),
        },
        ...(type === 'floor' || type === 'roof'
          ? { area: Number(upwardSurfaceArea(mesh).toFixed(3)) }
          : {}),
      };
    };

    return {
      counts: {
        walls: this.walls.length,
        doors: this.doors.length,
        windows: this.windows.length,
        floors: this.floors.length,
        roofs: this.roofs.length,
      },
      objects: [
        ...this.walls.map((m) => extractData(m, 'wall')),
        ...this.doors.map((m) => extractData(m, 'door')),
        ...this.windows.map((m) => extractData(m, 'window')),
        ...this.floors.map((m) => extractData(m, 'floor')),
        ...this.roofs.map((m) => extractData(m, 'roof')),
      ],
    };
  }

  createElement(
    type: ElementType,
    width = 1,
    height = 3,
    depth = 0.4,
    position?: THREE.Vector3,
  ): THREE.Mesh {
    let refArray: THREE.Mesh[] = [];
    if (type === 'wall') refArray = this.walls;
    else if (type === 'door') refArray = this.doors;
    else if (type === 'window') refArray = this.windows;

    let baseMaterial: THREE.MeshStandardMaterial;
    if (refArray.length > 0) {
      baseMaterial = (refArray[0].material as THREE.MeshStandardMaterial).clone();
    } else {
      let color = 0xaaaaaa;
      if (type === 'wall') color = 0x444444;
      if (type === 'door') color = 0x00ff00;
      if (type === 'window') color = 0x0000ff;
      baseMaterial = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
    }

    let baseY = 0;
    if (this.walls.length > 0) {
      const box = new THREE.Box3().setFromObject(this.walls[0]);
      baseY = box.min.y;
    }

    const pos = position ?? new THREE.Vector3(0, 0, 0);
    pos.y = baseY;

    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate(0, height / 2, 0);

    const mesh = new THREE.Mesh(geometry, baseMaterial);
    if (type === 'wall') mesh.name = `wall_internal_${Date.now()}`;
    if (type === 'door') mesh.name = `door_${Date.now()}`;
    if (type === 'window') mesh.name = `window_${Date.now()}`;
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.objeto.add(mesh);
    if (type === 'wall') this.walls.push(mesh);
    if (type === 'door') this.doors.push(mesh);
    if (type === 'window') this.windows.push(mesh);

    mesh.userData.baseY = baseY;
    return mesh;
  }

  createElementSegment(
    type: ElementType,
    a: THREE.Vector3,
    b: THREE.Vector3,
    thickness: number,
    height: number,
    sill = 0,
  ): THREE.Mesh | null {
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    if (length < 0.05) return null;

    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);

    let refArray: THREE.Mesh[] = [];
    if (type === 'wall') refArray = this.walls;
    else if (type === 'door') refArray = this.doors;
    else if (type === 'window') refArray = this.windows;

    let baseMaterial: THREE.MeshStandardMaterial;
    if (refArray.length > 0) {
      baseMaterial = (refArray[0].material as THREE.MeshStandardMaterial).clone();
    } else {
      let color = 0x9aa4b2;
      if (type === 'door') color = 0x8a6b4a;
      if (type === 'window') color = 0x6ea0d8;
      baseMaterial = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
    }

    const geometry =
      type === 'window'
        ? buildWindowFrameGeometry(thickness, height, length)
        : type === 'door'
          ? buildDoorGeometry(thickness, height, length)
          : new THREE.BoxGeometry(thickness, height, length);
    const mesh = new THREE.Mesh(geometry, baseMaterial);
    mesh.position.set(mid.x, a.y + sill + height / 2, mid.z);
    mesh.rotation.y = Math.atan2(dir.x, dir.z);
    if (type !== 'wall') {
      // Medidas del vano: el editor lo reconstruye (no lo estira) al cambiarlas.
      mesh.userData.opening = { ancho: length, alto: height, alfeizar: sill, espesor: thickness };
    }

    if (type === 'wall') {
      mesh.name = `wall_internal_${Date.now()}`;
      mesh.userData.generatedSegment = true;
      this.walls.push(mesh);
    } else if (type === 'door') {
      mesh.name = `door_${Date.now()}`;
      this.doors.push(mesh);
    } else {
      mesh.name = `window_${Date.now()}`;
      this.windows.push(mesh);
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.baseDims = { thickness, height, length };
    this.objeto.add(mesh);
    return mesh;
  }

  setWallOpenings(mesh: THREE.Mesh, openings: WallOpeningCut[]) {
    if (!mesh.userData.generatedSegment || !this.walls.includes(mesh)) return;
    const dims = mesh.userData.baseDims as { thickness: number; height: number; length: number } | undefined;
    if (!dims) return;
    const old = mesh.geometry;
    mesh.geometry = buildWallWithOpeningsGeometry(dims.thickness, dims.height, dims.length, openings);
    mesh.userData.openingCuts = openings;
    old.dispose();
  }

  /**
   * Piso (losa) o techo dibujado a mano como rectángulo entre las esquinas
   * `a` y `b` (coordenadas locales del modelo; `a.y` = nivel del piso).
   */
  createSlab(
    type: StructureType,
    a: THREE.Vector3,
    b: THREE.Vector3,
    roofKind: 'plano' | 'dos_aguas' = 'plano',
  ): THREE.Mesh | null {
    const w = Math.abs(b.x - a.x);
    const d = Math.abs(b.z - a.z);
    if (w < 0.3 || d < 0.3) return null;
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;

    let geometry: THREE.BufferGeometry;
    if (type === 'floor') {
      geometry = new THREE.BoxGeometry(w, SLAB_THICKNESS_M, d);
      geometry.translate(0, -SLAB_THICKNESS_M / 2, 0); // cara superior en y=0
    } else if (roofKind === 'dos_aguas') {
      // Cumbrera por el lado más largo.
      const alongX = w >= d;
      geometry = buildGableRoofGeometry(alongX ? w : d, alongX ? d : w);
      if (!alongX) geometry.rotateY(Math.PI / 2);
    } else {
      const o = ROOF_OVERHANG_M;
      geometry = new THREE.BoxGeometry(w + 2 * o, ROOF_THICKNESS_M, d + 2 * o);
      geometry.translate(0, WALL_HEIGHT_M + ROOF_THICKNESS_M / 2, 0);
    }

    const refArray = type === 'floor' ? this.floors : this.roofs;
    const baseMaterial =
      refArray.length > 0
        ? (refArray[0].material as THREE.MeshStandardMaterial).clone()
        : new THREE.MeshStandardMaterial({
            color: type === 'floor' ? 0xd6d3cc : 0xb5623c,
            roughness: 0.85,
            metalness: 0.05,
            side: THREE.DoubleSide,
          });

    const mesh = new THREE.Mesh(geometry, baseMaterial);
    mesh.name = `${type}_${Date.now()}`;
    mesh.position.set(cx, a.y, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.objeto.add(mesh);
    refArray.push(mesh);
    return mesh;
  }

  removeElement(mesh: THREE.Mesh) {
    if (!this.objeto) return;
    // No disponer del material: puede estar compartido entre varias mallas.
    mesh.geometry.dispose();
    this.objeto.remove(mesh);
    this.walls = this.walls.filter((m) => m !== mesh);
    this.doors = this.doors.filter((m) => m !== mesh);
    this.windows = this.windows.filter((m) => m !== mesh);
    this.floors = this.floors.filter((m) => m !== mesh);
    this.roofs = this.roofs.filter((m) => m !== mesh);
    mesh.removeFromParent();
  }

  dispose() {
    this.objeto?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => {
          const mat = material as THREE.MeshStandardMaterial;
          mat?.map?.dispose();
          mat?.dispose();
        });
      }
    });
    this.objeto?.removeFromParent();
    this.walls = [];
    this.doors = [];
    this.windows = [];
    this.floors = [];
    this.roofs = [];
  }
}

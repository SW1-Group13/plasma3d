import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { ModelJson, TextureRef } from '@/entities/model3D/types';

export type ElementType = 'wall' | 'door' | 'window';

export interface ModelSummaryObject {
  type: string;
  name: string;
  width: number;
  height: number;
  depth: number;
  position: { x: number; y: number; z: number };
  material: { name: string; color?: string };
}

export interface ModelSummary {
  counts: { walls: number; doors: number; windows: number };
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

          const lname = mesh.name.toLowerCase();
          if (lname.includes('wall_internal')) this.walls.push(mesh);
          else if (lname.includes('door')) this.doors.push(mesh);
          else if (lname.includes('window')) this.windows.push(mesh);
        }
      });

      this.objeto.scale.copy(this.scale);
      let box = new THREE.Box3().setFromObject(this.objeto);
      const center = box.getCenter(new THREE.Vector3());
      this.objeto.position.sub(center);

      box = new THREE.Box3().setFromObject(this.objeto);
      const height = box.getSize(new THREE.Vector3()).y;
      this.objeto.position.y += height / 2;
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

  private ensureUVs(mesh: THREE.Mesh, axis: 'xz' | 'xy' = 'xz') {
    const geom = mesh.geometry as THREE.BufferGeometry;
    if (geom.attributes.uv) return;

    geom.computeBoundingBox();
    const bbox = geom.boundingBox!;
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const pos = geom.attributes.position as THREE.BufferAttribute;

    const uvArray: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const a = (pos.getX(i) - bbox.min.x) / (size.x || 1);
      const b =
        axis === 'xz'
          ? (pos.getZ(i) - bbox.min.z) / (size.z || 1)
          : (pos.getY(i) - bbox.min.y) / (size.y || 1);
      uvArray.push(a, b);
    }
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvArray, 2));
  }

  setTexture(url: string) {
    if (!this.objeto) return;

    const texture = this.loader.load(url, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(4, 4);
      tex.colorSpace = THREE.SRGBColorSpace;
    });

    this.objeto.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        this.ensureUVs(mesh);
        mesh.material = new THREE.MeshStandardMaterial({
          map: texture,
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

    const texture = this.loader.load(url);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    this.objeto.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const lname = mesh.name.toLowerCase();

      const isWall = lowerName === 'wall_internal' && lname.startsWith('wall_internal');
      const isDoor = lowerName === 'door' && lname.includes('door');
      const isWindow = lowerName === 'window' && lname.includes('window');
      if (!isWall && !isDoor && !isWindow) return;

      if (isWindow) texture.repeat.set(1, 1);
      else texture.repeat.set(2, 2);

      this.ensureUVs(mesh);

      const newMat = new THREE.MeshStandardMaterial({
        map: texture,
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

      const exporter = new GLTFExporter();
      exporter.parse(
        this.objeto,
        (result) => {
          const blob =
            result instanceof ArrayBuffer
              ? new Blob([result], { type: 'model/gltf-binary' })
              : new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
          resolve({ blob, filename });
        },
        (error) => reject(error),
        { binary: true },
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
      };
    };

    return {
      counts: {
        walls: this.walls.length,
        doors: this.doors.length,
        windows: this.windows.length,
      },
      objects: [
        ...this.walls.map((m) => extractData(m, 'wall')),
        ...this.doors.map((m) => extractData(m, 'door')),
        ...this.windows.map((m) => extractData(m, 'window')),
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

    const geometry = new THREE.BoxGeometry(thickness, height, length);
    const mesh = new THREE.Mesh(geometry, baseMaterial);
    mesh.position.set(mid.x, sill + height / 2, mid.z);
    mesh.rotation.y = Math.atan2(dir.x, dir.z);

    if (type === 'wall') {
      mesh.name = `wall_internal_${Date.now()}`;
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
    this.objeto.add(mesh);
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
  }
}

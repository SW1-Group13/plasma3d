import * as THREE from 'three';

/** Densidad de textura: metros de mundo que cubre una repeticion (tile). */
export const TEXTURE_TILE_METERS = 1;

/**
 * UVs planares normalizadas (0..1) basadas en el bounding box de la malla.
 * Se combinan con `texture.repeat` para ajustar la densidad por elemento.
 */
export function ensurePlanarUVs(mesh: THREE.Mesh, axis: 'xz' | 'xy' = 'xz'): void {
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

/**
 * Repeat proporcional al tamano real del elemento: la textura conserva una
 * densidad constante (un tile cada `tile` metros) y no se estira, sin importar
 * el largo/alto de cada muro, puerta o ventana.
 */
export function textureRepeatFor(
  mesh: THREE.Mesh,
  tile = TEXTURE_TILE_METERS,
): [number, number] {
  const geom = mesh.geometry as THREE.BufferGeometry;
  if (!geom.boundingBox) geom.computeBoundingBox();
  const size = new THREE.Vector3();
  geom.boundingBox!.getSize(size);
  const horizontal = Math.max(size.x, size.z, tile);
  const vertical = Math.max(size.y, tile);
  return [Math.max(1, horizontal / tile), Math.max(1, vertical / tile)];
}

/**
 * Repeat para superficies horizontales (losa de piso, techo): usa el ancho
 * (X) y el fondo (Z), coherente con las UVs planares en 'xz'.
 */
export function horizontalRepeatFor(
  mesh: THREE.Mesh,
  tile = TEXTURE_TILE_METERS,
): [number, number] {
  const geom = mesh.geometry as THREE.BufferGeometry;
  if (!geom.boundingBox) geom.computeBoundingBox();
  const size = new THREE.Vector3();
  geom.boundingBox!.getSize(size);
  return [Math.max(1, size.x / tile), Math.max(1, size.z / tile)];
}

/**
 * UVs por proyección de caja, en METROS: cada cara se proyecta sobre el plano
 * al que mira (pared → largo × alto; piso/techo → x × z). Así una textura con
 * `repeat = 1 / tamaño real` queda a escala sin estirarse en ninguna cara.
 * Si la geometría está indexada se duplica por cara (toNonIndexed) para que
 * cada cara tenga sus propias UV.
 */
export function ensureBoxUVs(mesh: THREE.Mesh): void {
  let geom = mesh.geometry as THREE.BufferGeometry;
  if (geom.userData.boxUV) return;
  if (geom.index) {
    const flat = geom.toNonIndexed();
    flat.userData = { ...geom.userData };
    geom.dispose();
    mesh.geometry = flat;
    geom = flat;
  }
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u: number;
      let v: number;
      if (ay >= ax && ay >= az) {
        u = p.x;
        v = p.z;
      } else if (ax >= az) {
        u = p.z;
        v = p.y;
      } else {
        u = p.x;
        v = p.y;
      }
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = v;
    }
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.userData.boxUV = true;
}

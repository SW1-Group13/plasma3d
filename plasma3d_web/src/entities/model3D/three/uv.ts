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

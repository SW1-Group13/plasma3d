import * as THREE from 'three';

/**
 * "Modo presentación": luces de color, sombras, piso con brillo y grilla en
 * los colores de la marca. Lo usan el visor del Home y el modo Animado del
 * editor para que ambos se vean igual.
 */

// Colores de la marca (ver tokens en index.css).
export const BRAND_PRIMARY = 0x4f7cff;
export const BRAND_ACCENT = 0x22d3ee;
export const BRAND_CANVAS = 0x0a0e1a;

export interface PresentationRig {
  /** Grupo con luces, piso, brillo y grilla (agregar a la escena). */
  group: THREE.Group;
  /** Libera geometrías, materiales y texturas del rig. */
  dispose: () => void;
}

/** Textura radial (centro de color -> transparente). */
function makeGlowTexture(color: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Fondo degradado (azul tenue arriba -> fondo de la app abajo). */
export function makeBackgroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#13204a');
  gradient.addColorStop(0.55, '#0d1430');
  gradient.addColorStop(1, '#0a0e1a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Niebla del color del fondo, escalada al tamaño del modelo. */
export function makePresentationFog(radius: number): THREE.Fog {
  return new THREE.Fog(BRAND_CANVAS, radius * 4.5, radius * 10);
}

export function disposeObject3D(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

/**
 * Crea las luces y el piso de presentación alrededor de un modelo.
 *
 * @param center  centro del modelo (en coordenadas de escena)
 * @param radius  radio aproximado del modelo (mitad de su lado mayor)
 * @param groundY altura del piso (base del modelo)
 */
export function createPresentationRig(center: THREE.Vector3, radius: number, groundY = 0): PresentationRig {
  const r = Math.max(radius, 0.5);
  const group = new THREE.Group();
  group.name = '__presentation';

  // Luz ambiente azulada (cielo) y violeta oscuro (suelo).
  group.add(new THREE.HemisphereLight(0x9db8ff, 0x2a1840, 1.1));

  // Luz principal cálida con sombras.
  const key = new THREE.DirectionalLight(0xfff1dd, 2.2);
  key.position.set(center.x + 2.5 * r, groundY + 4.5 * r, center.z + 2 * r);
  key.target.position.set(center.x, groundY, center.z);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const shadowCam = key.shadow.camera;
  shadowCam.left = -2 * r;
  shadowCam.right = 2 * r;
  shadowCam.top = 2 * r;
  shadowCam.bottom = -2 * r;
  shadowCam.near = 0.1;
  shadowCam.far = 12 * r;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  group.add(key, key.target);

  // Luces de contorno en los colores de la marca.
  const rimBlue = new THREE.DirectionalLight(BRAND_PRIMARY, 2.4);
  rimBlue.position.set(center.x - 3 * r, groundY + 2 * r, center.z - 1.5 * r);
  rimBlue.target.position.set(center.x, groundY, center.z);
  const rimCyan = new THREE.DirectionalLight(BRAND_ACCENT, 1.8);
  rimCyan.position.set(center.x + 1.5 * r, groundY + 1.25 * r, center.z - 3 * r);
  rimCyan.target.position.set(center.x, groundY, center.z);
  group.add(rimBlue, rimBlue.target, rimCyan, rimCyan.target);

  // Piso transparente que solo recibe la sombra.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6 * r, 64),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.45 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, groundY - 0.003, center.z);
  ground.receiveShadow = true;
  group.add(ground);

  // Brillo azul bajo el modelo.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5 * r, 3.5 * r),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture('rgba(79,124,255,0.55)'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(center.x, groundY - 0.002, center.z);
  group.add(glow);

  // Grilla azul/cian tenue (la niebla la desvanece hacia los bordes).
  const grid = new THREE.GridHelper(15 * r, 30, BRAND_ACCENT, BRAND_PRIMARY);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.28;
    material.depthWrite = false;
  });
  grid.position.set(center.x, groundY - 0.001, center.z);
  group.add(grid);

  return {
    group,
    dispose: () => disposeObject3D(group),
  };
}

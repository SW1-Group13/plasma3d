import * as THREE from 'three';
import type { Material } from '@/entities/materials/types';
import { BRAND_ACCENT } from '@/widgets/viewer3d/presentation';

/**
 * Efectos del modo Animado según el tipo de material del catálogo.
 * Cada perfil arma el material de three.js y, si corresponde, una animación
 * ligera que el motor actualiza en cada cuadro.
 */

export type EffectFamily = 'vidrio' | 'metal' | 'madera' | 'barniz' | 'mamposteria' | 'revestimiento' | 'piso' | 'satinado' | 'techo';

export interface MaterialEffect {
  material: THREE.Material;
  /** Animación por cuadro (segundos desde que empezó Animado). */
  update?: (time: number) => void;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Familia de efecto a partir de la categoría (y el nombre) del material. */
export function effectFamily(material: Pick<Material, 'nombre' | 'categoria'>): EffectFamily {
  const cat = normalize(material.categoria ?? '');
  const name = normalize(material.nombre ?? '');
  if (name.includes('barniz')) return 'barniz';
  // Techos
  if (name.includes('policarbonato')) return 'vidrio';
  if (name.includes('lamina')) return 'metal';
  if (name.includes('pizarra') || name.includes('tpo')) return 'satinado';
  if (cat.includes('techo')) return name.includes('tejuela') ? 'madera' : 'techo';
  if (cat.includes('vidrio') || name.includes('vidrio')) return 'vidrio';
  if (cat.includes('metal')) return 'metal';
  if (cat.includes('madera')) return 'madera';
  if (cat.includes('mamposter') || name.includes('ladrillo') || name.includes('piedra')) return 'mamposteria';
  if (cat.includes('piso') || name.includes('ceramica')) return 'piso';
  return 'revestimiento';
}

/** Texto corto para la tarjeta del material: qué hace en Animado. */
export const EFFECT_LABEL: Record<EffectFamily, string> = {
  vidrio: 'Transparente, con brillo cian que respira',
  metal: 'Reflejos metálicos que se mueven al girar',
  madera: 'Veta de madera con brillo suave',
  barniz: 'Madera con capa brillante y destellos',
  mamposteria: 'Mate y sólido (sin animación)',
  revestimiento: 'Color liso mate (sin animación)',
  piso: 'Semibrillante, refleja las luces',
  satinado: 'Brillo satinado suave al girar',
  techo: 'Mate con relieve de las piezas (sin animación)',
};

interface EffectMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

/**
 * Crea el material de presentación (Animado) con los mapas del patrón real
 * (ladrillo, piedra, tejas…), relieve más marcado y su animación.
 * `baseColor` se usa cuando no hay textura (vidrio, sin patrón).
 */
export function createMaterialEffect(material: Material, maps: EffectMaps | null, baseColor: string): MaterialEffect {
  const family = effectFamily(material);
  const color = new THREE.Color(baseColor || material.color_difuso || '#cccccc');
  // Las piezas generadas no traen normales: flatShading las calcula por cara.
  const textured = {
    map: maps?.map ?? null,
    normalMap: maps?.normalMap ?? null,
    roughnessMap: maps?.roughnessMap ?? null,
    normalScale: new THREE.Vector2(1.6, 1.6),
    color: maps ? new THREE.Color('#ffffff') : color,
    flatShading: true,
    side: THREE.DoubleSide,
  };

  switch (family) {
    case 'vidrio': {
      const glass = new THREE.MeshPhysicalMaterial({
        color,
        flatShading: true,
        side: THREE.DoubleSide,
        roughness: Math.min(material.rugosidad ?? 0.05, 0.3),
        metalness: 0.1,
        transparent: true,
        opacity: Math.max(0.35, Math.min(material.opacidad ?? 0.4, 0.7)),
        emissive: new THREE.Color(BRAND_ACCENT),
        emissiveIntensity: 0.35,
        envMapIntensity: 1.4,
        depthWrite: false,
      });
      return {
        material: glass,
        update: (t) => {
          glass.emissiveIntensity = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.2));
        },
      };
    }
    case 'metal':
      // El reflejo se mueve rotando el entorno de la escena (lo hace el motor).
      return {
        material: new THREE.MeshStandardMaterial({
          ...textured,
          roughness: maps ? 1 : 0.3,
          metalness: Math.max(material.metalico ?? 0.9, 0.85),
          envMapIntensity: 1.6,
        }),
      };
    case 'barniz': {
      const varnish = new THREE.MeshPhysicalMaterial({
        ...textured,
        roughness: 0.6,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.2,
      });
      return {
        material: varnish,
        update: (t) => {
          varnish.clearcoatRoughness = 0.05 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.3));
        },
      };
    }
    case 'satinado':
      return { material: new THREE.MeshStandardMaterial({ ...textured, roughness: 0.75, metalness: 0.05, envMapIntensity: 1 }) };
    case 'piso':
      return { material: new THREE.MeshStandardMaterial({ ...textured, roughness: 1, metalness: 0.05, envMapIntensity: 0.9 }) };
    case 'madera':
      return { material: new THREE.MeshStandardMaterial({ ...textured, roughness: 1, metalness: 0, envMapIntensity: 0.6 }) };
    default:
      // Ladrillo, piedra, bloque, revoque, pintura, tejas: mate con relieve.
      return { material: new THREE.MeshStandardMaterial({ ...textured, roughness: 1, metalness: 0, envMapIntensity: 0.35 }) };
  }
}

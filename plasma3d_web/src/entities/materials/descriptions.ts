import type { Material } from '@/entities/materials/types';

/** Para qué sirve cada material del catálogo (por nombre). */
const DESCRIPTIONS: Record<string, string> = {
  'Ladrillo rojo': 'Muro de ladrillo visto. Para fachadas y muros portantes.',
  'Ladrillo blanco': 'Ladrillo claro o pintado. Fachadas modernas y muros interiores.',
  'Bloque hormigón': 'Bloque de concreto. Muros económicos y resistentes.',
  'Piedra natural': 'Piedra a la vista. Zócalos, fachadas y muros rústicos.',
  'Yeso blanco': 'Acabado liso de yeso. Paredes y cielos interiores.',
  Estuco: 'Revoque fino y liso. Paredes exteriores e interiores.',
  Cemento: 'Revoque de cemento. Muros, losas y techos planos.',
  'Ceramica piso': 'Cerámica esmaltada. Pisos de cocina, baño y ambientes.',
  Roble: 'Madera dura y clara. Puertas y pisos de calidad.',
  Pino: 'Madera blanda y económica. Puertas interiores y marcos.',
  Nogal: 'Madera oscura. Puertas principales y detalles.',
  Barniz: 'Madera con barniz brillante. Puertas y muebles terminados.',
  'Vidrio transparente': 'Vidrio claro común. Ventanas.',
  'Vidrio esmerilado': 'Vidrio opaco que da privacidad. Baños y divisiones.',
  'Vidrio templado azulado': 'Vidrio de seguridad con tinte azul. Ventanales y fachadas.',
  Aluminio: 'Metal liviano. Marcos de ventanas y puertas.',
  Acero: 'Metal resistente. Puertas de seguridad y estructuras.',
  'Hierro forjado': 'Metal oscuro trabajado. Rejas, portones y barandas.',
  'Blanca mate': 'Pintura blanca sin brillo. Paredes interiores.',
  'Gris perla': 'Pintura gris claro. Paredes y fachadas.',
  Beige: 'Pintura beige cálida. Paredes interiores y exteriores.',
  Terracota: 'Pintura color arcilla. Fachadas y techos.',
  'Teja de arcilla': 'Teja curva clásica. Durable y fresca, para techos inclinados.',
  'Teja de concreto': 'Teja plana de concreto. Económica y resistente, techos inclinados.',
  'Teja asfáltica': 'Tejuelas de asfalto livianas. Fáciles de instalar en techos inclinados.',
  'Lámina trapezoidal': 'Lámina metálica de crestas planas. Galpones, garajes y casas modernas.',
  'Lámina corrugada': 'Calamina ondulada galvanizada. Económica y rápida de instalar.',
  Pizarra: 'Placas de piedra pizarra. Muy durable y elegante, para pendientes fuertes.',
  'Tejuela de madera': 'Tejuelas de madera natural. Aspecto rústico, techos inclinados.',
  Policarbonato: 'Placas translúcidas. Deja pasar la luz: patios, galerías y aleros.',
  'Alquitrán y grava': 'Capas de alquitrán con grava. Techos planos o casi planos.',
  'Caucho EPDM': 'Membrana de caucho. Impermeable para techos planos.',
  'Membrana TPO': 'Membrana blanca reflectante. Techos planos, reduce el calor.',
  'Techo verde': 'Cubierta con vegetación. Aísla, retiene agua y es ecológica.',
};

/** Texto genérico por categoría (materiales creados por el usuario). */
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  mamposteria: 'Material de muro.',
  revestimiento: 'Acabado de paredes y techos.',
  pintura: 'Color de pintura para paredes.',
  madera: 'Madera para puertas y pisos.',
  vidrio: 'Vidrio para ventanas.',
  metal: 'Metal para marcos, puertas y rejas.',
  piso: 'Material de piso.',
  techo: 'Material de cubierta para techos.',
};

/** Grupos de la lista, en orden, con su nombre visible. */
export const MATERIAL_GROUPS: { key: string; label: string }[] = [
  { key: 'mamposteria', label: 'Mampostería (muros)' },
  { key: 'revestimiento', label: 'Revestimientos' },
  { key: 'pintura', label: 'Pinturas' },
  { key: 'madera', label: 'Maderas' },
  { key: 'vidrio', label: 'Vidrios' },
  { key: 'metal', label: 'Metales' },
  { key: 'piso', label: 'Pisos' },
  { key: 'techo', label: 'Techos' },
  { key: 'otros', label: 'Otros' },
];

/** Categorías recomendadas para cada tipo de pieza. */
const RECOMMENDED: Record<string, string[]> = {
  wall: ['mamposteria', 'revestimiento', 'pintura'],
  door: ['madera', 'metal'],
  window: ['vidrio'],
  floor: ['piso'],
  roof: ['techo'],
};

export const KIND_LABELS: Record<string, string> = {
  wall: 'esta pared',
  door: 'esta puerta',
  window: 'esta ventana',
  floor: 'este piso',
  roof: 'este techo',
};

export function categoryKey(categoria: string): string {
  const key = (categoria ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return MATERIAL_GROUPS.some((g) => g.key === key) ? key : 'otros';
}

export function describeMaterial(material: Material): string {
  return DESCRIPTIONS[material.nombre] ?? CATEGORY_DESCRIPTIONS[categoryKey(material.categoria)] ?? 'Material personalizado.';
}

/** Etiquetas de propiedades visibles (Mate, Brillante, Metálico, Transparente). */
export function materialTags(material: Material): string[] {
  const tags: string[] = [];
  if (material.opacidad < 0.9) tags.push(categoryKey(material.categoria) === 'techo' ? 'Translúcido' : 'Transparente');
  if (material.metalico >= 0.5) tags.push('Metálico');
  tags.push(material.rugosidad <= 0.4 ? 'Brillante' : 'Mate');
  if (material.textura_url) tags.push('Con textura');
  return tags;
}

/**
 * Materiales ordenados para el selector: primero los recomendados para el
 * tipo de pieza, luego el resto agrupado por categoría (orden alfabético).
 */
export function groupMaterials(materials: Material[], kind: string) {
  const sorted = [...materials].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const recommendedKeys = RECOMMENDED[kind] ?? [];
  const recommended = sorted.filter((m) => recommendedKeys.includes(categoryKey(m.categoria)));
  const groups = MATERIAL_GROUPS.map((group) => ({
    ...group,
    items: sorted.filter((m) => categoryKey(m.categoria) === group.key && !recommended.includes(m)),
  })).filter((group) => group.items.length > 0);
  return { recommended, groups };
}

/**
 * Dimensiones del editor, alineadas con el backend (plans/three.py) para que
 * los elementos dibujados coincidan con los generados.
 */
export const WALL_HEIGHT_M = 3.0;
export const WALL_THICKNESS_M = 0.3;

// Vanos reales: puerta de 2.10 m; ventana de 0.90 a 2.10 m. Encima (dintel)
// y debajo de la ventana (antepecho) hay muro.
export const DOOR_HEIGHT_M = 2.1;

export const WINDOW_SILL_M = 0.9;
export const WINDOW_HEAD_M = 2.1;
export const WINDOW_HEIGHT_M = WINDOW_HEAD_M - WINDOW_SILL_M;

// Marco, vidrio y cruz de ventana; hoja de puerta.
export const FRAME_M = 0.05;
export const GLASS_M = 0.012;
export const WINDOW_BAR_THICK_M = 0.03;
export const DOOR_LEAF_M = 0.04;

// Piso (losa) y techo: mismos valores que el backend (plans/three.py).
export const SLAB_THICKNESS_M = 0.15;
export const ROOF_THICKNESS_M = 0.12;
export const ROOF_PITCH_DEG = 25;
export const ROOF_OVERHANG_M = 0.3;

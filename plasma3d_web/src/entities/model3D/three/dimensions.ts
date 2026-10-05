/**
 * Dimensiones del editor, alineadas con el backend (plans/three.py) para que
 * los elementos dibujados coincidan con los generados.
 */
export const WALL_HEIGHT_M = 3.0;
export const WALL_THICKNESS_M = 0.3;

export const DOOR_HEIGHT_M = WALL_HEIGHT_M;

export const WINDOW_SILL_M = 0.9;
export const WINDOW_HEIGHT_M = WALL_HEIGHT_M - WINDOW_SILL_M;

// Grosor de las barras de la cruz y de la tapa superior de la ventana.
export const WINDOW_BAR_THICK_M = 0.03;
export const WINDOW_TOP_THICK_M = 0.03;

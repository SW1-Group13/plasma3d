/**
 * Sugerencias rápidas (chips) del Agente IA según lo que hay en el editor.
 * Es una función pura: no llama a la IA, no cuesta nada.
 */
export interface AgentChip {
  /** Texto del chip. */
  label: string;
  /** Mensaje que se envía al agente. */
  text: string;
  /**
   * Si es true, el texto se pone en el cuadro (para completar un número)
   * en vez de enviarse directo.
   */
  edit?: boolean;
}

export interface ChipContext {
  /** Tipo de la pieza seleccionada ('wall' | 'door' | 'window' | 'floor' | 'roof' | ...). */
  kind?: string | null;
  /** Cantidad de piezas seleccionadas. */
  count: number;
  /** El modelo tiene plano original (para comparar). */
  hasPlan: boolean;
  /** Último mensaje del agente (para chips de sí/no). */
  lastAgentText?: string;
}

const YES_NO = /(¿\s*(lo|la|los|las)\s+(dibujo|agrego|aplico|hago|coloco|cambio)\b[^?]*\?|¿\s*(quieres|deseas)\s+que\b[^?]*\?)\s*$/i;

export function chipsFor({ kind, count, hasPlan, lastAgentText }: ChipContext): AgentChip[] {
  // El agente acaba de preguntar "¿Lo dibujo?" → responder con un toque.
  if (lastAgentText && YES_NO.test(lastAgentText.trim())) {
    return [
      { label: 'Sí, hazlo', text: 'Sí, hazlo.' },
      { label: 'No, gracias', text: 'No, gracias.' },
      { label: '¿Cuánto costaría?', text: '¿Cuánto costaría eso?' },
    ];
  }

  if (count > 1) {
    return [
      { label: 'Cambiar material a todas', text: 'Cambia el material de las piezas seleccionadas a ', edit: true },
      { label: '¿Cuánto cuestan?', text: '¿Cuánto cuestan las piezas seleccionadas?' },
      { label: 'Ajustar al muro', text: 'Ajusta al muro las puertas y ventanas seleccionadas.' },
    ];
  }

  if (count === 1 && kind === 'wall') {
    return [
      { label: 'Cambiar material', text: '¿Qué materiales puedo usar en este muro y cuánto cuesta cada uno?' },
      { label: 'Agregar ventana aquí', text: 'Agrega una ventana de 1.2 m centrada en el muro seleccionado.' },
      { label: 'Hazlo de __ m', text: 'Haz el muro seleccionado de  m de largo.', edit: true },
      { label: '¿Cuánto cuesta este muro?', text: '¿Cuánto cuesta el muro seleccionado?' },
    ];
  }

  if (count === 1 && (kind === 'door' || kind === 'window')) {
    const name = kind === 'door' ? 'la puerta' : 'la ventana';
    return [
      { label: 'Gírala 90°', text: `Gira ${name} seleccionada 90 grados.` },
      { label: 'Hazla de 1.2 m', text: `Haz ${name} seleccionada de 1.2 m de ancho.` },
      { label: 'Muévela 50 cm →', text: `Mueve ${name} seleccionada 50 cm a la derecha.` },
      { label: 'Ajustar al muro', text: `Ajusta ${name} seleccionada a su muro.` },
    ];
  }

  if (count === 1 && kind === 'floor') {
    return [
      { label: 'Cambiar material', text: '¿Qué materiales de piso puedo usar y cuánto cuesta cada uno?' },
      { label: '¿Cuánto cuesta este piso?', text: '¿Cuánto cuesta el piso seleccionado?' },
    ];
  }

  const chips: AgentChip[] = [
    { label: '¿Qué le puedo aumentar?', text: '¿Qué le puedo aumentar a mi plano?' },
    { label: '¿Cuánto cuesta todo?', text: '¿Cuánto cuesta todo el modelo?' },
    { label: 'Dibuja un cuarto 3×4 m', text: 'Dibuja un cuarto de 3 × 4 m con piso, pegado al plano.' },
  ];
  if (hasPlan) chips.push({ label: '¿Falta algo vs. mi plano?', text: '¿Falta algo comparado con mi plano original?' });
  return chips;
}

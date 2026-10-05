import { http } from '@/shared/api/http';
import type { Layer, LineType } from '@/entities/layers/types';

interface ApiLayer {
  id: number;
  nombre: string;
  color: string;
  visible: boolean;
  bloqueada: boolean;
  congelada: boolean;
  grosor_linea: number;
  tipo_linea: string;
  transparencia: number;
  descripcion: string;
}

function map(l: ApiLayer): Layer {
  return {
    id: String(l.id),
    nombre: l.nombre,
    color: l.color,
    visible: l.visible,
    bloqueada: l.bloqueada,
    congelada: l.congelada,
    grosorLinea: l.grosor_linea,
    tipoLinea: l.tipo_linea as LineType,
    transparencia: l.transparencia,
    descripcion: l.descripcion,
  };
}

function toApi(patch: Partial<Layer>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.nombre !== undefined) body.nombre = patch.nombre;
  if (patch.color !== undefined) body.color = patch.color;
  if (patch.visible !== undefined) body.visible = patch.visible;
  if (patch.bloqueada !== undefined) body.bloqueada = patch.bloqueada;
  if (patch.congelada !== undefined) body.congelada = patch.congelada;
  if (patch.grosorLinea !== undefined) body.grosor_linea = patch.grosorLinea;
  if (patch.tipoLinea !== undefined) body.tipo_linea = patch.tipoLinea;
  if (patch.transparencia !== undefined) body.transparencia = patch.transparencia;
  if (patch.descripcion !== undefined) body.descripcion = patch.descripcion;
  return body;
}

export const layersApi = {
  async list(): Promise<Layer[]> {
    const { data } = await http.get<ApiLayer[]>('api/catalog/layers/');
    return data.map(map);
  },
  async create(partial: Partial<Layer>): Promise<Layer> {
    const { data } = await http.post<ApiLayer>('api/catalog/layers/', toApi(partial));
    return map(data);
  },
  async update(id: string, patch: Partial<Layer>): Promise<Layer> {
    const { data } = await http.patch<ApiLayer>(`api/catalog/layers/${id}/`, toApi(patch));
    return map(data);
  },
  async remove(id: string): Promise<void> {
    await http.delete(`api/catalog/layers/${id}/`);
  },
};

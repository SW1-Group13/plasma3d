import { http } from '@/shared/api/http';
import type { Material } from '@/entities/materials/types';

interface ApiMaterial {
  id: number;
  nombre: string;
  categoria: string;
  textura: string | null;
  textura_path: string;
  textura_url: string | null;
  color_difuso: string;
  rugosidad: number;
  reflectividad: number;
  metalico: number;
  opacidad: number;
  escala_u: number;
  escala_v: number;
}

function map(m: ApiMaterial): Material {
  return {
    id: String(m.id),
    nombre: m.nombre,
    categoria: m.categoria,
    textura_url: m.textura_url ?? m.textura_path ?? undefined,
    color_difuso: m.color_difuso,
    rugosidad: m.rugosidad,
    reflectividad: m.reflectividad,
    metalico: m.metalico,
    opacidad: m.opacidad,
    escala_textura: [m.escala_u, m.escala_v],
  };
}

export interface MaterialInput {
  nombre: string;
  categoria: string;
  color_difuso: string;
  rugosidad: number;
  reflectividad: number;
  metalico: number;
  opacidad: number;
  escala_textura: [number, number];
  textura_path?: string;
}

function appendCommon(formData: FormData, input: Partial<MaterialInput>) {
  if (input.nombre !== undefined) formData.append('nombre', input.nombre);
  if (input.categoria !== undefined) formData.append('categoria', input.categoria);
  if (input.color_difuso !== undefined) formData.append('color_difuso', input.color_difuso);
  if (input.rugosidad !== undefined) formData.append('rugosidad', String(input.rugosidad));
  if (input.reflectividad !== undefined) formData.append('reflectividad', String(input.reflectividad));
  if (input.metalico !== undefined) formData.append('metalico', String(input.metalico));
  if (input.opacidad !== undefined) formData.append('opacidad', String(input.opacidad));
  if (input.escala_textura) {
    formData.append('escala_u', String(input.escala_textura[0]));
    formData.append('escala_v', String(input.escala_textura[1]));
  }
  if (input.textura_path !== undefined) formData.append('textura_path', input.textura_path);
}

export const materialsApi = {
  async list(): Promise<Material[]> {
    const { data } = await http.get<ApiMaterial[]>('api/catalog/materials/');
    return data.map(map);
  },

  async create(input: MaterialInput, file?: File | null): Promise<Material> {
    const formData = new FormData();
    appendCommon(formData, input);
    if (file) formData.append('textura', file);
    const { data } = await http.post<ApiMaterial>('api/catalog/materials/', formData);
    return map(data);
  },

  async update(id: string, input: Partial<MaterialInput>, file?: File | null): Promise<Material> {
    const formData = new FormData();
    appendCommon(formData, input);
    if (file) formData.append('textura', file);
    const { data } = await http.patch<ApiMaterial>(`api/catalog/materials/${id}/`, formData);
    return map(data);
  },

  async remove(id: string): Promise<void> {
    await http.delete(`api/catalog/materials/${id}/`);
  },
};

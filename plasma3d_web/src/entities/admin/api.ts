import { http } from '@/shared/api/http';
import type {
  AdminAiSettings,
  AdminMetrics,
  AdminPayment,
  AdminRole,
  AdminUser,
  AdminUsersResponse,
} from '@/entities/admin/types';

export const adminApi = {
  async metrics(): Promise<AdminMetrics> {
    const { data } = await http.get<AdminMetrics>('api/users/admin/metricas/');
    return data;
  },

  async users(): Promise<AdminUsersResponse> {
    const { data } = await http.get<AdminUsersResponse>('api/users/admin/usuarios/');
    return data;
  },

  async updateUser(
    id: number,
    patch: { rol?: AdminRole; nombre?: string; telefono?: number | null },
  ): Promise<AdminUser> {
    const { data } = await http.patch<AdminUser>(
      `api/users/admin/usuarios/${id}/`,
      patch,
    );
    return data;
  },

  async payments(): Promise<AdminPayment[]> {
    const { data } = await http.get<AdminPayment[]>('api/users/admin/pagos/');
    return data;
  },

  async aiSettings(): Promise<AdminAiSettings> {
    const { data } = await http.get<AdminAiSettings>(
      'api/suggestion_risk/config/ollama/',
    );
    return data;
  },

  async updateAiSettings(patch: {
    ollama_url?: string;
    ollama_models?: string;
    ollama_timeout?: number | null;
  }): Promise<AdminAiSettings> {
    const { data } = await http.patch<AdminAiSettings>(
      'api/suggestion_risk/config/ollama/',
      patch,
    );
    return data;
  },
};

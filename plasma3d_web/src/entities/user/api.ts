import { http } from '@/shared/api/http';
import type { UserInterface, UserRegister } from '@/entities/user/types';

export const userApi = {
  async get(id: number): Promise<UserInterface> {
    const { data } = await http.get<UserInterface>(`api/users/usuarios/${id}/`);
    return data;
  },

  async edit(id: number, user: Partial<UserRegister>): Promise<UserInterface> {
    const { data } = await http.patch<UserInterface>(`api/users/usuarios/${id}/`, user);
    return data;
  },
};

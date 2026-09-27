import { http } from '@/shared/api/http';
import type {
  LoginResponse,
  UserInterface,
  UserLogin,
  UserRegister,
} from '@/entities/user/types';

export const authApi = {
  async login(credentials: UserLogin): Promise<LoginResponse> {
    const { data } = await http.post<LoginResponse>('api/users/auth/login/', {
      email: credentials.email,
      password: credentials.password,
    });
    return data;
  },

  async register(payload: UserRegister): Promise<unknown> {
    const { data } = await http.post('api/users/auth/registro/', {
      nombre: payload.nombre,
      email: payload.email,
      password: payload.password,
      rol: payload.rol,
      fecha_expiracion_plan: null,
      fecha_registro: null,
      telefono: payload.telefono,
      url: payload.url,
    });
    return data;
  },
};

export function toUserInterface(response: LoginResponse): UserInterface {
  const u = response.usuario;
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    fecha_expiracion_plan: response.fecha_expiracion_plan ?? u.fecha_expiracion_plan ?? '',
    fecha_registro: response.fecha_registro ?? u.fecha_registro ?? '',
    telefono: u.telefono,
    url: u.url,
  };
}

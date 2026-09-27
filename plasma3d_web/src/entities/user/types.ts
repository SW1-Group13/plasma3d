export interface UserInterface {
  id: number;
  nombre: string;
  email: string;
  rol?: string;
  fecha_expiracion_plan?: string;
  fecha_registro?: string;
  telefono: string;
  url: string;
}

export interface UserRegister {
  nombre: string;
  email: string;
  password?: string;
  rol: string;
  fecha_expiracion_plan?: string | null;
  fecha_registro?: string | null;
  telefono: string;
  url?: string;
}

export interface UserLogin {
  email: string;
  password: string;
}

export interface Usuario extends UserInterface {
  password?: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  usuario: Usuario;
  fecha_expiracion_plan?: string;
  fecha_registro?: string;
}

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '@/entities/session/store';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user);
  if (user?.rol !== 'administrador') {
    return <Navigate to="/private/dashboard" replace />;
  }
  return <>{children}</>;
}

import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '@/entities/session/store';

export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user);
  const location = useLocation();

  if (!user?.id) {
    return <Navigate to="/login" replace state={{ returnUrl: location.pathname }} />;
  }

  return <>{children}</>;
}

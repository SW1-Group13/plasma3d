import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicLayout } from '@/widgets/layout/PublicLayout';
import { PrivateLayout } from '@/widgets/layout/PrivateLayout';
import { RequireAuth } from '@/app/RequireAuth';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EditorPage } from '@/pages/EditorPage';
import { PerfilPage } from '@/pages/PerfilPage';
import { PaymentPage } from '@/pages/PaymentPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />

      <Route element={<PublicLayout />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route
        path="/private"
        element={
          <RequireAuth>
            <PrivateLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/private/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="perfil" element={<PerfilPage />} />
        <Route path="editor" element={<EditorPage />} />
        <Route path="pago" element={<PaymentPage />} />
        <Route path="*" element={<Navigate to="/private/perfil" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

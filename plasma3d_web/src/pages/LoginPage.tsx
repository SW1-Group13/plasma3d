import { LoginForm } from '@/features/auth/ui/LoginForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

export function LoginPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Iniciar sesion</CardTitle>
          <CardDescription>Accede a tu cuenta de Plasma3D.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}

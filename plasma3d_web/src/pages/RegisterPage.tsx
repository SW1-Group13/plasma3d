import { RegisterForm } from '@/features/auth/ui/RegisterForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

export function RegisterPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Crear cuenta</CardTitle>
          <CardDescription>Empieza a modelar tus planos en 3D.</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm />
        </CardContent>
      </Card>
    </div>
  );
}

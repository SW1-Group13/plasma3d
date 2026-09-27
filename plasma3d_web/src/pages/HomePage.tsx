import { Link } from 'react-router-dom';
import { HomeViewer } from '@/widgets/viewer3d/HomeViewer';
import { Button } from '@/shared/ui/button';

export function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            De planos 2D a modelos 3D
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Modela tus planos en 3D con <span className="text-blue-600">Plasma3D</span>
          </h1>
          <p className="text-lg text-slate-600">
            Sube tu plano, la IA detecta muros, puertas y ventanas, y los convierte en un modelo
            3D editable. Personaliza texturas, calcula presupuestos y verifica en blockchain.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/register">Comenzar gratis</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/login">Iniciar sesion</Link>
            </Button>
          </div>
        </div>

        <div className="h-[420px] overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <HomeViewer />
        </div>
      </div>
    </div>
  );
}

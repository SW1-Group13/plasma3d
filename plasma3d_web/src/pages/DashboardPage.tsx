import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { useModelStore } from '@/entities/model3D/store';
import { useSession } from '@/entities/session/store';
import { Modelo3D } from '@/entities/model3D/three/Modelo3D';
import { TEXTURES } from '@/entities/model3D/three/textures';
import { env } from '@/shared/config/env';
import { BackgroundTask } from '@/shared/ui/loader';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Skeleton } from '@/shared/ui/spinner';
import { CubeIcon, LayersIcon, PlusIcon, UploadIcon } from '@/shared/ui/icons';
import { toast } from '@/shared/ui/toast';

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useSession((s) => s.user);

  const list = useModelStore((s) => s.list);
  const isLoading = useModelStore((s) => s.isLoading);
  const fetchModels = useModelStore((s) => s.fetch);
  const uploadPlan = useModelStore((s) => s.uploadPlan);
  const uploadGlb = useModelStore((s) => s.saveGlb);

  const planInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [task, setTask] = useState<string | null>(null);

  useEffect(() => {
    fetchModels().catch(() => toast.error('Error', 'No se pudieron cargar los modelos.'));
  }, [fetchModels]);

  async function onPlanSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) return;
    setTask('Subiendo y procesando plano...');
    try {
      await uploadPlan(file, user.id);
      toast.success('Exito', 'Modelo subido con exito.');
    } catch {
      toast.error('Error', 'No se pudo subir el modelo.');
    } finally {
      setTask(null);
    }
  }

  async function onGlbSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) return;
    setTask('Subiendo modelo 3D...');
    try {
      await uploadGlb(file, user.id);
      toast.success('Exito', 'Modelo 3D subido con exito.');
    } catch {
      toast.error('Error', 'No se pudo subir el modelo 3D.');
    } finally {
      setTask(null);
    }
  }

  async function onCreateModel() {
    if (!user) return;
    setCreating(true);
    setTask('Creando modelo 3D...');
    try {
      const random = Math.floor(Math.random() * 1000);
      const empty = new Modelo3D(
        null,
        null,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 1, 1),
        new THREE.Euler(0, 0, 0),
        TEXTURES,
      );
      const { blob } = await empty.exportAsGLB(`job_${random}`);
      const file = new File([blob], `job_${random}.glb`, { type: 'model/gltf-binary' });
      await uploadGlb(file, user.id);
      toast.success('Exito', 'Modelo 3D creado con exito.');
    } catch {
      toast.error('Error', 'No se pudo crear el modelo 3D.');
    } finally {
      setCreating(false);
      setTask(null);
    }
  }

  function openModel(model: (typeof list)[number]) {
    localStorage.setItem('modelo', JSON.stringify(model));
    navigate('/private/editor');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Mis modelos</h1>
          <p className="mt-1 text-sm text-muted">Sube un plano o un GLB y editalo en 3D.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={planInputRef} type="file" accept="image/*" hidden onChange={onPlanSelected} />
          <input ref={glbInputRef} type="file" accept=".glb,.gltf" hidden onChange={onGlbSelected} />
          <Button variant="outline" onClick={() => planInputRef.current?.click()} disabled={isLoading}>
            <UploadIcon width={16} height={16} /> Subir plano
          </Button>
          <Button variant="outline" onClick={() => glbInputRef.current?.click()} disabled={isLoading}>
            <UploadIcon width={16} height={16} /> Subir GLB
          </Button>
          <Button onClick={onCreateModel} disabled={creating || isLoading}>
            <PlusIcon width={16} height={16} /> Crear modelo
          </Button>
        </div>
      </div>

      {isLoading && list.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              <Skeleton className="h-40 w-full rounded-none" />
              <div className="flex flex-col gap-3 p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-dashed border-border bg-surface/50 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <CubeIcon className="h-7 w-7" />
          </span>
          <div>
            <p className="font-medium text-foreground">No tienes modelos todavia</p>
            <p className="mt-1 text-sm text-muted">Sube un plano o crea un modelo vacio para empezar.</p>
          </div>
          <Button onClick={onCreateModel} disabled={creating}>
            <PlusIcon width={16} height={16} /> Crear modelo
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((model) => {
            const image = model.plan_image
              ? `${env.apiUrl}${model.plan_image.replace(/^\//, '')}`
              : null;
            return (
              <article
                key={model.id}
                className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-lg shadow-black/20 transition-all duration-150 hover:border-border-strong hover:shadow-xl hover:shadow-black/30"
              >
                <button
                  type="button"
                  onClick={() => image && setPreview(image)}
                  className="relative h-40 w-full cursor-pointer overflow-hidden border-b border-border bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70"
                  aria-label={`Ver plano del modelo ${model.id}`}
                  disabled={!image}
                >
                  <img
                    src={image ?? '/assets/imagen-defecto.jpg'}
                    alt={`Plano del modelo ${model.id}`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                  <span className="absolute left-2 top-2">
                    <Badge className="bg-black/60 text-white backdrop-blur">
                      <LayersIcon width={12} height={12} /> #{model.id}
                    </Badge>
                  </span>
                </button>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <p className="font-semibold text-foreground">Modelo #{model.id}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted">
                      {model.widht ?? '-'} x {model.height ?? '-'} ·{' '}
                      {model.created_at ? new Date(model.created_at).toLocaleDateString() : '-'}
                    </p>
                  </div>

                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => openModel(model)}>
                      Abrir editor
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <BackgroundTask show={!!task} label={task ?? ''} />

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-modal="true"
        >
          <img src={preview} alt="Vista previa del plano" className="max-h-[85vh] max-w-[90vw] rounded-xl border border-border" />
        </div>
      )}
    </div>
  );
}

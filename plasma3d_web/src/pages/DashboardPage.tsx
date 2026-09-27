import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { useModelStore } from '@/entities/model3D/store';
import { useSession } from '@/entities/session/store';
import { useBlockchainStore } from '@/entities/blockchain/store';
import { Modelo3D } from '@/entities/model3D/three/Modelo3D';
import { TEXTURES } from '@/entities/model3D/three/textures';
import { env } from '@/shared/config/env';
import { ModalBlockchain } from '@/features/blockchain/ui/ModalBlockchain';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { FullPageSpinner, Spinner } from '@/shared/ui/spinner';
import { CubeIcon, PlusIcon } from '@/shared/ui/icons';
import { toast } from '@/shared/ui/toast';

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useSession((s) => s.user);

  const list = useModelStore((s) => s.list);
  const isLoading = useModelStore((s) => s.isLoading);
  const fetchModels = useModelStore((s) => s.fetch);
  const uploadPlan = useModelStore((s) => s.uploadPlan);
  const uploadGlb = useModelStore((s) => s.saveGlb);

  const setImageToVerify = useBlockchainStore((s) => s.setImageToVerify);

  const planInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [blockchainOpen, setBlockchainOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchModels().catch(() => toast.error('Error', 'No se pudieron cargar los modelos.'));
  }, [fetchModels]);

  async function onPlanSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) return;
    try {
      await uploadPlan(file, user.id);
      toast.success('Exito', 'Modelo subido con exito.');
    } catch {
      toast.error('Error', 'No se pudo subir el modelo.');
    }
  }

  async function onGlbSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user) return;
    try {
      await uploadGlb(file, user.id);
      toast.success('Exito', 'Modelo 3D subido con exito.');
    } catch {
      toast.error('Error', 'No se pudo subir el modelo 3D.');
    }
  }

  async function onCreateModel() {
    if (!user) return;
    setCreating(true);
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
    }
  }

  function openModel(model: (typeof list)[number]) {
    localStorage.setItem('modelo', JSON.stringify(model));
    navigate('/private/editor');
  }

  function openBlockchain(id: number, url: string) {
    setImageToVerify({ id, url: url.replace(/^\//, '') });
    setBlockchainOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mis modelos</h1>
          <p className="text-sm text-slate-500">Sube un plano o un GLB y editelo en 3D.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={planInputRef} type="file" accept="image/*" hidden onChange={onPlanSelected} />
          <input ref={glbInputRef} type="file" accept=".glb,.gltf" hidden onChange={onGlbSelected} />
          <Button variant="outline" onClick={() => planInputRef.current?.click()} disabled={isLoading}>
            Subir plano
          </Button>
          <Button variant="outline" onClick={() => glbInputRef.current?.click()} disabled={isLoading}>
            Subir GLB
          </Button>
          <Button onClick={onCreateModel} disabled={creating || isLoading}>
            {creating ? <Spinner className="h-4 w-4" /> : <PlusIcon width={16} height={16} />}
            Crear modelo
          </Button>
        </div>
      </div>

      {isLoading && list.length === 0 ? (
        <FullPageSpinner label="Cargando modelos..." />
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center text-slate-500">
            <CubeIcon className="h-10 w-10 text-slate-300" />
            <p>No tienes modelos todavia. Sube un plano para empezar.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((model) => {
            const image = model.plan_image
              ? `${env.apiUrl}${model.plan_image.replace(/^\//, '')}`
              : null;
            return (
              <Card key={model.id} className="flex flex-col overflow-hidden">
                <div className="h-40 w-full bg-slate-100">
                  {image ? (
                    <img
                      src={image}
                      alt={`Modelo ${model.id}`}
                      className="h-full w-full cursor-pointer object-cover"
                      onClick={() => setPreview(image)}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-300">
                      <CubeIcon className="h-12 w-12" />
                    </div>
                  )}
                </div>
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <p className="font-semibold text-slate-800">Modelo #{model.id}</p>
                    <p className="text-xs text-slate-500">
                      {model.widht ?? '-'} x {model.height ?? '-'} ·{' '}
                      {model.created_at ? new Date(model.created_at).toLocaleDateString() : '-'}
                    </p>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => openModel(model)}>
                      Abrir editor
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openBlockchain(model.id, model.plan_image ?? '')}
                      disabled={!model.plan_image}
                    >
                      Blockchain
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ModalBlockchain open={blockchainOpen} onClose={() => setBlockchainOpen(false)} />

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4"
          onClick={() => setPreview(null)}
        >
          <img src={preview} alt="Vista previa" className="max-h-[85vh] max-w-[90vw] rounded-lg" />
        </div>
      )}
    </div>
  );
}

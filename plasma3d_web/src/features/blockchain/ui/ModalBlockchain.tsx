import { useState } from 'react';
import * as THREE from 'three';
import { useBlockchainStore } from '@/entities/blockchain/store';
import { Modelo3D } from '@/entities/model3D/three/Modelo3D';
import { TEXTURES } from '@/entities/model3D/three/textures';
import { env } from '@/shared/config/env';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { ShieldIcon } from '@/shared/ui/icons';
import { toast } from '@/shared/ui/toast';

interface ModalBlockchainProps {
  open: boolean;
  onClose: () => void;
}

export function ModalBlockchain({ open, onClose }: ModalBlockchainProps) {
  const imageOriginal = useBlockchainStore((s) => s.imageToVerify);
  const verify = useBlockchainStore((s) => s.verify);

  const [previewImage, setPreviewImage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  function onImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const blob = new Blob([reader.result as ArrayBuffer], { type: 'image/png' });
      const fixedFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.png'), { type: 'image/png' });
      setPreviewImage(URL.createObjectURL(fixedFile));
      setSelectedFile(fixedFile);
    };
    reader.readAsArrayBuffer(file);
  }

  async function onVerifyImage() {
    if (!selectedFile) {
      toast.error('Falta la imagen', 'Selecciona una imagen para verificar.');
      return;
    }

    setIsVerifying(true);
    try {
      const emptyModel = new Modelo3D(
        null,
        null,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 1, 1),
        new THREE.Euler(0, 0, 0),
        TEXTURES,
      );
      const { blob } = await emptyModel.exportAsGLB(`job_${Date.now()}.glb`);
      const modelFile = new File([blob], `job_${Date.now()}.glb`, { type: 'model/gltf-binary' });
      const jsonFile = new File([JSON.stringify({}, null, 2)], `archivo_vacio_${Date.now()}.json`, {
        type: 'application/json',
      });

      const response = await verify(selectedFile, imageOriginal.id, jsonFile, modelFile);

      if (response.details.image.valid) {
        toast.success('Verificacion exitosa', 'La imagen coincide con el registro on-chain.');
      } else {
        toast.error('Verificacion fallida', 'La imagen no coincide con el registro on-chain.');
      }
      onClose();
    } catch {
      toast.error('Error de verificacion', 'Ocurrio un error durante la verificacion.');
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldIcon width={18} height={18} className="text-accent" /> Verificar en blockchain
          </DialogTitle>
          <DialogDescription>
            Compara una imagen con el registro original almacenado on-chain.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Imagen original (referencia)</Label>
            {imageOriginal.url ? (
              <img
                src={`${env.apiUrl}${imageOriginal.url}`}
                alt="Imagen original"
                className="h-40 w-full rounded-lg border border-border bg-surface-2 object-contain"
              />
            ) : (
              <span className="text-sm text-muted">Sin imagen de referencia.</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verify-image">Imagen a verificar</Label>
            <Input id="verify-image" type="file" accept="image/*" onChange={onImageSelected} />
          </div>

          {previewImage && (
            <img
              src={previewImage}
              alt="Vista previa"
              className="h-40 w-full rounded-lg border border-border bg-surface-2 object-contain"
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onVerifyImage} disabled={isVerifying}>
            {isVerifying && <Spinner className="h-4 w-4" />}
            Verificar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ViewName } from '@/widgets/viewer3d/engine';
import { useThemeStore } from '@/entities/theme/store';
import { cn } from '@/shared/lib/utils';

interface ViewCubeProps {
  getQuaternion: () => THREE.Quaternion | null;
  onDirection: (dir: { x: number; y: number; z: number }, ortho?: boolean) => void;
  onSelect: (view: ViewName) => void;
  className?: string;
}

const CUBE_SIZE = 132;
const HALF = 0.85;
const AXIS_COLORS = {
  x: '#ef4444',
  y: '#22c55e',
  z: '#3b82f6',
};

const FACE_COLORS = {
  dark: {
    top: '#243049',
    bottom: '#161e30',
    border: '#3b4a66',
    text: '#dbe3f0',
    edge: 0x0a0e1a,
    highlight: 0x6b93ff,
  },
  light: {
    top: '#ffffff',
    bottom: '#eaf0f8',
    border: '#afbed2',
    text: '#243147',
    edge: 0x8fa2bc,
    highlight: 0xc7dbff,
  },
} as const;

type FaceDef = { label: string; accent: keyof typeof AXIS_COLORS };

// Orden de materiales de BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
const FACES: FaceDef[] = [
  { label: 'RIGHT', accent: 'x' },
  { label: 'LEFT', accent: 'x' },
  { label: 'TOP', accent: 'y' },
  { label: 'BOTTOM', accent: 'y' },
  { label: 'FRONT', accent: 'z' },
  { label: 'BACK', accent: 'z' },
];

function makeFaceTexture({ label, accent }: FaceDef, theme: 'dark' | 'light'): THREE.CanvasTexture {
  const size = 256;
  const colors = FACE_COLORS[theme];
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Fondo con leve gradiente
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, colors.top);
  gradient.addColorStop(1, colors.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Franja de eje
  ctx.fillStyle = AXIS_COLORS[accent];
  ctx.fillRect(0, 0, size, 14);

  // Borde
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, size - 8, size - 8);

  // Texto
  ctx.fillStyle = colors.text;
  ctx.font = 'bold 40px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function ViewCube({ getQuaternion, onDirection, onSelect, className }: ViewCubeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(CUBE_SIZE, CUBE_SIZE, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    camera.position.set(0, 0, 3.2);
    camera.lookAt(0, 0, 0);

    const geometry = new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2);
    const materials = FACES.map((face) => new THREE.MeshBasicMaterial({ map: makeFaceTexture(face, theme) }));
    const cube = new THREE.Mesh(geometry, materials);
    scene.add(cube);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: FACE_COLORS[theme].edge }),
    );
    scene.add(edges);

    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();

    const setHighlight = (index: number | null) => {
      materials.forEach((material, i) => {
        material.color.set(i === index ? FACE_COLORS[theme].highlight : 0xffffff);
      });
    };

    const classify = (hit: THREE.Intersection): { x: number; y: number; z: number } => {
      const local = cube.worldToLocal(hit.point.clone());
      const threshold = 0.45;
      const ax = local.x > threshold ? 1 : local.x < -threshold ? -1 : 0;
      const ay = local.y > threshold ? 1 : local.y < -threshold ? -1 : 0;
      const az = local.z > threshold ? 1 : local.z < -threshold ? -1 : 0;
      if (ax === 0 && ay === 0 && az === 0 && hit.face) {
        const n = hit.face.normal;
        return { x: Math.round(n.x), y: Math.round(n.y), z: Math.round(n.z) };
      }
      return { x: ax, y: ay, z: az };
    };

    const pick = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(cube, false)[0];
    };

    const onPointerDown = (event: PointerEvent) => {
      const hit = pick(event.clientX, event.clientY);
      if (!hit) return;
      onDirection(classify(hit), true);
    };

    const onPointerMove = (event: PointerEvent) => {
      const hit = pick(event.clientX, event.clientY);
      if (!hit || !hit.face) {
        setHighlight(null);
        return;
      }
      setHighlight(hit.face.materialIndex ?? null);
    };

    const onPointerLeave = () => setHighlight(null);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

    renderer.setAnimationLoop(() => {
      const quaternion = getQuaternion();
      if (quaternion) cube.quaternion.copy(quaternion);
      renderer.render(scene, camera);
    });

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      renderer.setAnimationLoop(null);
      materials.forEach((material) => {
        material.map?.dispose();
        material.dispose();
      });
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
      geometry.dispose();
      renderer.dispose();
    };
  }, [getQuaternion, onDirection, onSelect, theme]);

  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      <div className="rounded-2xl border border-border/70 bg-surface/85 p-1.5 shadow-xl shadow-black/50 backdrop-blur-md">
        <canvas
          ref={canvasRef}
          width={CUBE_SIZE}
          height={CUBE_SIZE}
          style={{ width: CUBE_SIZE, height: CUBE_SIZE }}
          className="cursor-pointer rounded-xl"
          title="Cubo de vistas: clic en cara, arista o esquina"
          aria-label="Cubo de vistas"
        />
      </div>
      <div className="flex gap-1 rounded-lg border border-border/70 bg-surface/85 p-0.5 shadow-xl shadow-black/40 backdrop-blur-md">
        <button
          type="button"
          onClick={() => onSelect('isometrica')}
          title="Vista inicial (isometrica)"
          className="cursor-pointer rounded-md px-2 py-0.5 text-[10px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          HOME
        </button>
        <button
          type="button"
          onClick={() => onSelect('planta')}
          title="Vista superior (planta)"
          className="cursor-pointer rounded-md px-2 py-0.5 text-[10px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          PLANTA
        </button>
        <button
          type="button"
          onClick={() => onSelect('3d')}
          title="Vista 3D libre"
          className="cursor-pointer rounded-md px-2 py-0.5 text-[10px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          3D
        </button>
      </div>
    </div>
  );
}

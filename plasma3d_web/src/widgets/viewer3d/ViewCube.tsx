import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { cn } from '@/shared/lib/utils';

interface ViewCubeProps {
  getQuaternion: () => THREE.Quaternion | null;
  onDirection: (dir: { x: number; y: number; z: number }, ortho?: boolean) => void;
  className?: string;
}

const GIZMO_SIZE = 116;
const AXIS_LENGTH = 0.72;
const AXIS_COLORS = {
  x: 0xef4444,
  y: 0x22c55e,
  z: 0x3b82f6,
};

const AXIS_LABEL: Record<'x' | 'y' | 'z', string> = {
  x: 'X',
  y: 'Y',
  z: 'Z',
};

interface AxisDef {
  axis: 'x' | 'y' | 'z';
  direction: THREE.Vector3;
}

const AXES: AxisDef[] = [
  { axis: 'x', direction: new THREE.Vector3(1, 0, 0) },
  { axis: 'y', direction: new THREE.Vector3(0, 1, 0) },
  { axis: 'z', direction: new THREE.Vector3(0, 0, 1) },
];

function makeLabelSprite(text: string, scale = 0.18) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 5;
  ctx.font = 'bold 58px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 48, 52);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale, scale, 1);
  sprite.renderOrder = 20;
  return { sprite, texture, material };
}

function makeRingSprite(color: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 96, 96);
  ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(48, 48, 30, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.22, 0.22, 1);
  sprite.renderOrder = 10;
  return { sprite, texture, material };
}

export function ViewCube({ getQuaternion, onDirection, className }: ViewCubeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(GIZMO_SIZE, GIZMO_SIZE, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    camera.position.set(0, 0, 3.2);
    camera.lookAt(0, 0, 0);

    const group = new THREE.Group();
    scene.add(group);

    const raycastTargets: THREE.Mesh[] = [];
    const negativeLabels = new Map<THREE.Mesh, THREE.Sprite>();
    const disposables: Array<{ dispose: () => void }> = [];

    const up = new THREE.Vector3(0, 1, 0);

    AXES.forEach(({ axis, direction }) => {
      const color = AXIS_COLORS[axis];

      // Línea positiva, como un eje de Blender.
      const lineGeometry = new THREE.CylinderGeometry(0.018, 0.018, AXIS_LENGTH, 8);
      const lineMaterial = new THREE.MeshBasicMaterial({ color });
      const line = new THREE.Mesh(lineGeometry, lineMaterial);
      line.position.copy(direction.clone().multiplyScalar(AXIS_LENGTH / 2));
      line.quaternion.setFromUnitVectors(up, direction);
      group.add(line);
      disposables.push(lineGeometry, lineMaterial);

      // Bola con la letra del eje.
      const ballGeometry = new THREE.SphereGeometry(0.14, 24, 16);
      const ballMaterial = new THREE.MeshBasicMaterial({ color });
      const ball = new THREE.Mesh(ballGeometry, ballMaterial);
      ball.position.copy(direction.clone().multiplyScalar(AXIS_LENGTH));
      ball.userData.direction = { x: direction.x, y: direction.y, z: direction.z };
      group.add(ball);
      raycastTargets.push(ball);
      disposables.push(ballGeometry, ballMaterial);

      const label = makeLabelSprite(AXIS_LABEL[axis]);
      label.sprite.position.copy(direction.clone().multiplyScalar(AXIS_LENGTH));
      group.add(label.sprite);
      disposables.push(label.texture, label.material);

      // Lado negativo: línea tenue + aro hueco, como en Blender.
      const negative = direction.clone().multiplyScalar(-1);
      const negativeLineGeometry = new THREE.CylinderGeometry(0.012, 0.012, AXIS_LENGTH * 0.82, 8);
      const negativeLineMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
      });
      const negativeLine = new THREE.Mesh(negativeLineGeometry, negativeLineMaterial);
      negativeLine.position.copy(negative.clone().multiplyScalar(AXIS_LENGTH * 0.41));
      negativeLine.quaternion.setFromUnitVectors(up, negative);
      group.add(negativeLine);
      disposables.push(negativeLineGeometry, negativeLineMaterial);

      const ring = makeRingSprite(color);
      ring.sprite.position.copy(negative.clone().multiplyScalar(AXIS_LENGTH));
      group.add(ring.sprite);
      disposables.push(ring.texture, ring.material);

      // Etiqueta del eje negativo: aparece al pasar el cursor, como Blender.
      const negativeLabel = makeLabelSprite(`-${AXIS_LABEL[axis]}`, 0.19);
      negativeLabel.sprite.position.copy(negative.clone().multiplyScalar(AXIS_LENGTH));
      negativeLabel.sprite.visible = false;
      group.add(negativeLabel.sprite);
      disposables.push(negativeLabel.texture, negativeLabel.material);

      // Zona de clic más generosa, invisible.
      const hitGeometry = new THREE.SphereGeometry(0.24, 12, 8);
      const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
      const hit = new THREE.Mesh(hitGeometry, hitMaterial);
      hit.position.copy(negative.clone().multiplyScalar(AXIS_LENGTH));
      hit.userData.direction = { x: negative.x, y: negative.y, z: negative.z };
      group.add(hit);
      raycastTargets.push(hit);
      negativeLabels.set(hit, negativeLabel.sprite);
      disposables.push(hitGeometry, hitMaterial);
    });

    const centerGeometry = new THREE.SphereGeometry(0.065, 16, 12);
    const centerMaterial = new THREE.MeshBasicMaterial({ color: 0xcbd5e1 });
    const center = new THREE.Mesh(centerGeometry, centerMaterial);
    group.add(center);
    disposables.push(centerGeometry, centerMaterial);

    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let hovered: THREE.Mesh | null = null;

    const pick = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(raycastTargets, false)[0]?.object as THREE.Mesh | undefined;
    };

    const onPointerDown = (event: PointerEvent) => {
      const hit = pick(event.clientX, event.clientY);
      const direction = hit?.userData.direction as { x: number; y: number; z: number } | undefined;
      if (direction) onDirection(direction, true);
    };

    const setHovered = (hit: THREE.Mesh | null) => {
      if (hovered === hit) return;
      if (hovered) {
        hovered.scale.setScalar(1);
        const oldLabel = negativeLabels.get(hovered);
        if (oldLabel) oldLabel.visible = false;
      }
      hovered = hit;
      if (hovered) {
        hovered.scale.setScalar(1.18);
        const label = negativeLabels.get(hovered);
        if (label) label.visible = true;
      }
      canvas.style.cursor = hovered ? 'pointer' : 'default';
    };

    const onPointerMove = (event: PointerEvent) => {
      setHovered(pick(event.clientX, event.clientY) ?? null);
    };

    const onPointerLeave = () => setHovered(null);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

    renderer.setAnimationLoop(() => {
      const quaternion = getQuaternion();
      if (quaternion) group.quaternion.copy(quaternion).invert();
      renderer.render(scene, camera);
    });

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      renderer.setAnimationLoop(null);
      disposables.forEach((item) => item.dispose());
      renderer.dispose();
    };
  }, [getQuaternion, onDirection]);

  return (
    <div className={cn(className)}>
      <div className="rounded-full border border-border/70 bg-surface/80 p-1 shadow-xl shadow-black/50 backdrop-blur-md">
        <canvas
          ref={canvasRef}
          width={GIZMO_SIZE}
          height={GIZMO_SIZE}
          style={{ width: GIZMO_SIZE, height: GIZMO_SIZE }}
          className="touch-none rounded-full"
          title="Ejes de vista: clic en X, Y o Z (positivo o negativo)"
          aria-label="Gizmo de ejes de vista"
        />
      </div>
    </div>
  );
}

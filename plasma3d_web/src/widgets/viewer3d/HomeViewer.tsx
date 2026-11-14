import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HOME_MODEL_URL } from '@/entities/model3D/three/textures';
import {
  BRAND_ACCENT,
  createPresentationRig,
  disposeObject3D,
  makePresentationFog,
} from '@/widgets/viewer3d/presentation';
import { Spinner } from '@/shared/ui/spinner';
import { cn } from '@/shared/lib/utils';

/** Tamaño (lado mayor) al que se normaliza el modelo, en unidades de escena. */
const MODEL_SIZE = 4;
/** Segundos sin interaccion antes de reanudar la rotacion automatica. */
const RESUME_AUTOROTATE_MS = 3000;

export function HomeViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // --- Renderer (fondo transparente: se ve el degradado de la tarjeta) ---
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.fog = makePresentationFog(MODEL_SIZE / 2);

    const camera = new THREE.PerspectiveCamera(40, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.set(6.5, 4.5, 6.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 14;
    controls.maxPolarAngle = Math.PI * 0.48; // no bajar del piso
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.8;

    // Pausar la rotacion mientras el usuario interactua y reanudarla despues.
    let resumeTimer: number | undefined;
    const onStart = () => {
      window.clearTimeout(resumeTimer);
      controls.autoRotate = false;
    };
    const onEnd = () => {
      if (reducedMotion) return;
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        controls.autoRotate = true;
      }, RESUME_AUTOROTATE_MS);
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);

    // --- Luces, piso con sombra, brillo y grilla (compartido con el modo Animado) ---
    const rig = createPresentationRig(new THREE.Vector3(0, 0, 0), MODEL_SIZE / 2, 0);
    scene.add(rig.group);

    // --- Modelo con sus materiales y textura originales ---
    let model: THREE.Object3D | null = null;
    let disposed = false;
    const loader = new GLTFLoader();
    loader.load(
      HOME_MODEL_URL,
      (gltf) => {
        if (disposed) {
          disposeObject3D(gltf.scene);
          return;
        }
        model = gltf.scene;

        model.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          // Ventanas que brillan en cian (sobre una copia del material original).
          const material = mesh.material as THREE.MeshStandardMaterial;
          if (material?.name === 'Glass' && material.isMeshStandardMaterial) {
            const glass = material.clone();
            glass.emissive = new THREE.Color(BRAND_ACCENT);
            glass.emissiveMap = glass.map;
            glass.emissiveIntensity = 0.55;
            mesh.material = glass;
            material.dispose();
          }
        });

        // Normalizar tamaño, centrar en el origen y apoyar sobre el piso.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = MODEL_SIZE / Math.max(size.x, size.y, size.z);
        model.scale.setScalar(scale);
        box.setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= box.min.y;
        scene.add(model);

        // Encuadre: mirar al centro del edificio, a una distancia segun su altura.
        const height = box.max.y - box.min.y;
        controls.target.set(0, height * 0.42, 0);
        const distance = height * 1.5 + 1;
        camera.position.set(distance * 0.72, height * 0.85, distance * 0.72);
        controls.update();

        setStatus('ready');
      },
      undefined,
      () => {
        if (!disposed) setStatus('error');
      },
    );

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = canvas;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(canvas);

    return () => {
      disposed = true;
      window.clearTimeout(resumeTimer);
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      controls.dispose();
      if (model) disposeObject3D(model);
      rig.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className={cn(
          'block h-full w-full cursor-grab transition-opacity duration-700 active:cursor-grabbing',
          status === 'ready' ? 'opacity-100' : 'opacity-0',
        )}
      />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner className="h-7 w-7 text-accent" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          No se pudo cargar la vista previa 3D.
        </div>
      )}
    </div>
  );
}

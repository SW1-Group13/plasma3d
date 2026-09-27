import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Modelo3D } from '@/entities/model3D/three/Modelo3D';
import { HOME_MODEL_URL } from '@/entities/model3D/three/textures';

export function HomeViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setClearColor(0xdddddd);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000,
    );
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controls.update();

    scene.add(new THREE.GridHelper(30, 30));
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    const modelo = new Modelo3D(
      scene,
      HOME_MODEL_URL,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 1, 1),
      new THREE.Euler(0, 0, 0),
      [{ name: 'cartoon_cyberpunk_building', url: HOME_MODEL_URL }],
    );

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    const onResize = () => {
      const { clientWidth, clientHeight } = canvas;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.setAnimationLoop(null);
      controls.dispose();
      modelo.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full rounded-xl bg-slate-200" />;
}

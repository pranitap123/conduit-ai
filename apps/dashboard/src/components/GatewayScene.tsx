import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';

export function GatewayScene({ onUnsupported }: { onUnsupported: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) { setSupported(false); onUnsupported(); return; }

    let disposed = false;
    let frame = 0;

    void import('three').then((THREE) => {
      if (disposed || mountRef.current === null) return;
      const mount = mountRef.current;
      const width = mount.clientWidth;
      const height = mount.clientHeight;

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x000000, 0.02);
      
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      camera.position.set(0, -2, 12);

      const renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      mount.appendChild(canvas);

      function token(name: string): string {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      }

      const coreMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6 });
      const wireMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4 });
      const packetMat = new THREE.MeshBasicMaterial({ 
        transparent: true, 
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.9
      });
      const glowMat = new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, opacity: 0.15, depthWrite: false
      });

      function createNode(x: number, y: number, isGateway = false) {
        const group = new THREE.Group();
        const geo = isGateway ? new THREE.CylinderGeometry(1.4, 1.4, 0.6, 64) : new THREE.BoxGeometry(1.4, 0.5, 1.4);
        const core = new THREE.Mesh(geo, coreMat);
        if (isGateway) core.rotation.x = Math.PI / 2;
        group.add(core);

        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), wireMat);
        if (isGateway) edges.rotation.x = Math.PI / 2;
        group.add(edges);

        if (isGateway) {
          const glow = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 32), glowMat);
          group.add(glow);
          for (let i = 0; i < 3; i++) {
            const ring = new THREE.LineLoop(new THREE.RingGeometry(1.7 + (i * 0.4), 1.72 + (i * 0.4), 64), wireMat);
            group.add(ring);
          }
        }

        group.position.set(x, y, 0);
        scene.add(group);
        return group;
      }

      const appNodes = [createNode(-5.5, 1.5), createNode(-5.5, -1.5)];
      const gatewayNode = createNode(0, 0, true);
      const providerNodes = [createNode(5.5, 1.5), createNode(5.5, -1.5)];

      const railMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.1 });
      const curves: InstanceType<typeof THREE.QuadraticBezierCurve3>[] = [];
      
      function addRail(from: [number, number], to: [number, number]) {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(from[0], from[1], 0),
          new THREE.Vector3((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 2.5), 
          new THREE.Vector3(to[0], to[1], 0),
        );
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(64)), railMat);
        scene.add(line);
        curves.push(curve);
      }

      addRail([-4.8, 1.5], [-2.0, 0]);
      addRail([-4.8, -1.5], [-2.0, 0]);
      addRail([2.0, 0], [4.8, 1.5]);
      addRail([2.0, 0], [4.8, -1.5]);

      const packetGeo = new THREE.SphereGeometry(0.12, 16, 16);
      const packets: { mesh: THREE.Mesh; curveIdx: number; offset: number; speed: number }[] = [];
      
      for (let i = 0; i < 30; i++) {
        const mesh = new THREE.Mesh(packetGeo, packetMat);
        scene.add(mesh);
        packets.push({ 
          mesh, 
          curveIdx: i % 4, 
          offset: Math.random(), 
          speed: reduceMotion ? 0 : 0.15 + (Math.random() * 0.15) 
        });
      }

      function applyTheme(): void {
        const accent = new THREE.Color(token('--color-accent'));
        const surface = new THREE.Color(token('--color-surface-2'));
        const rule = new THREE.Color(token('--color-rule'));
        const bg = new THREE.Color(token('--color-bg'));

        if (scene.fog) scene.fog.color.copy(bg);
        coreMat.color.copy(surface);
        wireMat.color.copy(rule);
        railMat.color.copy(rule);
        packetMat.color.copy(accent);
        glowMat.color.copy(accent);
        
        const glowMesh = gatewayNode.children[2] as THREE.Mesh;
        (glowMesh.material as THREE.MeshBasicMaterial).color.copy(accent);
        
        (gatewayNode.children[3] as THREE.Line).material = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.8 });
        (gatewayNode.children[4] as THREE.Line).material = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.4 });
        (gatewayNode.children[5] as THREE.Line).material = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.15 });
      }
      
      applyTheme();
      const themeObserver = new MutationObserver(applyTheme);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      let pointerX = 0, pointerY = 0;
      let targetCamX = 0, targetCamY = 0;

      const onPointerMove = (e: PointerEvent): void => {
        const rect = mount.getBoundingClientRect();
        pointerX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        pointerY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      };
      mount.addEventListener('pointermove', onPointerMove);

      const clock = new THREE.Clock();

      function animate(): void {
        frame = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();

        if (!reduceMotion) {
          targetCamX = pointerX * 1.5;
          targetCamY = -pointerY * 1.5;
          
          camera.position.x += (targetCamX - camera.position.x) * 0.04;
          camera.position.y += (targetCamY - camera.position.y) * 0.04;
          camera.lookAt(0, 0, 0);

          gatewayNode.children[3].rotation.z = t * 0.6;
          gatewayNode.children[4].rotation.z = -t * 0.4;
          gatewayNode.children[5].rotation.z = t * 0.2;
          
          const breathe = Math.sin(t * 2) * 0.05 + 0.15;
          const glowMesh = gatewayNode.children[2] as THREE.Mesh;
          (glowMesh.material as THREE.MeshBasicMaterial).opacity = breathe;
          
          appNodes.forEach((n, i) => n.position.y = (i === 0 ? 1.5 : -1.5) + Math.sin(t * 1.2 + i) * 0.08);
          providerNodes.forEach((n, i) => n.position.y = (i === 0 ? 1.5 : -1.5) + Math.cos(t * 1.2 + i) * 0.08);
        }

        packets.forEach((p) => {
          if (p.speed === 0) return;
          const u = (t * p.speed + p.offset) % 1;
          const curve = curves[p.curveIdx];
          p.mesh.position.copy(curve.getPoint(u));
          const fade = Math.sin(u * Math.PI);
          p.mesh.scale.setScalar(fade * 1.2 + 0.2);
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.9;
        });

        renderer.render(scene, camera);
      }
      animate();

      const onResize = (): void => {
        const w = mount.clientWidth, h = mount.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      (mount as any).__cleanup = () => {
        cancelAnimationFrame(frame);
        themeObserver.disconnect();
        window.removeEventListener('resize', onResize);
        mount.removeEventListener('pointermove', onPointerMove);
        renderer.dispose();
        mount.removeChild(canvas);
      };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      (mountRef.current as any)?.__cleanup?.();
    };
  }, []);

  if (!supported) return null;
  return (
    <div ref={mountRef} className="w-full h-[400px] sm:h-[500px] cursor-crosshair transition-opacity duration-1000 animate-in" />
  );
}
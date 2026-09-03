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
      const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
      camera.position.set(0, 0, 10);

      const renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      mount.appendChild(canvas);

      function token(name: string): string {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      }

      // --- Premium Materials ---
      const coreMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 });
      const wireMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3 });
      const packetMat = new THREE.MeshBasicMaterial({ 
        transparent: true, 
        blending: THREE.AdditiveBlending,
        depthWrite: false 
      });

      // --- Architecture Nodes ---
      function createNode(x: number, y: number, isGateway = false) {
        const group = new THREE.Group();
        
        const geo = isGateway ? new THREE.CylinderGeometry(1.2, 1.2, 0.5, 32) : new THREE.BoxGeometry(1.2, 0.4, 1.2);
        const core = new THREE.Mesh(geo, coreMat);
        if (isGateway) core.rotation.x = Math.PI / 2;
        group.add(core);

        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), wireMat);
        if (isGateway) edges.rotation.x = Math.PI / 2;
        group.add(edges);

        if (isGateway) {
          for (let i = 0; i < 2; i++) {
            const ring = new THREE.LineLoop(new THREE.RingGeometry(1.5 + (i * 0.3), 1.51 + (i * 0.3), 32), wireMat);
            group.add(ring);
          }
        }

        group.position.set(x, y, 0);
        scene.add(group);
        return group;
      }

      const appNodes = [createNode(-4.5, 1.2), createNode(-4.5, -1.2)];
      const gatewayNode = createNode(0, 0, true);
      const providerNodes = [createNode(4.5, 1.2), createNode(4.5, -1.2)];

      // --- Traffic Rails ---
      const railMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.15 });
      const curves: InstanceType<typeof THREE.QuadraticBezierCurve3>[] = [];
      
      function addRail(from: [number, number], to: [number, number]) {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(from[0], from[1], 0),
          new THREE.Vector3((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 1.5), 
          new THREE.Vector3(to[0], to[1], 0),
        );
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(50)), railMat);
        scene.add(line);
        curves.push(curve);
      }

      addRail([-3.8, 1.2], [-1.5, 0]);
      addRail([-3.8, -1.2], [-1.5, 0]);
      addRail([1.5, 0], [3.8, 1.2]);
      addRail([1.5, 0], [3.8, -1.2]);

      /*
       * Labels. This is the whole point of the diagram: a visitor should read
       * "app → gateway → provider" in under a second, not reverse-engineer it
       * from unlabelled boxes. Rendered as plain DOM rather than Three.js
       * sprites/troika-text so the type is crisp at any zoom, uses the real
       * design tokens, and costs nothing beyond a Vector3.project() per label
       * per frame. Decorative — the same "Application → Gateway → Providers"
       * story is already in accessible page copy above the canvas.
       */
      const labelDefs: { text: string; sub: string; pos: InstanceType<typeof THREE.Vector3> }[] = [
        { text: 'Your applications', sub: 'Sends /v1/chat/completions', pos: new THREE.Vector3(-4.5, 2.1, 0) },
        { text: 'Conduit gateway', sub: 'Auth · limits · cache · metering', pos: new THREE.Vector3(0, 1.95, 0) },
        { text: 'LLM providers', sub: 'OpenAI · Anthropic · others', pos: new THREE.Vector3(4.5, 2.1, 0) },
      ];

      const labelLayer = document.createElement('div');
      labelLayer.setAttribute('aria-hidden', 'true');
      labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
      mount.appendChild(labelLayer);

      const labels = labelDefs.map(({ text, sub, pos }) => {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;text-align:center;opacity:0;transition:opacity .5s ease;';
        const title = document.createElement('div');
        title.className = 't-label';
        title.textContent = text;
        const meta = document.createElement('div');
        meta.className = 'figure';
        meta.style.cssText = 'font-size:11px;color:var(--color-ink-faint);margin-top:2px;';
        meta.textContent = sub;
        el.append(title, meta);
        labelLayer.appendChild(el);
        return { el, pos };
      });

      // --- Data Packets (Traffic) ---
      const packetGeo = new THREE.SphereGeometry(0.08, 16, 16);
      const packets: { mesh: THREE.Mesh; curveIdx: number; offset: number; speed: number }[] = [];
      
      for (let i = 0; i < 12; i++) {
        const mesh = new THREE.Mesh(packetGeo, packetMat);
        scene.add(mesh);
        packets.push({ 
          mesh, 
          curveIdx: i % 4, 
          offset: Math.random(), 
          speed: reduceMotion ? 0 : 0.2 + (Math.random() * 0.1) 
        });
      }

      // --- Theme Synchronization ---
      function applyTheme(): void {
        const accent = new THREE.Color(token('--color-accent'));
        const surface = new THREE.Color(token('--color-surface-2'));
        const rule = new THREE.Color(token('--color-rule'));

        coreMat.color.copy(surface);
        wireMat.color.copy(rule);
        railMat.color.copy(rule);
        packetMat.color.copy(accent);
        
        (gatewayNode.children[2] as THREE.Line).material = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.6 });
        (gatewayNode.children[3] as THREE.Line).material = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.3 });
      }
      
      applyTheme();
      const themeObserver = new MutationObserver(applyTheme);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      // --- Fluid Animation ---
      let pointerX = 0;
      let pointerY = 0;

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
          camera.position.x += (pointerX * 0.5 - camera.position.x) * 0.05;
          camera.position.y += (-pointerY * 0.5 - camera.position.y) * 0.05;
          camera.lookAt(0, 0, 0);

          gatewayNode.children[2].rotation.z = t * 0.5;
          gatewayNode.children[3].rotation.z = -t * 0.3;
          
          appNodes.forEach((n, i) => n.position.y = (i === 0 ? 1.2 : -1.2) + Math.sin(t * 1.5 + i) * 0.05);
          providerNodes.forEach((n, i) => n.position.y = (i === 0 ? 1.2 : -1.2) + Math.cos(t * 1.5 + i) * 0.05);
        }

        packets.forEach((p) => {
          if (p.speed === 0) return;
          const u = (t * p.speed + p.offset) % 1;
          const curve = curves[p.curveIdx];
          p.mesh.position.copy(curve.getPoint(u));
          
          const fade = Math.sin(u * Math.PI);
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.9;
        });

        const w = mount.clientWidth;
        const h = mount.clientHeight;
        labels.forEach(({ el, pos }) => {
          projected.copy(pos).project(camera);
          const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15;
          el.style.left = `${(projected.x * 0.5 + 0.5) * w}px`;
          el.style.top = `${(-projected.y * 0.5 + 0.5) * h}px`;
          el.style.opacity = onScreen ? '1' : '0';
        });

        renderer.render(scene, camera);
      }
      const projected = new THREE.Vector3();
      animate();

      const onResize = (): void => {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      (mount as HTMLDivElement & { __cleanup?: () => void }).__cleanup = () => {
        cancelAnimationFrame(frame);
        themeObserver.disconnect();
        window.removeEventListener('resize', onResize);
        mount.removeEventListener('pointermove', onPointerMove);
        renderer.dispose();
        mount.removeChild(canvas);
        mount.removeChild(labelLayer);
      };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      const cleanup = (mountRef.current as (HTMLDivElement & { __cleanup?: () => void }) | null)?.__cleanup;
      cleanup?.();
    };
  }, []);

  if (!supported) return null;

  return (
    <div
      ref={mountRef}
      className="w-full h-[320px] sm:h-[400px] cursor-crosshair"
      style={{ 
        background: 'radial-gradient(circle at center, var(--color-surface-2) 0%, transparent 70%)'
      }}
    />
  );
}
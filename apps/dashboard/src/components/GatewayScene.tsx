import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * The landing hero's signature visualization: application traffic entering a
 * gateway, being sorted, and continuing on to providers.
 *
 * Built in plain Three.js rather than react-three-fiber. Fiber buys declarative
 * JSX for a scene graph that gets rebuilt on every prop change; a single hero
 * scene that mounts once and free-runs its own animation loop doesn't need
 * that, and skipping it sidesteps fiber's React-version peer-dependency range
 * entirely — this repo runs React 19, and a scene this small isn't worth
 * finding out whether that range covers it.
 *
 * Three CSS2-style layers of depth, all on one Z axis pushed back slightly so
 * perspective has something to act on:
 *   - two rows of application nodes, left
 *   - the gateway, centre, pulsing gently on its own clock
 *   - two provider nodes, right
 * Packets are small emissive spheres travelling the two connecting curves.
 * Nothing spins for its own sake; every motion is a request in flight.
 */
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
      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
      camera.position.set(0, 0.6, 9);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true, powerPreference: 'low-power',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      mount.appendChild(canvas);

      const ink = new THREE.Color('#e7ecea');
      const accent = new THREE.Color('#56d1ab');
      const dim = new THREE.Color('#273230');

      // ---- static geometry: nodes and connecting rails --------------------

      const nodeGeo = new THREE.BoxGeometry(1.5, 0.55, 0.12);
      const nodeMat = new THREE.MeshBasicMaterial({ color: dim });
      const nodeEdgeMat = new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.4 });

      function addNode(x: number, y: number): THREE.Mesh {
        const mesh = new THREE.Mesh(nodeGeo, nodeMat);
        mesh.position.set(x, y, 0);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(nodeGeo), nodeEdgeMat);
        mesh.add(edges);
        scene.add(mesh);
        return mesh;
      }

      const appNodes = [addNode(-4.4, 0.9), addNode(-4.4, -0.9)];
      const providerNodes = [addNode(4.4, 0.9), addNode(4.4, -0.9)];

      // The gateway: three stacked panels pushed toward camera, reading as a
      // single deeper block rather than a flat card among flat cards.
      const gateGroup = new THREE.Group();
      for (let i = 0; i < 3; i += 1) {
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 1.9, 0.1),
          new THREE.MeshBasicMaterial({
            color: i === 1 ? '#182120' : dim,
            transparent: true,
            opacity: i === 1 ? 1 : 0.5,
          }),
        );
        panel.position.z = (i - 1) * 0.16;
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(panel.geometry),
          new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.5 }),
        );
        panel.add(edges);
        gateGroup.add(panel);
      }
      scene.add(gateGroup);

      // Connecting rails: thin lines, not tubes — a hairline reads as a wire, a
      // tube reads as a pipe cleaner.
      const railMat = new THREE.LineBasicMaterial({ color: dim });
      const rails: THREE.Line[] = [];
      function addRail(from: [number, number], to: [number, number]): THREE.QuadraticBezierCurve3 {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(from[0], from[1], 0),
          new THREE.Vector3((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 0.4),
          new THREE.Vector3(to[0], to[1], 0),
        );
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), railMat,
        );
        scene.add(line);
        rails.push(line);
        return curve;
      }

      const inboundCurves = [
        addRail([-3.65, 0.9], [-0.75, 0.35]),
        addRail([-3.65, -0.9], [-0.75, -0.35]),
      ];
      const outboundCurves = [
        addRail([0.75, 0.35], [3.65, 0.9]),
        addRail([0.75, -0.35], [3.65, -0.9]),
      ];

      // ---- travelling packets ---------------------------------------------

      const packetGeo = new THREE.SphereGeometry(0.05, 12, 12);
      const packetMat = new THREE.MeshBasicMaterial({ color: accent });
      const packets = [...inboundCurves, ...outboundCurves].map((curve, i) => {
        const mesh = new THREE.Mesh(packetGeo, packetMat);
        scene.add(mesh);
        return { mesh, curve, offset: i * 0.31, speed: reduceMotion ? 0 : 0.32 };
      });

      camera.position.z = 9;

      // Gentle parallax toward the pointer, not a free-orbit camera — depth
      // that responds to the reader, not motion that runs regardless of them.
      let pointerX = 0;
      let pointerY = 0;
      const onPointerMove = (e: PointerEvent): void => {
        const rect = mount.getBoundingClientRect();
        pointerX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        pointerY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      };
      mount.addEventListener('pointermove', onPointerMove);

      const clock = new THREE.Clock();
      let visible = true;
      const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.1 });
      io.observe(mount);

      function animate(): void {
        frame = requestAnimationFrame(animate);
        if (!visible) return;
        const t = clock.getElapsedTime();

        if (!reduceMotion) {
          gateGroup.rotation.y = pointerX * 0.06;
          gateGroup.rotation.x = -pointerY * 0.04;
          camera.position.x += (pointerX * 0.35 - camera.position.x) * 0.04;
          camera.position.y += (0.6 - pointerY * 0.2 - camera.position.y) * 0.04;
          camera.lookAt(0, 0, 0);

          // The centre panel breathes on its own clock — activity, not a pulse
          // tied to any single request.
          const pulse = 0.85 + Math.sin(t * 1.6) * 0.15;
          (gateGroup.children[1] as THREE.Mesh).scale.setScalar(pulse);
        }

        for (const p of packets) {
          if (p.speed === 0) continue;
          const u = (t * p.speed + p.offset) % 1;
          p.mesh.position.copy(p.curve.getPoint(u));
          const fade = Math.sin(u * Math.PI);
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.3 + fade * 0.7;
          (p.mesh.material as THREE.MeshBasicMaterial).transparent = true;
        }

        renderer.render(scene, camera);
      }
      animate();

      const onResize = (): void => {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      // cleanup runs when the effect re-fires (it will not, given the [] dep
      // list) or when the component unmounts.
      (mount as HTMLDivElement & { __cleanup?: () => void }).__cleanup = () => {
        cancelAnimationFrame(frame);
        io.disconnect();
        window.removeEventListener('resize', onResize);
        mount.removeEventListener('pointermove', onPointerMove);
        renderer.dispose();
        nodeGeo.dispose();
        packetGeo.dispose();
        [...appNodes, ...providerNodes].forEach((n) => n.geometry.dispose());
        rails.forEach((r) => r.geometry.dispose());
        mount.removeChild(canvas);
      };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      const cleanup = (mountRef.current as (HTMLDivElement & { __cleanup?: () => void }) | null)?.__cleanup;
      cleanup?.();
    };
  }, []);

  if (!supported) return null;  // parent shows the fallback via onUnsupported

  return (
    <div
      ref={mountRef}
      role="img"
      aria-label="Applications send requests through the Tollgate gateway, which authenticates, rate-limits, caches and meters them before forwarding to model providers."
      className="w-full h-[280px] sm:h-[340px]"
    />
  );
}
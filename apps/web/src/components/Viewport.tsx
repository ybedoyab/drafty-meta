import { Center, GizmoHelper, GizmoViewport, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { turbo } from "@/lib/colormap";
import type { SurfaceResult } from "@/lib/api";

export function Viewport({
  previewUrl,
  surface,
  scale,
  wireframe,
}: {
  previewUrl: string | null;
  surface: SurfaceResult | null;
  scale: number;
  wireframe: boolean;
}) {
  return (
    <Canvas camera={{ position: [0.45, -0.35, 0.28], fov: 35 }}>
      <color attach="background" args={["#f8fafc"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[1, -1, 2]} intensity={1.2} />
      <Center>
        <Suspense fallback={null}>
          {surface ? (
            <StressMesh surface={surface} scale={scale} wireframe={wireframe} />
          ) : previewUrl ? (
            <Preview key={previewUrl} url={previewUrl} />
          ) : null}
        </Suspense>
      </Center>
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#334155" />
      </GizmoHelper>
      <axesHelper args={[0.08]} />
    </Canvas>
  );
}

function Preview({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  return <primitive object={scene} />;
}

function StressMesh({
  surface,
  scale,
  wireframe,
}: {
  surface: SurfaceResult;
  scale: number;
  wireframe: boolean;
}) {
  const geometry = useMemo(() => buildGeometry(surface, scale), [surface, scale]);
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} wireframe={wireframe} />
    </mesh>
  );
}

function buildGeometry(surface: SurfaceResult, scale: number) {
  const count = surface.vertices_m.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let min = Infinity;
  let max = -Infinity;
  for (const value of surface.von_mises_pa) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const span = max - min || 1;
  surface.vertices_m.forEach((vertex, index) => {
    const displacement = surface.displacement_m[index];
    positions[index * 3] = vertex[0] + displacement[0] * scale;
    positions[index * 3 + 1] = vertex[1] + displacement[1] * scale;
    positions[index * 3 + 2] = vertex[2] + displacement[2] * scale;
    const [red, green, blue] = turbo((surface.von_mises_pa[index] - min) / span);
    colors[index * 3] = red;
    colors[index * 3 + 1] = green;
    colors[index * 3 + 2] = blue;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(surface.faces.flat());
  geometry.computeVertexNormals();
  return geometry;
}

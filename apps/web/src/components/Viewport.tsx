import { Center, GizmoHelper, GizmoViewport, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { turbo } from "@/lib/colormap";
import type { SurfaceResult } from "@/lib/api";

export type Shade = "von_mises" | "displacement" | "geometry";
export type CameraView = "iso" | "front" | "top" | "side";

export function Viewport({
  previewUrl,
  surface,
  scale,
  wireframe,
  shade,
  orthographic,
  cameraView,
  cameraNonce,
  contourMin,
  contourMax,
  support,
  loadSurface,
  direction,
}: {
  previewUrl: string | null;
  surface: SurfaceResult | null;
  scale: number;
  wireframe: boolean;
  shade: Shade;
  orthographic: boolean;
  cameraView: CameraView;
  cameraNonce: number;
  contourMin: number | null;
  contourMax: number | null;
  support: string;
  loadSurface: string;
  direction: [number, number, number];
}) {
  return (
    <Canvas key={orthographic ? "ortho" : "persp"} orthographic={orthographic} camera={{ position: [0.45, -0.35, 0.28], fov: 35, zoom: orthographic ? 400 : 1 }}>
      <color attach="background" args={["#f8fafc"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[1, -1, 2]} intensity={1.2} />
      <Center>
        <Suspense fallback={null}>
          {surface ? (
            <StressMesh
              surface={surface}
              scale={scale}
              wireframe={wireframe}
              shade={shade}
              contourMin={contourMin}
              contourMax={contourMax}
            />
          ) : previewUrl ? (
            <Preview key={previewUrl} url={previewUrl} />
          ) : null}
          {surface && (
            <Markers surface={surface} support={support} loadSurface={loadSurface} direction={direction} />
          )}
        </Suspense>
      </Center>
      <CameraRig view={cameraView} nonce={cameraNonce} />
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
  useEffect(() => {
    return () => {
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      useGLTF.clear(url);
    };
  }, [scene, url]);
  return <primitive object={scene} />;
}

function StressMesh({
  surface,
  scale,
  wireframe,
  shade,
  contourMin,
  contourMax,
}: {
  surface: SurfaceResult;
  scale: number;
  wireframe: boolean;
  shade: Shade;
  contourMin: number | null;
  contourMax: number | null;
}) {
  const geometry = useMemo(
    () => buildGeometry(surface, scale, shade, contourMin, contourMax),
    [surface, scale, shade, contourMin, contourMax],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      {shade === "geometry" ? (
        <meshStandardMaterial color="#cbd5e1" side={THREE.DoubleSide} wireframe={wireframe} />
      ) : (
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} wireframe={wireframe} />
      )}
    </mesh>
  );
}

function Markers({
  surface,
  support,
  loadSurface,
  direction,
}: {
  surface: SurfaceResult;
  support: string;
  loadSurface: string;
  direction: [number, number, number];
}) {
  const marker = useMemo(() => faceMarker(surface.vertices_m, loadSurface, direction), [surface, loadSurface, direction]);
  const held = useMemo(() => faceMarker(surface.vertices_m, support, [0, 0, 0]), [surface, support]);
  return (
    <group>
      <mesh position={held.origin}>
        <boxGeometry args={[0.004, 0.004, 0.004]} />
        <meshBasicMaterial color="#2563eb" />
      </mesh>
      <arrowHelper args={[marker.direction, marker.origin, 0.04, "#dc2626"]} />
    </group>
  );
}

function CameraRig({ view, nonce }: { view: CameraView; nonce: number }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    const distance = 0.55;
    const positions: Record<CameraView, [number, number, number]> = {
      iso: [distance, -distance, distance * 0.7],
      front: [0, -distance, 0.02],
      top: [0.001, -0.001, distance],
      side: [distance, 0, 0.02],
    };
    const [x, y, z] = positions[view];
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, view, nonce]);
  return null;
}

function buildGeometry(
  surface: SurfaceResult,
  scale: number,
  shade: Shade,
  contourMin: number | null,
  contourMax: number | null,
) {
  const count = surface.vertices_m.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const values = surface.displacement_m.map((displacement, index) =>
    shade === "displacement"
      ? Math.hypot(displacement[0], displacement[1], displacement[2])
      : surface.von_mises_pa[index],
  );
  let min = contourMin ?? Math.min(...values);
  let max = contourMax ?? Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    min = 0;
    max = 1;
  }
  const span = max - min;
  surface.vertices_m.forEach((vertex, index) => {
    const displacement = surface.displacement_m[index];
    positions[index * 3] = vertex[0] + displacement[0] * scale;
    positions[index * 3 + 1] = vertex[1] + displacement[1] * scale;
    positions[index * 3 + 2] = vertex[2] + displacement[2] * scale;
    const [red, green, blue] = turbo((values[index] - min) / span);
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

function faceMarker(vertices: [number, number, number][], surface: string, direction: [number, number, number]) {
  const axis = surface.startsWith("x") ? 0 : surface.startsWith("y") ? 1 : 2;
  const target = surface.endsWith("min") ? Math.min(...vertices.map((vertex) => vertex[axis])) : Math.max(...vertices.map((vertex) => vertex[axis]));
  const near = vertices.filter((vertex) => Math.abs(vertex[axis] - target) < 1e-4);
  const sample = near.length ? near : vertices;
  const origin = new THREE.Vector3();
  for (const vertex of sample) origin.add(new THREE.Vector3(...vertex));
  origin.multiplyScalar(1 / sample.length);
  const vector = new THREE.Vector3(...direction);
  if (vector.length() === 0) vector.set(0, 0, -1);
  vector.normalize();
  return { origin, direction: vector };
}

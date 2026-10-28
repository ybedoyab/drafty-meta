import { Center, GizmoHelper, GizmoViewport, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { turbo } from "@/lib/colormap";
import { faceCentroid, loadDirection } from "@/lib/markers";
import type { SurfaceResult } from "@/lib/api";

export type Shade = "von_mises" | "displacement" | "geometry";
export type CameraView = "iso" | "front" | "top" | "right";

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
  loadLabel,
  fitRadius,
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
  loadLabel: string;
  fitRadius: number;
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
            <Markers
              surface={surface}
              support={support}
              loadSurface={loadSurface}
              direction={direction}
              loadLabel={loadLabel}
              fitRadius={fitRadius}
            />
          )}
        </Suspense>
      </Center>
      <CameraRig view={cameraView} nonce={cameraNonce} radius={fitRadius} />
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
  loadLabel,
  fitRadius,
}: {
  surface: SurfaceResult;
  support: string;
  loadSurface: string;
  direction: [number, number, number];
  loadLabel: string;
  fitRadius: number;
}) {
  const marker = useMemo(() => {
    const origin = faceCentroid(surface.vertices_m, loadSurface);
    const { unit } = loadDirection(direction);
    return { origin: new THREE.Vector3(...origin), direction: new THREE.Vector3(...unit) };
  }, [surface, loadSurface, direction]);
  const held = useMemo(() => new THREE.Vector3(...faceCentroid(surface.vertices_m, support)), [surface, support]);
  const arrow = Math.max(fitRadius * 0.45, 0.02);
  const mark = Math.max(fitRadius * 0.08, 0.004);
  return (
    <group>
      <mesh position={held}>
        <boxGeometry args={[mark, mark, mark]} />
        <meshBasicMaterial color="#2563eb" />
      </mesh>
      <Html position={held} center sprite zIndexRange={[20, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-blue-700 shadow">
          Fixed support
        </div>
      </Html>
      <arrowHelper args={[marker.direction, marker.origin, arrow, "#dc2626"]} />
      <Html position={marker.origin.clone().add(marker.direction.clone().multiplyScalar(arrow))} center sprite zIndexRange={[20, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-red-700 shadow">
          {loadLabel}
        </div>
      </Html>
    </group>
  );
}

function CameraRig({ view, nonce, radius }: { view: CameraView; nonce: number; radius: number }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  useEffect(() => {
    const span = Math.max(radius * 2, 1e-4);
    const padding = 1.55;
    const fov = camera instanceof THREE.PerspectiveCamera ? (camera.fov * Math.PI) / 180 : Math.PI / 5;
    const distance = (span * padding) / (2 * Math.tan(fov / 2));
    if (camera instanceof THREE.OrthographicCamera) {
      const zoom = Math.min(size.width, size.height) / (span * padding);
      camera.zoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    }
    const positions: Record<CameraView, [number, number, number]> = {
      iso: [distance, -distance, distance * 0.72],
      front: [0, -distance, 0],
      top: [0, 0, distance],
      right: [distance, 0, 0],
    };
    const [x, y, z] = positions[view];
    camera.position.set(x, y, z);
    camera.near = Math.max(distance / 200, 1e-4);
    camera.far = Math.max(distance * 30, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, view, nonce, radius, size.width, size.height]);
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

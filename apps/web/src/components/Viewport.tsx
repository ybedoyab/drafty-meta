import { Center, GizmoHelper, GizmoViewport, Grid, Helper, Html, OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import * as THREE from "three";
import { turbo } from "@/lib/colormap";
import { gridPlaneDistance } from "@/lib/grid";
import { faceCentroid, loadDirection } from "@/lib/markers";
import type { SurfaceResult } from "@/lib/api";
import { useTheme } from "@/lib/theme";

export type Shade = "von_mises" | "displacement" | "geometry";
export type EditMode = "select" | "scale" | "rotate";
export type PartTransform =
  | { type: "scale"; factors: [number, number, number] }
  | { type: "rotate"; matrix: [[number, number, number], [number, number, number], [number, number, number]] };
export type CameraView = "iso" | "front" | "top" | "right";
export interface DraftSketch {
  profile: { u: number; v: number }[];
  origin: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
  wAxis: [number, number, number];
  widthM: number;
  heightM: number;
  depthM: number;
  label: string;
}

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
  zUp = false,
  gridVisible = true,
  gridStepM = 0.01,
  editMode,
  partSelected = false,
  onPartSelectedChange,
  onPartTransform,
  draftSketch,
  onDraftMove,
  floorOffset,
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
  /** Orbit with Z up, so a part modelled along Z stands upright. Studio keeps the default. */
  zUp?: boolean;
  /** Measured reference grid under the part. One cell equals gridStepM meters. */
  gridVisible?: boolean;
  gridStepM?: number;
  /** Distance from the part center to its lowest face, in meters. Falls back to the surface bbox. */
  floorOffset?: number;
  editMode?: EditMode;
  partSelected?: boolean;
  onPartSelectedChange?: (selected: boolean) => void;
  onPartTransform?: (transform: PartTransform) => void;
  draftSketch?: DraftSketch | null;
  onDraftMove?: (deltaM: [number, number, number]) => void;
}) {
  const dark = useTheme() === "dark";
  return (
    <Canvas key={orthographic ? "ortho" : "persp"} orthographic={orthographic} camera={{ position: [0.45, -0.35, 0.28], fov: 35, zoom: orthographic ? 400 : 1, up: zUp ? [0, 0, 1] : [0, 1, 0] }} onPointerMissed={() => { if (editMode) onPartSelectedChange?.(false); }}>
      <color attach="background" args={[dark ? "#0f172a" : "#f8fafc"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[1, -1, 2]} intensity={1.2} />
      <Center>
        <Suspense fallback={null}>
          <EditablePart editMode={editMode} selected={partSelected} onSelectedChange={onPartSelectedChange} onTransform={onPartTransform} active={Boolean(surface || previewUrl)}>
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
          </EditablePart>
          {draftSketch && <DraftPrism draft={draftSketch} onMove={onDraftMove} />}
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
      {gridVisible && (
        <MeasuredGrid
          surface={surface}
          stepM={gridStepM}
          fitRadius={fitRadius}
          floorOffset={floorOffset}
          zUp={zUp}
        />
      )}
      <CameraRig view={cameraView} nonce={cameraNonce} radius={fitRadius} />
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor={dark ? "#e2e8f0" : "#334155"} />
      </GizmoHelper>
      <axesHelper args={[0.08]} />
    </Canvas>
  );
}

function DraftPrism({ draft, onMove }: { draft: DraftSketch; onMove?: (deltaM: [number, number, number]) => void }) {
  const [node, setNode] = useState<THREE.Group | null>(null);
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    draft.profile.forEach((point, index) => {
      const x = (point.u - 0.5) * draft.widthM;
      const y = point.v * draft.heightM;
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const extruded = new THREE.ExtrudeGeometry(shape, { depth: draft.depthM, bevelEnabled: false });
    const matrix = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...draft.uAxis),
      new THREE.Vector3(...draft.vAxis),
      new THREE.Vector3(...draft.wAxis),
    );
    matrix.setPosition(new THREE.Vector3(...draft.origin));
    extruded.applyMatrix4(matrix);
    return extruded;
  }, [draft]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const labelPosition: [number, number, number] = [0, 1, 2].map(
    (axis) => draft.origin[axis] + draft.vAxis[axis] * draft.heightM * 0.5 + draft.wAxis[axis] * draft.depthM * 0.5,
  ) as [number, number, number];
  function finishMove() {
    if (!node) return;
    const delta: [number, number, number] = [node.position.x, node.position.y, node.position.z];
    node.position.set(0, 0, 0);
    if (delta.some((value) => Math.abs(value) > 1e-6)) onMove?.(delta);
  }
  return (
    <>
      <group ref={setNode}>
        <mesh geometry={geometry}>
          <meshStandardMaterial color="#2563eb" transparent opacity={0.55} side={THREE.DoubleSide} />
        </mesh>
        <Html position={labelPosition} center sprite zIndexRange={[20, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded bg-blue-700 px-1.5 py-0.5 text-[11px] font-medium text-white shadow">
            {draft.label} — drag to place
          </div>
        </Html>
      </group>
      {node && <TransformControls object={node} mode="translate" onMouseUp={finishMove} />}
    </>
  );
}

function EditablePart({
  editMode,
  selected,
  onSelectedChange,
  onTransform,
  active,
  children,
}: {
  editMode?: EditMode;
  selected: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onTransform?: (transform: PartTransform) => void;
  active: boolean;
  children: ReactNode;
}) {
  const [partNode, setPartNode] = useState<THREE.Group | null>(null);
  function finishTransform() {
    const part = partNode;
    if (!part || !editMode || editMode === "select") return;
    if (editMode === "scale") {
      const factors: [number, number, number] = [part.scale.x, part.scale.y, part.scale.z];
      part.scale.set(1, 1, 1);
      if (factors.some((factor) => Math.abs(factor - 1) > 0.001)) onTransform?.({ type: "scale", factors });
      return;
    }
    const elements = new THREE.Matrix4().makeRotationFromQuaternion(part.quaternion).elements;
    const rounded = (value: number) => Math.max(-1, Math.min(1, Math.round(value)));
    const matrix: [[number, number, number], [number, number, number], [number, number, number]] = [
      [rounded(elements[0]), rounded(elements[4]), rounded(elements[8])],
      [rounded(elements[1]), rounded(elements[5]), rounded(elements[9])],
      [rounded(elements[2]), rounded(elements[6]), rounded(elements[10])],
    ];
    part.quaternion.identity();
    part.rotation.set(0, 0, 0);
    if (matrix.flat().some((value, index) => value !== [1, 0, 0, 0, 1, 0, 0, 0, 1][index])) {
      onTransform?.({ type: "rotate", matrix });
    }
  }
  return (
    <>
      <group
        ref={setPartNode}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          if (!editMode) return;
          event.stopPropagation();
          onSelectedChange?.(true);
        }}
      >
        {children}
        {selected && editMode && <Helper type={THREE.BoxHelper} args={["#2563eb"]} />}
      </group>
      {editMode && editMode !== "select" && selected && active && (
        <TransformControls object={partNode ?? undefined} mode={editMode} rotationSnap={Math.PI / 2} onMouseUp={finishTransform} />
      )}
    </>
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
  const dark = useTheme() === "dark";
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
        <meshBasicMaterial color={dark ? "#60a5fa" : "#1e40af"} />
      </mesh>
      <Html position={held} center sprite zIndexRange={[20, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-blue-800 shadow">
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

function MeasuredGrid({
  surface,
  stepM,
  fitRadius,
  floorOffset,
  zUp,
}: {
  surface: SurfaceResult | null;
  stepM: number;
  fitRadius: number;
  floorOffset: number | undefined;
  zUp: boolean;
}) {
  const distance = useMemo(() => {
    const axis = zUp ? 2 : 1;
    let modelHalf: number | null = null;
    if (surface) {
      let min = Infinity;
      let max = -Infinity;
      for (const vertex of surface.vertices_m) {
        min = Math.min(min, vertex[axis]);
        max = Math.max(max, vertex[axis]);
      }
      if (Number.isFinite(min) && Number.isFinite(max) && max > min) modelHalf = (max - min) / 2;
    }
    return gridPlaneDistance([floorOffset, modelHalf], fitRadius * 0.5, stepM, fitRadius);
  }, [surface, floorOffset, fitRadius, stepM, zUp]);
  const dark = useTheme() === "dark";
  return (
    <Grid
      position={zUp ? [0, 0, -distance] : [0, -distance, 0]}
      rotation={zUp ? [Math.PI / 2, 0, 0] : undefined}
      cellSize={stepM}
      cellThickness={0.6}
      cellColor={dark ? "#334155" : "#cbd5e1"}
      sectionSize={stepM * 5}
      sectionThickness={1.2}
      sectionColor={dark ? "#64748b" : "#94a3b8"}
      fadeDistance={Math.max(fitRadius * 8, stepM * 60)}
      fadeStrength={2.5}
      followCamera={false}
      side={THREE.DoubleSide}
      infiniteGrid
    />
  );
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

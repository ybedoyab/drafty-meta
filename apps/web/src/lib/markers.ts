export function faceCentroid(
  vertices: [number, number, number][],
  surface: string,
): [number, number, number] {
  const axis = surface.startsWith("x") ? 0 : surface.startsWith("y") ? 1 : 2;
  const values = vertices.map((vertex) => vertex[axis]);
  const target = surface.endsWith("min") ? Math.min(...values) : Math.max(...values);
  const near = vertices.filter((vertex) => Math.abs(vertex[axis] - target) < 1e-4);
  const sample = near.length ? near : vertices;
  const origin: [number, number, number] = [0, 0, 0];
  for (const vertex of sample) {
    origin[0] += vertex[0];
    origin[1] += vertex[1];
    origin[2] += vertex[2];
  }
  return [origin[0] / sample.length, origin[1] / sample.length, origin[2] / sample.length];
}

export function loadDirection(direction: [number, number, number]): {
  unit: [number, number, number];
  axisLabel: string;
} {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  const unit: [number, number, number] =
    length === 0 ? [0, 0, -1] : [direction[0] / length, direction[1] / length, direction[2] / length];
  const axes = ["X", "Y", "Z"] as const;
  let axis = 0;
  unit.forEach((value, index) => {
    if (Math.abs(value) > Math.abs(unit[axis])) axis = index;
  });
  return { unit, axisLabel: `${unit[axis] < 0 ? "−" : "+"}${axes[axis]}` };
}

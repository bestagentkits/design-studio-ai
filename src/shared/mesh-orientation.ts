import type { MeshData } from './design-capabilities';

/** Orient a closed sampled surface through adjacency; local field gradients can be ambiguous at thin intersections. */
export function orientClosedMesh(mesh: MeshData) {
  const edges = new Map<string, { face: number; direction: number }[]>();
  const neighbors = Array.from({ length: mesh.indices.length / 3 }, () => [] as { face: number; factor: number }[]);
  for (let face = 0; face < neighbors.length; face++) for (let edge = 0; edge < 3; edge++) {
    const a = mesh.indices[face * 3 + edge], b = mesh.indices[face * 3 + (edge + 1) % 3];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const list = edges.get(key) ?? [];
    list.push({ face, direction: a < b ? 1 : -1 }); edges.set(key, list);
  }
  for (const list of edges.values()) {
    if (list.length !== 2) throw new Error('Sampled surface is not closed; adjust resolution or source geometry');
    const [a, b] = list, factor = -a.direction * b.direction;
    neighbors[a.face].push({ face: b.face, factor }); neighbors[b.face].push({ face: a.face, factor });
  }
  const orientation = new Int8Array(neighbors.length);
  for (let seed = 0; seed < neighbors.length; seed++) {
    if (orientation[seed]) continue;
    const component = [seed]; orientation[seed] = 1;
    for (let cursor = 0; cursor < component.length; cursor++) {
      const face = component[cursor];
      for (const next of neighbors[face]) {
        const expected = orientation[face] * next.factor;
        if (orientation[next.face] && orientation[next.face] !== expected) throw new Error('Sampled surface cannot be consistently oriented');
        if (!orientation[next.face]) { orientation[next.face] = expected; component.push(next.face); }
      }
    }
    let volume = 0;
    for (const face of component) {
      const [a, b, c] = mesh.indices.slice(face * 3, face * 3 + 3).map(index => mesh.positions.slice(index * 3, index * 3 + 3));
      volume += orientation[face] * (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]));
    }
    for (const face of component) if (orientation[face] * (volume < 0 ? -1 : 1) < 0) {
      const i = face * 3; [mesh.indices[i + 1], mesh.indices[i + 2]] = [mesh.indices[i + 2], mesh.indices[i + 1]];
    }
  }
}

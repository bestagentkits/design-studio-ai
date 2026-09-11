import { z } from 'zod';
import { meshSchema, type MeshData } from './design-capabilities';

export const meshEditSchema = z.object({
  op: z.enum(['translate', 'scale', 'extrude', 'inset', 'delete-faces', 'subdivide', 'weld', 'uv-planar', 'uv-sphere']),
  selection: z.array(z.number().int().min(0).max(599999)).max(600000),
  amount: z.number().finite().min(-100000).max(100000).optional(),
  vector: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
}).strict();
export type MeshEdit = z.infer<typeof meshEditSchema>;
const vertex = (mesh: MeshData, i: number) => mesh.positions.slice(i * 3, i * 3 + 3) as [number, number, number];
const normal = (a: number[], b: number[], c: number[]) => {
  const u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...n) || 1; return n.map(v => v / length);
};
export function editMesh(input: MeshData, operation: MeshEdit): MeshData {
  const edit = meshEditSchema.parse(operation);
  const mesh = structuredClone(meshSchema.parse(input)), amount = edit.amount ?? .2, vector = edit.vector ?? [0, amount, 0];
  const vertexCount = mesh.positions.length / 3, faceCount = mesh.indices.length / 3;
  const selected = new Set(edit.selection);
  const faces = () => [...selected].map(i => { if (i >= faceCount) throw new Error('Unknown face'); return mesh.indices.slice(i * 3, i * 3 + 3); });
  if (['translate', 'scale', 'extrude', 'inset', 'delete-faces'].includes(edit.op) && !selected.size) throw new Error('Select geometry before editing');
  if (edit.op === 'subdivide') faces();
  const topology = ['extrude', 'inset', 'delete-faces', 'subdivide', 'weld'].includes(edit.op);
  if (topology && (mesh.skinIndices || mesh.morphTargets?.length || mesh.colors)) throw new Error('Topology edits require an unskinned mesh without morph targets or vertex colors. Finish topology first.');
  if (edit.op === 'translate' || edit.op === 'scale') {
    for (const i of selected) { if (i >= vertexCount) throw new Error('Unknown vertex'); for (let axis = 0; axis < 3; axis++) mesh.positions[i * 3 + axis] = edit.op === 'translate' ? mesh.positions[i * 3 + axis] + vector[axis] : mesh.positions[i * 3 + axis] * vector[axis]; }
  } else if (edit.op === 'delete-faces') {
    faces(); mesh.indices = mesh.indices.filter((_, i) => !selected.has(Math.floor(i / 3)));
  } else if (edit.op === 'extrude' || edit.op === 'inset') {
    const triangles = faces();
    const duplicated = new Map<number, number>(), normals = new Map<number, number[]>(), edges = new Map<string, { a: number; b: number; count: number }>();
    const ids = [...new Set(triangles.flat())]; const center = [0, 0, 0];
    ids.forEach(i => vertex(mesh, i).forEach((v, axis) => { center[axis] += v / ids.length; }));
    for (const tri of triangles) {
      const n = normal(vertex(mesh, tri[0]), vertex(mesh, tri[1]), vertex(mesh, tri[2]));
      tri.forEach(i => { const sum = normals.get(i) ?? [0, 0, 0]; n.forEach((v, axis) => { sum[axis] += v; }); normals.set(i, sum); });
      for (let j = 0; j < 3; j++) { const a = tri[j], b = tri[(j + 1) % 3], key = [a, b].sort((a, b) => a - b).join(':'); const edge = edges.get(key); if (edge) edge.count++; else edges.set(key, { a, b, count: 1 }); }
    }
    for (const id of ids) {
      const p = vertex(mesh, id), n = normals.get(id)!, length = Math.hypot(...n) || 1;
      duplicated.set(id, mesh.positions.length / 3);
      mesh.positions.push(...p.map((v, axis) => edit.op === 'inset' ? v + (center[axis] - v) * Math.max(0, Math.min(.99, amount)) : v + n[axis] / length * amount));
      if (mesh.uv) mesh.uv.push(...mesh.uv.slice(id * 2, id * 2 + 2));
    }
    mesh.indices = mesh.indices.filter((_, i) => !selected.has(Math.floor(i / 3)));
    for (const tri of triangles) mesh.indices.push(...tri.map(i => duplicated.get(i)!));
    for (const { a, b, count } of edges.values()) if (count === 1) mesh.indices.push(a, b, duplicated.get(b)!, a, duplicated.get(b)!, duplicated.get(a)!);
  } else if (edit.op === 'subdivide') {
    const result: number[] = [], mids = new Map<string, number>();
    const midpoint = (a: number, b: number) => { const key = [a, b].sort((a, b) => a - b).join(':'); if (mids.has(key)) return mids.get(key)!; const id = mesh.positions.length / 3; mesh.positions.push(...vertex(mesh, a).map((v, axis) => (v + vertex(mesh, b)[axis]) / 2)); if (mesh.uv) mesh.uv.push((mesh.uv[a * 2] + mesh.uv[b * 2]) / 2, (mesh.uv[a * 2 + 1] + mesh.uv[b * 2 + 1]) / 2); mids.set(key, id); return id; };
    for (let i = 0; i < faceCount; i++) { const [a, b, c] = mesh.indices.slice(i * 3, i * 3 + 3); if (selected.size && !selected.has(i)) result.push(a, b, c); else { const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a); result.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca); } }
    mesh.indices = result;
  } else if (edit.op === 'weld') {
    const tolerance = Math.max(.000001, Math.abs(amount)); const points = new Map<string, number>(), mapping: number[] = [], positions: number[] = [], uv: number[] = [];
    for (let i = 0; i < vertexCount; i++) { const p = vertex(mesh, i), key = p.map(v => Math.round(v / tolerance)).join(':') + (mesh.uv ? ':' + mesh.uv.slice(i * 2, i * 2 + 2).join(':') : ''); let id = points.get(key); if (id === undefined) { id = positions.length / 3; points.set(key, id); positions.push(...p); if (mesh.uv) uv.push(...mesh.uv.slice(i * 2, i * 2 + 2)); } mapping.push(id); }
    mesh.positions = positions; if (mesh.uv) mesh.uv = uv; mesh.indices = mesh.indices.map(i => mapping[i]); mesh.indices = mesh.indices.filter((_, i, all) => { const start = Math.floor(i / 3) * 3; return new Set(all.slice(start, start + 3)).size === 3; });
  } else if (edit.op === 'uv-planar' || edit.op === 'uv-sphere') {
    mesh.uv = [];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) vertex(mesh, i).forEach((v, axis) => { min[axis] = Math.min(min[axis], v); max[axis] = Math.max(max[axis], v); });
    const axes = [0, 1, 2].sort((a, b) => (max[b] - min[b]) - (max[a] - min[a]));
    for (let i = 0; i < vertexCount; i++) { const [x, y, z] = vertex(mesh, i); if (edit.op === 'uv-sphere') { const radius = Math.hypot(x, y, z) || 1; mesh.uv.push(.5 + Math.atan2(z, x) / (2 * Math.PI), .5 - Math.asin(y / radius) / Math.PI); } else { const p = [x, y, z]; mesh.uv.push(...axes.slice(0, 2).map(axis => (p[axis] - min[axis]) / (max[axis] - min[axis] || 1))); } }
  }
  return meshSchema.parse(mesh);
}

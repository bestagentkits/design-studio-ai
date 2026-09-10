import type { Bone, BonePose, Point } from './character-schema';
export type Matrix = [number, number, number, number, number, number];
export const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
export const radians = (degrees: number) => degrees * Math.PI / 180;
export const degrees = (value: number) => value * 180 / Math.PI;
export function transform(p: BonePose): Matrix {
  const c = Math.cos(radians(p.rotation)), s = Math.sin(radians(p.rotation));
  return [c * p.scaleX, s * p.scaleX, -s * p.scaleY, c * p.scaleY, p.x, p.y];
}
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
export const point = (m: Matrix, p: Point): Point => [m[0]*p[0]+m[2]*p[1]+m[4], m[1]*p[0]+m[3]*p[1]+m[5]];
export function inverse(m: Matrix): Matrix {
  const d = m[0]*m[3]-m[1]*m[2];
  if (Math.abs(d) < 1e-10) throw new Error('A zero-scale transform cannot be inverted.');
  return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];
}
export function worldMatrices(bones: Bone[], poses: Record<string, BonePose>): Record<string, Matrix> {
  const result: Record<string, Matrix> = Object.create(null), byId = new Map(bones.map(b => [b.id, b]));
  const visit = (bone: Bone): Matrix => result[bone.id] ??= multiply(bone.parentId ? visit(byId.get(bone.parentId)!) : identity(), transform(poses[bone.id]));
  bones.forEach(visit); return result;
}
export const shortestAngle = (from: number, to: number) => ((to - from + 540) % 360 + 360) % 360 - 180;
export const bezierPoint = (p: Point[], t: number): Point => {
  const count = (p.length - 1) / 3, position = Math.min(count - 1e-9, Math.max(0,t)*count), i = Math.floor(position)*3, u = position-Math.floor(position), v=1-u;
  return [0,1].map(a => v*v*v*p[i][a]+3*v*v*u*p[i+1][a]+3*v*u*u*p[i+2][a]+u*u*u*p[i+3][a]) as Point;
};

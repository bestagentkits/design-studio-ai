/** Browser-independent geometry probe; coordinates do not allocate a world-sized canvas. */
export type BoardPoint = { x: number; y: number };
export type BoardCamera = { x: number; y: number; zoom: number };
export type BoardTransform = { x: number; y: number; width: number; height: number; rotation?: number; flipX?: boolean; flipY?: boolean };
export const BOARD_COORDINATE_LIMIT = 1_000_000;
export function finiteRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}
export function validateBoardPoint(point: BoardPoint): BoardPoint {
  finiteRange(point.x, -BOARD_COORDINATE_LIMIT, BOARD_COORDINATE_LIMIT, 'point x');
  finiteRange(point.y, -BOARD_COORDINATE_LIMIT, BOARD_COORDINATE_LIMIT, 'point y');
  return point;
}
export function validateBoardCamera(camera: BoardCamera): void {
  validateBoardPoint(camera);
  finiteRange(camera.zoom, .01, 100, 'camera zoom');
}
/** Camera x/y are the world coordinate at the viewport origin. */
export function worldToScreen(point: BoardPoint, camera: BoardCamera): BoardPoint {
  validateBoardPoint(point); validateBoardCamera(camera);
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}
export function screenToWorld(point: BoardPoint, camera: BoardCamera): BoardPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new RangeError('Invalid screen point');
  validateBoardCamera(camera);
  return validateBoardPoint({ x: point.x / camera.zoom + camera.x, y: point.y / camera.zoom + camera.y });
}
/** Normalized anchors transform around the element center, including flips before rotation. */
export function transformedAnchor(transform: BoardTransform, anchor: BoardPoint): BoardPoint {
  validateBoardPoint(transform);
  finiteRange(transform.width, 0, BOARD_COORDINATE_LIMIT, 'width');
  finiteRange(transform.height, 0, BOARD_COORDINATE_LIMIT, 'height');
  finiteRange(anchor.x, 0, 1, 'anchor x'); finiteRange(anchor.y, 0, 1, 'anchor y');
  const angle = finiteRange(transform.rotation ?? 0, -360_000, 360_000, 'rotation') * Math.PI / 180;
  const x = (anchor.x - .5) * transform.width * (transform.flipX ? -1 : 1);
  const y = (anchor.y - .5) * transform.height * (transform.flipY ? -1 : 1);
  return validateBoardPoint({ x: transform.x + transform.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    y: transform.y + transform.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) });
}
export function segmentDistance(point: BoardPoint, a: BoardPoint, b: BoardPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
export { cubicPathToSvg, cubicPathBounds, hitTestCubicPath, flattenCubicPath } from './board-geometry-path';
export type { BoardCubicPath, BoardCubicSegment } from './board-geometry-path';
export { pressureStrokeToSvg, hitTestPressureStroke, pressureRadius } from './board-geometry-stroke';
export type { BoardPressurePoint } from './board-geometry-stroke';

import { PaintRuntime } from '../src/shared/paint-runtime';
import type { PaintStroke } from '../src/shared/paint-stroke';
export { paintBrushPreset as probeBrush } from '../src/shared/paint-brush-presets';
/** Canvas source-over matches the runtime's straight-alpha sRGB layer boundary. */
export function paintPreview(canvas: HTMLCanvasElement, runtime: PaintRuntime, draft?: { layer: string; stroke: PaintStroke }) {
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, 512, 512);
  const scratch = document.createElement('canvas'); scratch.width = scratch.height = 512;
  const pixels = scratch.getContext('2d')!;
  for (const layer of runtime.layerSettings) {
    if (!layer.visible) continue;
    const tile = draft?.layer === layer.id ? draft.stroke.copyTile(0, 0) : runtime.copyTile(layer.id, 0, 0);
    if (!tile) continue;
    pixels.putImageData(new ImageData(new Uint8ClampedArray(tile), 512, 512), 0, 0);
    context.globalAlpha = layer.opacity; context.drawImage(scratch, 0, 0);
  }
  context.globalAlpha = 1;
}

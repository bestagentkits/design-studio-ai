export const MAX_FRAME_EXPORT_FRAMES = 300;
export const MAX_FRAME_EXPORT_PIXELS = 67_108_864;
export const MAX_SPRITESHEET_SIDE = 16_384;

export interface FrameExportInput {width: number; height: number; start: number; end: number; fps: number; format?: 'png-sequence' | 'spritesheet'}

/** Frame archives sample [start, end) at native page dimensions. */
export function frameExportBudget({width, height, start, end, fps, format}: FrameExportInput) {
  const duration = end - start;
  const validDimensions = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const validRange = Number.isFinite(start) && start >= 0 && Number.isFinite(end) && duration > 0;
  const validFps = Number.isInteger(fps) && fps >= 1 && fps <= 60;
  let maxFrames = validDimensions ? Math.min(MAX_FRAME_EXPORT_FRAMES, Math.floor(MAX_FRAME_EXPORT_PIXELS / (width * height))) : 0;
  if (format === 'spritesheet') {
    for (let count = 1; count <= maxFrames; count++) {
      const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns);
      if (columns * width > MAX_SPRITESHEET_SIDE || rows * height > MAX_SPRITESHEET_SIDE) { maxFrames = count - 1; break; }
    }
  }
  const maxFps = validRange ? Math.max(0, Math.floor(maxFrames / duration)) : 0;
  const frameCount = validRange && validFps ? Math.ceil(duration * fps) : 0;
  return {frameCount, maxFrames, maxFps, withinLimits: validDimensions && validRange && validFps && frameCount >= 1 && frameCount <= maxFrames};
}

export function frameExportBudgetMessage(input: FrameExportInput) {
  if (!Number.isFinite(input.end - input.start) || input.end <= input.start) return 'Frame exports require an end time greater than the start time. Select a positive-duration range.';
  const {maxFps} = frameExportBudget(input);
  const advice = maxFps >= 1 ? `Use at most ${Math.min(60, maxFps)} fps, shorten the range, or reduce page dimensions.` : 'Shorten the range or reduce page dimensions to fit at least 1 fps.';
  return `Frame exports at ${input.width} × ${input.height} over ${input.end - input.start} seconds exceed the budget. ${advice} Use 1–300 frames and at most 64 megapixels in total.${input.format === 'spritesheet' ? ' Spritesheet grids also allow at most 16384 pixels per side.' : ''}`;
}

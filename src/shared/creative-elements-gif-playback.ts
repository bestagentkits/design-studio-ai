import type { BoardElement } from './board-schema';
import { gifFrameAt, type GifAnimation } from './gif-timeline';
/** All clock values are milliseconds; undefined time requests the saved static poster. */
export function boardGifFrame(animation: GifAnimation, element: Extract<BoardElement, { type: 'gif' }>, timeMs?: number, reducedMotion = false) {
  const posterFrame = gifFrameAt(animation, { timeMs: element.posterTime, loop: false });
  if (timeMs === undefined || reducedMotion) return posterFrame;
  return gifFrameAt(animation, { timeMs, startMs: element.startMs, paused: !element.playing, pausedAtMs: element.pausedAtMs, loop: element.loop, posterFrame });
}

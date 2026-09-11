import { diagramStyleSchema, type Board, type BoardElement } from './board-schema';
import type { z } from 'zod';
import { sizeDiagramNode } from './diagram-text';
export type DiagramStyle = z.infer<typeof diagramStyleSchema>;
export const sketchDiagramStyle = diagramStyleSchema.parse({});
export const cleanDiagramStyle = diagramStyleSchema.parse({ roughness: 0, fontFamily: 'Noto Sans', fontSize: 20 });
export function applyDiagramStyle(element: BoardElement, style: DiagramStyle): BoardElement {
  const next = structuredClone(element);
  if ('stroke' in next) {
    const { fontFamily, fontSize, textColor, align, ...visual } = style;
    Object.assign(next, visual);
    if (next.type === 'connector') { next.fill='none'; next.labelFontFamily=fontFamily; next.labelFontSize=fontSize; next.labelColor=textColor; }
    if (next.diagram) { Object.assign(next.diagram,{fontFamily,fontSize,textColor,align}); sizeDiagramNode(next); }
  }
  return next;
}
export function boardDiagramStyle(board: Board): DiagramStyle { return board.diagramDefaults ?? sketchDiagramStyle; }

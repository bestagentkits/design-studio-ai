import { memo } from 'react';
import type { Board, BoardElement } from '../shared/board-schema';
import type { DesignDocument } from '../shared/schema';
import { boardElementSvg } from '../shared/board-render';
/** Camera changes don't regenerate every stroke, connector route and SVG string. */
export const BoardElementView = memo(function BoardElementView({ board, element, doc }: { board: Board; element: BoardElement; doc: DesignDocument }) {
  try { return <g dangerouslySetInnerHTML={{ __html: boardElementSvg(board, element, doc) }}/>; }
  catch(error) { return <g data-board-element={element.id}><title>{String(error)}</title><text x={element.x} y={element.y} fill="#b42318" fontSize="14">{element.name}: route needs attention</text></g>; }
});

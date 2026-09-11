import type { DesignDocument, DesignNode } from '../shared/schema';
import { BoardElementView } from './board-element-view';
import { CreativeGifElement } from './creative-elements-gif';
export function CreativeBoardView({ doc, node, time = 0 }: { doc: DesignDocument; node: DesignNode; time?: number }) {
  const board = doc.schemaVersion === 2 ? doc.boards.find(b => b.id === node.boardId) : undefined;
  if (!board || !node.crop) return <span role="alert">Board unavailable</span>;
  const crop = node.crop;
  return <svg xmlns="http://www.w3.org/2000/svg" width={node.width} height={node.height} viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`} preserveAspectRatio="none" overflow="hidden">
    <rect x={crop.x} y={crop.y} width={crop.width} height={crop.height} fill={board.background}/>
    {board.elements.map(e => e.type === 'gif' ? <CreativeGifElement key={e.id} element={e} board={board} doc={doc} timeMs={time * 1000}/> : <BoardElementView key={e.id} board={board} element={e} doc={doc}/>)}</svg>;
}

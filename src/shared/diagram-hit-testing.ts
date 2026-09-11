import { diagramConnectorPoints, diagramEndpoint } from './diagram-routing';
import { segmentDistance } from './board-geometry';
import type { Board, BoardElement } from './board-schema';
import { boardElementVisible } from './board-render';
/** Hatching and transparent fills still have an interactive node interior. */
export function diagramHitTarget(board: Board, point: {x:number;y:number}): BoardElement | undefined {
  return board.elements.toReversed().find(node => {
    if (!node.diagram || ['connector','frame','group'].includes(node.type) || !boardElementVisible(board,node)) return false;
    const angle=-node.rotation*Math.PI/180,dx=point.x-node.x-node.width/2,dy=point.y-node.y-node.height/2;
    const x=(dx*Math.cos(angle)-dy*Math.sin(angle))/(node.width/2),y=(dx*Math.sin(angle)+dy*Math.cos(angle))/(node.height/2);
    if(node.type==='shape' && node.shape==='ellipse') return x*x+y*y<=1;
    if(node.type==='shape' && node.shape==='diamond') return Math.abs(x)+Math.abs(y)<=1;
    return Math.abs(x)<=1 && Math.abs(y)<=1;
  });
}

/** Screen-sized tolerance makes thin sketch edges selectable at any zoom. */
export function diagramEdgeHitTarget(board: Board, point: {x:number;y:number}, tolerance: number): BoardElement | undefined {
 return board.elements.toReversed().find(edge=>{
  if(edge.type!=='connector'||!boardElementVisible(board,edge))return false;
  let points;try{points=diagramConnectorPoints(board,edge);}catch{points=[diagramEndpoint(board,edge.start),diagramEndpoint(board,edge.end)];}
  return points.slice(1).some((p,i)=>segmentDistance(point,points[i],p)<=tolerance);
 });
}

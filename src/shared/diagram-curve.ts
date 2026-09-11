import type { Board, BoardElement, BoardBounds } from './board-schema';
type Point={x:number;y:number};
export function connectorControls(board:Board,edge:Extract<BoardElement,{type:'connector'}>,a:Point,b:Point):[Point,Point] {
  const distance=Math.max(40,Math.min(240,Math.hypot(b.x-a.x,b.y-a.y)*.45));
  const control=(p:Point,id:string|undefined,other:Point)=>{
    const node=board.elements.find(e=>e.id===id);
    const dx=node?p.x-node.x-node.width/2:other.x-p.x,dy=node?p.y-node.y-node.height/2:other.y-p.y;
    const length=Math.hypot(dx,dy)||1; return {x:p.x+dx/length*distance,y:p.y+dy/length*distance};
  };
  const c=control(a,edge.start.binding?.elementId,b),d=control(b,edge.end.binding?.elementId,a);
  return [c,d];
}
export function connectorPath(board: Board, edge: Extract<BoardElement,{type:'connector'}>, points: Point[]): string {
  const a=points[0],b=points.at(-1)!;
  if(edge.routing==='curve' && !edge.bends.length && !(edge.start.binding && edge.start.binding.elementId===edge.end.binding?.elementId)) {
    const [c,d]=connectorControls(board,edge,a,b);
    return `M ${a.x} ${a.y} C ${c.x} ${c.y} ${d.x} ${d.y} ${b.x} ${b.y}`;
  }
  if(edge.routing==='curve' && edge.bends.length===1){const c=edge.bends[0];return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;}
  let path=`M ${a.x} ${a.y}`;
  for(let i=1;i<points.length-1;i++) {
    const p=points[i],prev=points[i-1],next=points[i+1],l1=Math.hypot(p.x-prev.x,p.y-prev.y),l2=Math.hypot(next.x-p.x,next.y-p.y),r=Math.min(12,l1/2,l2/2);
    if(!l1 || !l2) continue;
    path+=` L ${p.x-(p.x-prev.x)/l1*r} ${p.y-(p.y-prev.y)/l1*r} Q ${p.x} ${p.y} ${p.x+(next.x-p.x)/l2*r} ${p.y+(next.y-p.y)/l2*r}`;
  }
  return path+` L ${b.x} ${b.y}`;
}
export function fitDiagramBounds(elements: BoardElement[]): BoardBounds {
  const nodes=elements.filter(e=>e.visible && e.type!=='connector');
  if(!nodes.length) return {x:0,y:0,width:960,height:640};
  const x=Math.min(...nodes.map(n=>n.x))-64,y=Math.min(...nodes.map(n=>n.y))-64;
  return {x,y,width:Math.max(...nodes.map(n=>n.x+n.width))-x+64,height:Math.max(...nodes.map(n=>n.y+n.height))-y+64};
}

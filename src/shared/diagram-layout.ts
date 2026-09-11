import { arrangeDiagram } from './diagram-arrange';
import { transformedAnchor } from './board-geometry';
import type { Board } from './board-schema';
import type { SemanticElement } from './diagram-presets';
export type DiagramLayoutMode = 'layered' | 'tree' | 'radial';
export function diagramHiddenIds(board: Board): Set<string> {
  const hidden = new Set<string>();
  let grew = true;
  while (grew) { grew = false; for (const node of board.mindMap ?? []) if (node.parentId && (hidden.has(node.parentId) || board.mindMap?.find(p => p.elementId === node.parentId)?.collapsed) && !hidden.has(node.elementId)) { hidden.add(node.elementId); grew = true; } }
  for (const edge of board.elements) if (edge.type === 'connector' && [edge.start, edge.end].some(p => p.binding && hidden.has(p.binding.elementId))) hidden.add(edge.id);
  return hidden;
}
/** Deterministic breadth-first layering accepts cyclic graphs; mind-map validation remains separate. */
export function layoutDiagram(board: Board, mode: DiagramLayoutMode, selectedIds?: string[]): Board {
  const next = structuredClone(board), hidden = diagramHiddenIds(board), chosen = selectedIds?.length ? new Set(selectedIds) : undefined;
  const nodes = next.elements.filter(e => !!e.diagram && !['connector', 'group', 'frame'].includes(e.type) && !hidden.has(e.id) && (!chosen || chosen.has(e.id)));
  if (nodes.length > 1000) throw new Error('Layout supports up to 1000 nodes per selection');
  const ids = new Set(nodes.map(n => n.id)), links: [string, string][] = mode === 'layered' ? board.elements.filter(e => e.type === 'connector').flatMap(e => e.type === 'connector' && e.start.binding && e.end.binding ? [[e.start.binding.elementId, e.end.binding.elementId] as [string, string]] : []) : (board.mindMap ?? []).flatMap(n => n.parentId ? [[n.parentId, n.elementId] as [string, string]] : []);
  const positions=arrangeDiagram(nodes,links,mode);
  const immovable=(node: typeof nodes[number]) => {
    let current: typeof node | undefined = node;
    while(current) {
      if(current.locked || current.diagram?.pinned || board.mindMap?.find(n=>n.elementId===current!.id)?.pinned) return true;
      current=next.elements.find(e=>e.id===current!.parentId);
    }
    return false;
  };
  const fixed=next.elements.filter(e=>!ids.has(e.id)||immovable(e));
  const placed=[...fixed];
  const collides=(a:typeof nodes[number],b:typeof nodes[number])=>!['connector','group','frame'].includes(b.type)&&b.visible&&a.x<b.x+b.width+24&&a.x+a.width+24>b.x&&a.y<b.y+b.height+24&&a.y+a.height+24>b.y;
  for(const node of nodes) {
    if(fixed.includes(node)) continue;
    const p=positions.get(node.id);if(!p)continue;node.x=p.x;node.y=p.y;
    let attempts=0;while(placed.some(other=>other.id!==node.id&&collides(node,other))&&attempts++<1000) node.y+=node.height+40;
    placed.push(node);
  }
  // Keep system boundaries around the nodes they own after a global or regional arrangement.
  const moved = new Set(nodes.filter(n => { const old=board.elements.find(e=>e.id===n.id)!; return n.x!==old.x || n.y!==old.y; }).map(n=>n.id));
  const depth = (id: string): number => { const parent=next.elements.find(e=>e.id===id)?.parentId; return parent?1+depth(parent):0; };
  const containers = next.elements.filter(e=>e.type==='frame' || e.type==='group').sort((a,b)=>depth(b.id)-depth(a.id));
  for (const container of containers) {
    if (container.locked || container.diagram?.pinned) continue;
    const children=next.elements.filter(e=>e.parentId===container.id && e.type!=='connector');
    if (!children.length || !children.some(e=>moved.has(e.id))) continue;
    const padding=container.type==='frame'?32:0;
    const angle=container.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
    const corners=children.flatMap(e=>[{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}].map(anchor=>transformedAnchor(e,anchor))).map(p=>({x:p.x*cos+p.y*sin,y:-p.x*sin+p.y*cos}));
    const x=Math.min(...corners.map(p=>p.x))-padding,y=Math.min(...corners.map(p=>p.y))-padding;
    container.width=Math.max(...corners.map(p=>p.x))+padding-x;
    container.height=Math.max(...corners.map(p=>p.y))+padding-y;
    const cx=x+container.width/2,cy=y+container.height/2;
    container.x=cx*cos-cy*sin-container.width/2;container.y=cx*sin+cy*cos-container.height/2;moved.add(container.id);
  }
  return next;
}
export type DiagramLayoutTicket = { source: string; selection: string; board: Board };
export function prepareDiagramLayout(board: Board, mode: DiagramLayoutMode, selection: string[] = []): DiagramLayoutTicket {
  return { source: JSON.stringify(board), selection: JSON.stringify(selection), board: layoutDiagram(board, mode, selection) };
}
export function acceptDiagramLayout(current: Board, selection: string[], ticket: DiagramLayoutTicket): Board {
  if (JSON.stringify(current) !== ticket.source || JSON.stringify(selection) !== ticket.selection) throw new Error('Diagram changed during layout; run layout again');
  return ticket.board;
}

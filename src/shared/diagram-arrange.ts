import dagre from '@dagrejs/dagre';
import type { BoardElement } from './board-schema';
type Link=[string,string];
/** Content-sized layered graph layout; cycles handled by the graph engine. */
export function arrangeDiagram(nodes: BoardElement[], links: Link[], mode: 'layered'|'tree'|'radial'): Map<string,{x:number;y:number}> {
  const result=new Map<string,{x:number;y:number}>();
  const ids=new Set(nodes.map(n=>n.id));
  links=links.filter(([a,b])=>ids.has(a)&&ids.has(b));
  if(mode==='layered') {
    const graph=new dagre.graphlib.Graph({multigraph:true}).setGraph({rankdir:'LR',nodesep:64,ranksep:110,marginx:48,marginy:48}).setDefaultEdgeLabel(()=>({}));
    nodes.forEach(n=>graph.setNode(n.id,{width:n.width,height:n.height}));
    links.forEach(([a,b],i)=>graph.setEdge(a,b,{},String(i))); dagre.layout(graph);
    nodes.forEach(n=>{const p=graph.node(n.id);result.set(n.id,{x:p.x-n.width/2,y:p.y-n.height/2});});
    return result;
  }
  const children=new Map<string,string[]>(); links.forEach(([a,b])=>children.set(a,[...children.get(a)??[],b]));
  const roots=nodes.filter(n=>!links.some(([,b])=>b===n.id));
  const byId=new Map(nodes.map(n=>[n.id,n])), span=new Map<string,number>(), seen=new Set<string>();
  const measure=(id:string):number=> { if(seen.has(id)) return 0; seen.add(id); const kids=(children.get(id)??[]).map(measure);const h=Math.max(byId.get(id)!.height,kids.reduce((a,b)=>a+b,0)+Math.max(0,kids.length-1)*40);span.set(id,h);return h; };
  roots.forEach(n=>measure(n.id));
  const place=(id:string,x:number,y:number)=>{const n=byId.get(id)!;result.set(id,{x,y:y+(span.get(id)!-n.height)/2});let offset=y;for(const child of children.get(id)??[]){if(result.has(child))continue;place(child,x+n.width+120,offset);offset+=(span.get(child)??80)+40;}};
  let offset=48;roots.forEach(n=>{place(n.id,48,offset);offset+=(span.get(n.id)??80)+96;});
  // Radial reuses subtree allocation so sibling wedges reflect the whole branch, not just depth.
  if(mode==='radial' && roots.length===1) {
    const root=roots[0],rootP=result.get(root.id)!,center={x:rootP.x+root.width/2,y:rootP.y+root.height/2};
    const radiusStep=Math.max(...nodes.map(n=>Math.max(n.width,n.height)))+120;
    for(const [id,p] of result) if(id!==root.id) {const n=byId.get(id)!,angle=((p.y+n.height/2-48)/(span.get(root.id)||1))*Math.PI*2-Math.PI,depth=Math.max(1,Math.round((p.x-rootP.x)/(root.width+120)));result.set(id,{x:center.x+Math.cos(angle)*depth*radiusStep-n.width/2,y:center.y+Math.sin(angle)*depth*radiusStep-n.height/2});}
  }
  return result;
}

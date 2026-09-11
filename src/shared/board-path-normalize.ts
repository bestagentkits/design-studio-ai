import type { BoardElement } from './board-schema';
/** Rebase edited local path points without moving the path's rotated/flipped world geometry. */
export function normalizeBoardPath(path: Extract<BoardElement, { type: 'path' }>) {
  const xs: number[] = [], ys: number[] = [];
  for (const command of path.commands) { const c = command as unknown as Record<string, number>; for (const key of ['x','x1','x2']) if (typeof c[key] === 'number') xs.push(c[key]); for (const key of ['y','y1','y2']) if (typeof c[key] === 'number') ys.push(c[key]); }
  if (!xs.length) return;
  const minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(1,Math.max(...xs)-minX),height=Math.max(1,Math.max(...ys)-minY);
  const angle=path.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),fx=path.flipX?-1:1,fy=path.flipY?-1:1;
  const dx=(minX-path.width/2)*fx,dy=(minY-path.height/2)*fy;
  const worldX=path.x+path.width/2+dx*cos-dy*sin,worldY=path.y+path.height/2+dx*sin+dy*cos;
  path.x=worldX-width/2+(width/2*fx)*cos-(height/2*fy)*sin;
  path.y=worldY-height/2+(width/2*fx)*sin+(height/2*fy)*cos;path.width=width;path.height=height;
  for(const command of path.commands) { const c=command as unknown as Record<string,number>; for(const key of ['x','x1','x2']) if(typeof c[key]==='number') c[key]-=minX; for(const key of ['y','y1','y2']) if(typeof c[key]==='number') c[key]-=minY; }
}

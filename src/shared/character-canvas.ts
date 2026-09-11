import type { Character, CharacterInstance, Point } from './character-schema';
import { evaluateCharacter, attachmentVertices, attachmentMatrix } from './character-runtime';
import { inverse, multiply, worldMatrices, type Matrix } from './character-math';
const triangle = (a:Point,b:Point,c:Point):Matrix=>[b[0]-a[0],b[1]-a[1],c[0]-a[0],c[1]-a[1],a[0],a[1]];
function path(ctx:CanvasRenderingContext2D, points:Point[],inverse=false) {
  ctx.beginPath(); if(inverse) ctx.rect(-100000,-100000,200000,200000);
  points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p)); ctx.closePath();
}
export function drawCharacter(ctx:CanvasRenderingContext2D,c:Character,i:CharacterInstance,images:Map<string,CanvasImageSource>,time:number) {
  const pose=evaluateCharacter(c,i,time), world=worldMatrices(c.bones,pose.bones);
  const slots=[...c.slots].sort((a,b)=>pose.slots[a.id].order-pose.slots[b.id].order);
  const clips:{points:Point[];inverse:boolean;end:string}[]=[];
  for(const slot of slots) {
    const state=pose.slots[slot.id],a=c.attachments.find(a=>a.id===state.attachment);
    if(a&&a.kind!=='bounds') {
      const vertices=attachmentVertices(c,a,pose,world);
      if(a.kind==='clipping') clips.push({points:vertices,inverse:a.inverse??false,end:a.clipEndSlotId??slots.at(-1)!.id});
      else {
        const assetId=a.kind==='sequence'?a.frames?.[Math.floor(time*(a.fps??12))%a.frames.length]:a.assetId, image=images.get(assetId??'');
        if(image) {
          ctx.save(); for(const clip of clips) {path(ctx,clip.points,clip.inverse);ctx.clip('evenodd');}
          ctx.globalAlpha=Math.max(0,Math.min(1,state.opacity));ctx.globalCompositeOperation=slot.blend==='normal'?'source-over':slot.blend==='add'?'lighter':slot.blend;
          const mesh=a.mesh??c.attachments.find(x=>x.id===a.sourceMeshId)?.mesh;
          if(mesh) for(let n=0;n<mesh.triangles.length;n+=3) {
            const indices=mesh.triangles.slice(n,n+3), target=indices.map(j=>vertices[j]), source=indices.map(j=>[mesh.uv[j][0]*a.width,mesh.uv[j][1]*a.height] as Point);
            let matrix:Matrix; try {matrix=multiply(triangle(target[0],target[1],target[2]),inverse(triangle(source[0],source[1],source[2])));} catch {continue;}
            ctx.save();path(ctx,target);ctx.clip();ctx.transform(...matrix);ctx.drawImage(image,0,0,a.width,a.height);ctx.restore();
          } else {ctx.transform(...multiply(world[slot.boneId],attachmentMatrix(a)));ctx.drawImage(image,0,0,a.width,a.height);}
          ctx.restore();
        }
      }
    }
    for(let j=clips.length-1;j>=0;j--) if(clips[j].end===slot.id) clips.splice(j,1);
  }
}

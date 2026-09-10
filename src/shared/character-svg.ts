import type { Character, CharacterInstance, Point } from './character-schema';
import { evaluateCharacter, attachmentVertices, attachmentMatrix } from './character-runtime';
import { inverse, multiply, worldMatrices, type Matrix } from './character-math';
const escape = (s: string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const matrix = (m: Matrix) => `matrix(${m.join(' ')})`;
const polygon = (p: Point[]) => p.map(v=>v.join(',')).join(' ');
function triangle(a: Point,b: Point,c: Point): Matrix { return [b[0]-a[0],b[1]-a[1],c[0]-a[0],c[1]-a[1],a[0],a[1]]; }

/** The same SVG geometry is used in browser composition, stills and video capture. */
export function characterSvg(c: Character, instance: CharacterInstance, assets: {id:string;url:string}[], time: number, namespace: string): string {
  const pose = evaluateCharacter(c,instance,time), world = worldMatrices(c.bones,pose.bones);
  const slots = [...c.slots].sort((a,b)=>pose.slots[a.id].order-pose.slots[b.id].order);
  let defs = '', body = ''; const clips: {id:string;end:string}[] = [];
  for (const slot of slots) {
    const state = pose.slots[slot.id], a = c.attachments.find(x=>x.id===state.attachment);
    if(a && a.kind !== 'bounds') {
      const vertices = attachmentVertices(c,a,pose,world);
      if(a.kind === 'clipping') {
        const id=escape(`${namespace}-${a.id}`);
        // Even-odd paths support holes without requiring a GPU stencil buffer.
        const path=`M ${vertices.map(p=>p.join(' ')).join(' L ')} Z`;
        defs+=`<clipPath id="${id}"><path clip-rule="evenodd" d="${a.inverse?'M -100000 -100000 H 100000 V 100000 H -100000 Z ':''}${path}"/></clipPath>`;
        clips.push({id,end:a.clipEndSlotId??slots.at(-1)!.id});
      } else {
        const assetId=a.kind==='sequence'?a.frames?.[Math.floor(time*(a.fps??12))%a.frames.length]:a.assetId;
        const url=assets.find(x=>x.id===assetId)?.url;
        if(url) {
          let content=''; const mesh=a.mesh??c.attachments.find(x=>x.id===a.sourceMeshId)?.mesh;
          if(mesh) {
            for(let n=0;n<mesh.triangles.length;n+=3) {
              const indices=mesh.triangles.slice(n,n+3), target=indices.map(i=>vertices[i]), source=indices.map(i=>[mesh.uv[i][0]*a.width,mesh.uv[i][1]*a.height] as Point);
              let m:Matrix; try { m=multiply(triangle(target[0],target[1],target[2]),inverse(triangle(source[0],source[1],source[2]))); } catch { continue; }
              const id=escape(`${namespace}-${a.id}-${n}`);
              defs+=`<clipPath id="${id}"><polygon points="${polygon(target)}"/></clipPath>`;
              content+=`<g clip-path="url(#${id})"><image href="${escape(url)}" width="${a.width}" height="${a.height}" preserveAspectRatio="none" transform="${matrix(m)}"/></g>`;
            }
          } else content=`<image href="${escape(url)}" width="${a.width}" height="${a.height}" preserveAspectRatio="none" transform="${matrix(multiply(world[slot.boneId],attachmentMatrix(a)))}"/>`;
          for(const clip of clips) content=`<g clip-path="url(#${clip.id})">${content}</g>`;
          body+=`<g opacity="${Math.max(0,Math.min(1,state.opacity))}" style="mix-blend-mode:${slot.blend==='add'?'plus-lighter':slot.blend}">${content}</g>`;
        }
      }
    }
    for(let j=clips.length-1;j>=0;j--) if(clips[j].end===slot.id) clips.splice(j,1);
  }
  return `<defs>${defs}</defs><g style="isolation:isolate">${body}</g>`;
}

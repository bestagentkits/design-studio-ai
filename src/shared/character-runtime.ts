import type { Character, CharacterInstance, Point, Attachment } from './character-schema';
import { animatedPose, type CharacterPose } from './motion-channels';
import { solveConstraints } from './character-constraints';
import { inverse, multiply, point, transform, worldMatrices, type Matrix } from './character-math';

const step = 1 / 120;
type Spring = { angle: number; velocity: number };
type Checkpoint = { frame: number; springs: Record<string, Spring> };
const caches = new WeakMap<CharacterInstance, { character: Character; checkpoints: Checkpoint[] }>();
function targetPose(c: Character, instance: CharacterInstance, time: number) { const pose=solveConstraints(c, animatedPose(c, instance, time));if(Object.values(worldMatrices(c.bones,pose.bones)).some(m=>m.some(v=>!Number.isFinite(v)||Math.abs(v)>1e9)))throw new Error('Animated transforms exceed the numeric budget');return pose; }
export function evaluateCharacter(c: Character, instance: CharacterInstance, seconds: number): CharacterPose {
  const time = Math.max(0, Math.min(3600, seconds)), frame = Math.floor(time / step);
  const result = targetPose(c, instance, time);
  if (!result.constraints.some(x => x.type === 'physics'&&x.mix)) return result;
  let cache = caches.get(instance);
  if (!cache || cache.character !== c) { cache = { character: c, checkpoints: [] }; caches.set(instance, cache); }
  const checkpoint = cache.checkpoints.filter(x => x.frame <= frame).at(-1);
  if((frame-(checkpoint?.frame??0))*c.bones.length*(1+c.constraints.filter(x=>x.type==='ik').length*24)>5000000)throw new Error('Physics seek exceeds the work budget. Bake a shorter clip before seeking this far.');
  const springs: Record<string, Spring> = structuredClone(checkpoint?.springs ?? {});
  for (let n = checkpoint?.frame ?? 0; n <= frame; n++) {
    const pose = targetPose(c, instance, n * step);
    for (const control of pose.constraints.filter(x => x.type === 'physics')) for (const id of control.bones) {
      const key = `${control.id}:${id}`, target = pose.bones[id].rotation;
      const spring = springs[key] ??= { angle: target, velocity: 0 };
      if (n > (checkpoint?.frame ?? 0)) {
        // Semi-implicit integration at fixed time steps makes seeks independent of display FPS.
        const acceleration = (control.stiffness * (target - spring.angle) - control.damping * spring.velocity + control.gravity + control.wind) / control.mass;
        spring.velocity = Math.max(-10000, Math.min(10000, spring.velocity + acceleration * step));
        spring.angle = Math.max(-100000, Math.min(100000, spring.angle + spring.velocity * step));
      }
    }
    if (n % 120 === 0 && !cache.checkpoints.some(x => x.frame === n)) {
      cache.checkpoints.push({ frame: n, springs: structuredClone(springs) }); cache.checkpoints.sort((a,b)=>a.frame-b.frame);
      if (cache.checkpoints.length > 120) cache.checkpoints.shift();
    }
  }
  for (const control of result.constraints.filter(x => x.type === 'physics')) for (const id of control.bones) {
    const spring = springs[`${control.id}:${id}`];
    if (spring) result.bones[id].rotation += (spring.angle - result.bones[id].rotation) * control.mix;
  }
  return result;
}
export function attachmentMatrix(a: Attachment): Matrix {
  return transform({ x: a.x - a.pivot[0] * a.width, y: a.y - a.pivot[1] * a.height, rotation: a.rotation, scaleX: 1, scaleY: 1 });
}
const binds = new WeakMap<Character,Record<string,Matrix>>();
export function attachmentVertices(c: Character, a: Attachment, pose: CharacterPose, matrices?: Record<string,Matrix>): Point[] {
  const mesh = a.mesh ?? c.attachments.find(x => x.id === a.sourceMeshId)?.mesh;
  const slot = c.slots.find(x => x.id === a.slotId)!;
  const world = matrices ?? worldMatrices(c.bones, pose.bones), local = attachmentMatrix(a);
  const vertices = mesh?.vertices ?? a.points ?? [[0,0],[a.width,0],[a.width,a.height],[0,a.height]];
  const deform = pose.deform[a.id] ?? [];
  if (!mesh?.weights) return vertices.map((v,i)=>point(multiply(world[slot.boneId],local),[v[0]+(deform[i*2]??0),v[1]+(deform[i*2+1]??0)]));
  let bind = binds.get(c); if(!bind) { bind=worldMatrices(c.bones,Object.fromEntries(c.bones.map(b=>[b.id,b]))); binds.set(c,bind); }
  const skin = Object.fromEntries(c.bones.map(b=>{ try { return [b.id,multiply(world[b.id],inverse(bind![b.id]))]; } catch { return [b.id,[1,0,0,1,0,0] as Matrix]; } }));
  return vertices.map((v,i)=>{
    const rest = point(multiply(bind[slot.boneId],local),[v[0]+(deform[i*2]??0),v[1]+(deform[i*2+1]??0)]);
    return mesh.weights![i].reduce<Point>((sum,w)=>{
      const p=point(skin[w.boneId],rest);
      return [sum[0]+p[0]*w.weight,sum[1]+p[1]*w.weight];
    },[0,0]);
  });
}

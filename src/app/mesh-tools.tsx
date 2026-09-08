import { useEffect, useRef, useState } from 'react';
import type { DesignNode } from '../shared/schema';
import { geometryFor, meshData } from '../shared/scene-runtime';
import type { MeshEdit } from '../shared/mesh-editing';
import { meshSchema } from '../shared/design-capabilities';

export function MeshTools({ node, update, mode, setMode, selection, select, animatedBones = [] }: { node: DesignNode; update: (patch: Partial<DesignNode>) => void; mode: string; setMode: (mode: string) => void; selection: number[]; select: (indices: number[]) => void; animatedBones?: number[] }) {
  const [amount, setAmount] = useState(.2), [busy, setBusy] = useState(false), [error, setError] = useState(''), [bone, setBone] = useState(0), [axis, setAxis] = useState(1), [weight, setWeight] = useState(1), [secondary, setSecondary] = useState(0);
  const worker = useRef<Worker | null>(null), latest = useRef({ node, update, select }); latest.current = { node, update, select };
  const scene = node.scene ?? {}, mesh = scene.mesh, bones = scene.bones ?? [], activeBone = Math.min(bone, Math.max(0, bones.length - 1));
  const selectedVertices = mesh ? [...new Set(mode === 'face' ? selection.flatMap(i => mesh.indices.slice(i * 3, i * 3 + 3)) : selection)].filter(i => i < mesh.positions.length / 3) : [];
  useEffect(() => { setBusy(false); setError(''); return () => { worker.current?.terminate(); worker.current = null; }; }, [node.id]);
  const commit = (patch: NonNullable<DesignNode['scene']>) => update({ scene: { ...scene, ...patch } });
  const run = (op: MeshEdit['op'], indices = selection) => {
    if (!mesh || worker.current) return;
    setBusy(true); setError(''); const originalScene = JSON.stringify(scene), originalId = node.id;
    try {
      const job = new Worker('/studio-geometry-worker.js'); worker.current = job;
      const finish = () => { job.terminate(); if (worker.current === job) { worker.current = null; setBusy(false); } };
      job.onerror = () => { setError('Geometry worker failed. Your mesh was not changed.'); finish(); };
      job.onmessage = e => {
        if (worker.current !== job) return;
        try {
          if (e.data.error) throw new Error(e.data.error);
          if (latest.current.node.id !== originalId || JSON.stringify(latest.current.node.scene ?? {}) !== originalScene) throw new Error('The scene changed while geometry was processing. Run the operation again on the current mesh.');
          latest.current.update({ scene: { ...latest.current.node.scene, mesh: meshSchema.parse(e.data.mesh) } }); latest.current.select([]);
        } catch (err) { setError(err instanceof Error ? err.message : 'Geometry failed'); } finally { finish(); }
      };
      const vector: [number, number, number] = op === 'scale' ? [1, 1, 1] : [0, 0, 0]; vector[axis] = amount;
      job.postMessage({ mesh, edit: { op, selection: indices, amount, vector } });
    } catch (err) { worker.current?.terminate(); worker.current = null; setBusy(false); setError((err as Error).message); }
  };
  const convert = () => { try { const geometry = geometryFor(node); try { commit({ mesh: meshData(geometry) }); } finally { geometry.dispose(); } } catch (err) { setError((err as Error).message); } };
  const editBone = (patch: Partial<typeof bones[number]>) => { const next = structuredClone(bones); if (next[activeBone]) { Object.assign(next[activeBone], patch); commit({ bones: next }); } };
  const paint = (vertices: number[]) => {
    if (!mesh || !bones.length || !Number.isFinite(weight)) return;
    const next = structuredClone(mesh), count = next.positions.length / 3, other = secondary < bones.length ? secondary : 0;
    next.skinIndices ??= Array(count * 4).fill(0); next.skinWeights ??= Array.from({ length: count * 4 }, (_, i) => i % 4 ? 0 : 1);
    for (const v of vertices) { next.skinIndices.splice(v * 4, 4, activeBone, other, 0, 0); next.skinWeights.splice(v * 4, 4, activeBone === other ? 1 : weight, activeBone === other ? 0 : 1 - weight, 0, 0); }
    commit({ mesh: next });
  };
  return <div className="mesh-tools"><h3>Mesh & rig</h3>
    {!mesh ? <><button onClick={convert} disabled={!!node.src}>Convert primitive to editable mesh</button>{node.src && <small>Imported models retain their original geometry. Mesh editing applies to converted primitives.</small>}</> : <>
      <label>Selection <select value={mode} onChange={e => { setMode(e.target.value); select([]); }}><option value="object">Object</option><option value="vertex">Vertex</option><option value="edge">Edge endpoints</option><option value="face">Face</option></select></label>
      <label>{mode === 'face' ? 'Selected face indices' : 'Selected vertex indices'} <input aria-label="Selected geometry indices" value={selection.join(',')} onChange={e => { const ids = e.target.value.split(',').filter(v => v.trim()).map(Number), limit = mode === 'face' ? mesh.indices.length / 3 : mesh.positions.length / 3; if (ids.every(i => Number.isInteger(i) && i >= 0 && i < limit)) { select([...new Set(ids)]); setError(''); } else setError(`Indices must be whole numbers from 0 to ${limit - 1}.`); }}/></label>
      <small>Click geometry; Shift adds or removes selection. {mesh.positions.length / 3} vertices · {mesh.indices.length / 3} triangles.</small>
      <div className="mesh-buttons"><button onClick={() => select([])}>Clear selection</button><button disabled={mode === 'object'} onClick={() => select(Array.from({ length: mode === 'face' ? mesh.indices.length / 3 : mesh.positions.length / 3 }, (_, i) => i))}>Select all</button></div>
      <label>Amount <input type="number" step=".05" value={amount} onChange={e => setAmount(+e.target.value)}/></label><label>Axis <select value={axis} onChange={e => setAxis(+e.target.value)}>{['X', 'Y', 'Z'].map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
      <div className="mesh-buttons">{(['translate', 'scale'] as const).map(op => <button key={op} disabled={busy || !selectedVertices.length || mode === 'object'} onClick={() => run(op, selectedVertices)}>{op} selected</button>)}
        {mode === 'face' && (['extrude', 'inset', 'delete-faces', 'subdivide'] as const).map(op => <button key={op} disabled={busy || !selection.length || !!mesh.skinIndices} onClick={() => run(op)}>{op} faces</button>)}
        <button disabled={busy || !!mesh.skinIndices} onClick={() => run('weld', [])}>Weld whole mesh</button><button disabled={busy || !!mesh.skinIndices} onClick={() => run('subdivide', [])}>Subdivide whole mesh</button>
      </div><small>Scale uses Amount as the selected axis multiplier. Topology edits require an unbound mesh.</small>
      {busy && <button onClick={() => { worker.current?.terminate(); worker.current = null; setBusy(false); }}>Cancel geometry task</button>}
      <h4>UV mapping</h4><div className="mesh-buttons"><button disabled={busy} onClick={() => run('uv-planar', [])}>Planar unwrap</button><button disabled={busy} onClick={() => run('uv-sphere', [])}>Spherical unwrap</button></div>
      {mesh.uv && <><small>Click a UV point to select its vertex; drag it to edit. Yellow points show selected vertices. Up to 3,000 points shown; index selection reaches every vertex.</small><svg className="uv-editor" viewBox="0 0 256 256" aria-label="UV editor" style={{ width: '100%', background: '#333', touchAction: 'none' }}>
        {Array.from({ length: Math.min(mesh.indices.length / 3, 3000) }, (_, i) => <polygon key={i} fill="none" stroke="#ffffff30" strokeWidth=".5" points={mesh.indices.slice(i * 3, i * 3 + 3).map(id => `${mesh.uv![id * 2] * 256},${(1 - mesh.uv![id * 2 + 1]) * 256}`).join(' ')}/>)}
        {[...new Set([...selectedVertices.slice(0, 500), ...Array.from({ length: Math.min(mesh.positions.length / 3, 3000) }, (_, i) => i)])].map(i => <circle key={i} cx={mesh.uv![i * 2] * 256} cy={(1 - mesh.uv![i * 2 + 1]) * 256} r={selectedVertices.includes(i) ? 3 : 2} fill={selectedVertices.includes(i) ? '#f59e0b' : '#aaa'} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.original = JSON.stringify(scene); e.currentTarget.dataset.start = `${e.clientX},${e.clientY}`; setMode('vertex'); select(e.shiftKey ? [...new Set([...selectedVertices, i])] : [i]); }} onPointerUp={e => {
          const start = e.currentTarget.dataset.start?.split(',').map(Number); if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) < 3) return;
          if (e.currentTarget.dataset.original !== JSON.stringify(latest.current.node.scene)) { setError('The mesh changed during UV dragging. Try again.'); return; }
          const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect(), next = structuredClone(mesh); next.uv![i * 2] = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); next.uv![i * 2 + 1] = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)); commit({ mesh: next });
        }}/>)}</svg></>}
      <h4>Skeleton & weights</h4><button disabled={bones.length >= 256} onClick={() => { commit({ bones: [...bones, { name: `Bone ${bones.length + 1}`, parent: bones.length ? activeBone : -1, position: [0, 1, 0] }] }); setBone(bones.length); }}>Add bone</button>
      {!!bones.length && <><label>Active bone <select aria-label="Active bone" value={activeBone} onChange={e => setBone(+e.target.value)}>{bones.map((b, i) => <option key={i} value={i}>{b.name}</option>)}</select></label>
        <label>Bone name <input value={bones[activeBone].name} maxLength={120} onChange={e => editBone({ name: e.target.value })}/></label><label>Parent bone <select value={bones[activeBone].parent} onChange={e => editBone({ parent: +e.target.value })}><option value={-1}>Root</option>{bones.slice(0, activeBone).map((b, i) => <option key={i} value={i}>{b.name}</option>)}</select></label>
        {(['position', 'rotation'] as const).map(property => <div key={property}>{property}{property === 'rotation' && ' (degrees)'}{[0, 1, 2].map(i => <input key={i} aria-label={`Bone ${property} ${'XYZ'[i]}`} type="number" step={property === 'position' ? .1 : 1} value={bones[activeBone][property]?.[i] ?? 0} onChange={e => { const value = +e.target.value; if (!Number.isFinite(value) || Math.abs(value) > 100000) return; const vector: [number, number, number] = [...(bones[activeBone][property] ?? [0, 0, 0])]; vector[i] = value; editBone({ [property]: vector }); }}/>)}</div>)}
        <label>Weight <input aria-label="Bone weight" type="number" min={0} max={1} step={.05} value={weight} onChange={e => { const value = +e.target.value; if (Number.isFinite(value)) setWeight(Math.max(0, Math.min(1, value))); }}/></label><label>Remaining weight to <select value={Math.min(secondary, bones.length - 1)} onChange={e => setSecondary(+e.target.value)}>{bones.map((b, i) => <option key={i} value={i}>{b.name}</option>)}</select></label>
        <button onClick={() => paint(Array.from({ length: mesh.positions.length / 3 }, (_, i) => i))}>Bind all vertices with weights</button><button disabled={!selectedVertices.length || mode === 'object'} onClick={() => paint(selectedVertices)}>Paint selected weights</button>
        <button disabled={!mesh.skinIndices} onClick={() => { const next = structuredClone(mesh); delete next.skinIndices; delete next.skinWeights; commit({ mesh: next }); }}>Unbind mesh</button>
        <button disabled={!!mesh.skinIndices || bones.some(b => b.parent === activeBone) || animatedBones.some(i => i >= activeBone)} onClick={() => { const next = bones.filter((_, i) => i !== activeBone).map(b => ({ ...b, parent: b.parent > activeBone ? b.parent - 1 : b.parent })); commit({ bones: next }); setBone(0); }}>Delete unbound leaf bone</button><small>Delete requires an unbound leaf bone and no animation keys referencing it or later bones.</small>
      </>}
    </>}{error && <p role="alert">{error}</p>}
  </div>;
}

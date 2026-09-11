import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillPainting } from '../src/shared/painting-fill';
import { selectionCoverage } from '../src/shared/painting-selection';
import { PaintRuntime } from '../src/shared/paint-runtime';
import { paintBrushPreset } from '../src/shared/paint-brush-presets';
const red = [255, 0, 0, 255] as [number, number, number, number];
const transparent = [0, 0, 0, 0] as [number, number, number, number];
test('contiguous fill does not cross an opaque boundary', async () => {
  const draft = await fillPainting(3, 1, { x: 0, y: 0, color: red, tolerance: 0, contiguous: true }, x => x === 1 ? red : transparent);
  const tile = draft.copyTile(0, 0)!; assert.equal(tile[3], 255); assert.equal(tile[11], 0);
});
test('global fill respects mask and feather selection', async () => {
  const draft = await fillPainting(3, 1, { x: 0, y: 0, color: red, tolerance: 0, contiguous: false, selection: { kind: 'rectangle', points: [{x: 0,y: 0},{x: 3,y: 1}], feather: 1 } }, () => transparent, undefined, x => x === 1 ? 0 : 1);
  const tile = draft.copyTile(0,0)!; assert.equal(tile[3], 128); assert.equal(tile[7], 0); assert.equal(tile[11], 128);
});
test('visible sampling controls membership while writing selected layer', async () => {
  const draft = await fillPainting(2, 1, {x: 0,y: 0,color: red,tolerance: 0,contiguous: false}, () => transparent, x => x ? red : transparent);
  assert.equal(draft.copyTile(0,0)![7], 0);
});
test('cancelled fill publishes no result', async () => {
  const abort = new AbortController(); abort.abort(); await assert.rejects(fillPainting(3, 1, {x:0,y:0,color:red,tolerance:0,contiguous:true}, () => transparent, undefined, undefined, abort.signal), /cancelled/);
});
test('lasso excludes outside points and feathers inside', () => {
  const selection = {kind:'lasso' as const, points:[{x:0,y:0},{x:10,y:0},{x:0,y:10}],feather:2};
  assert.equal(selectionCoverage(selection, 9,9),0); assert.equal(selectionCoverage(selection,1,1),.5);
});
test('brush coverage preserves masked pixels', () => {
  const runtime = new PaintRuntime(8,8); runtime.addLayer('a'); const stroke = runtime.beginStroke('a', paintBrushPreset('bristle', 8, 1, '#ff0000'), undefined, x => x < 4 ? 1 : 0);
  stroke.append([{x:4,y:4,pressure:1,tiltX:45,tiltY:0}]); stroke.commit(); assert.equal(runtime.pixel(5,4,'a')[3],0); assert.ok(runtime.pixel(3,4,'a')[3] > 0);
});
test('final ink taper narrows both ends without erasing the frozen source', () => {
  const runtime = new PaintRuntime(128,64); runtime.addLayer('a');
  const brush = paintBrushPreset('ink',20,1,'#ff0000');
  runtime.stroke('a', Array.from({length:21},(_,i)=>({x:10+i*5,y:32,pressure:1})),brush);
  const width = (x:number) => Array.from({length:64},(_,y)=>runtime.pixel(x,y,'a')[3]).filter(a=>a>0).length;
  assert.ok(width(60)>width(12)); assert.ok(width(60)>width(108));
});
test('locked groups prevent pixel replacement, ungroup bypass and resize', async () => {
  const { assertPaintingTransition } = await import('../src/shared/painting-transition');
  const painting = {id:'paint',name:'Paint',width:512,height:512,generation:0,colorSpace:'srgb' as const,algorithm:'cpu-srgb-grain-v1' as const,tileSize:512 as const,groups:[{id:'group',name:'Group',opacity:1,visible:true,locked:true}],layers:[{id:'layer',name:'Layer',groupId:'group',tiles:[],visible:true,locked:false,opacity:1,blend:'normal' as const,alphaLock:false,clipping:false}]};
  const resized=structuredClone(painting);resized.width=256;assert.throws(()=>assertPaintingTransition(painting,resized),/Unlock/);
  const ungrouped=structuredClone(painting);ungrouped.groups=[];assert.throws(()=>assertPaintingTransition(painting,ungrouped),/Unlock/);
});

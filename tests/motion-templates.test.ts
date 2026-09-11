import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMotionPrimitive, createMotionDocument, motionPrimitiveSchema, motionTemplates, SUPPORTED_KEYS } from '../src/shared/motion-templates';
import { documentSchema } from '../src/shared/schema';
import { interpolateNode } from '../src/shared/render';

const keyframeKeys = (tracks: { keyframes: Array<{ values: Record<string, unknown> }> }[]) =>
  [...new Set(tracks.flatMap(t => t.keyframes.flatMap(k => Object.keys(k.values))))];

test('motion primitives compile deterministically to supported timeline keyframes', async () => {
  const nodeIds = ['n1', 'n2', 'n3', 'n4'];
  for (const template of motionTemplates) {
    const primitive = motionPrimitiveSchema.parse(template.primitive);
    const first = compileMotionPrimitive(primitive, nodeIds);
    const second = compileMotionPrimitive(primitive, nodeIds);
    assert.deepEqual(first, second, `${template.id} is deterministic`);
    assert.equal(first.tracks.length, nodeIds.length, `${template.id} emits one track per node`);
    for (const key of keyframeKeys(first.tracks)) {
      assert.ok((SUPPORTED_KEYS as readonly string[]).includes(key), `${template.id} emitted unsupported key "${key}"`);
    }
    assert.ok(first.duration > 0, `${template.id} has a positive duration`);
  }
});

test('reveal and stagger apply a staggered fade-and-rise', () => {
  const reveal = compileMotionPrimitive({ type: 'reveal', duration: 1.5, stagger: 0.15 }, ['a', 'b']);
  const revealKeys = keyframeKeys(reveal.tracks);
  assert.deepEqual(revealKeys.sort(), ['opacity', 'y']);
  assert.equal(reveal.tracks[1].keyframes[0].time, 0.15, 'second node starts after the stagger offset');
  assert.equal(reveal.tracks[1].keyframes[1].values.opacity, 1);
  const stagger = compileMotionPrimitive({ type: 'stagger', duration: 1.5, stagger: 0.25 }, ['a', 'b']);
  assert.ok(keyframeKeys(stagger.tracks).includes('rotation'), 'stagger adds a tilt pop');
});

test('kinetic-type and chart-race use only node-level keys', () => {
  const kinetic = compileMotionPrimitive({ type: 'kinetic-type', duration: 1.2 }, ['title']);
  for (const key of keyframeKeys(kinetic.tracks)) assert.ok((SUPPORTED_KEYS as readonly string[]).includes(key));
  const race = compileMotionPrimitive({ type: 'chart-race', duration: 5, steps: 4 }, ['a', 'b', 'c', 'd']);
  assert.equal(race.tracks.length, 4);
  assert.equal(race.tracks[0].keyframes.length, 5, 'chart-race has a keyframe per step plus the endpoint');
  for (const key of keyframeKeys(race.tracks)) assert.equal(key, 'y');
});

test('createMotionDocument produces a valid video document with a timeline', () => {
  for (const template of motionTemplates) {
    const doc = createMotionDocument(template.id);
    const parsed = documentSchema.parse(doc);
    assert.equal(parsed.kind, 'video');
    assert.ok(parsed.timeline && parsed.timeline.tracks.length > 0, `${template.id} has a timeline`);
    assert.equal(parsed.pages[0].nodes.length, parsed.timeline.tracks.length, 'every node is animated');
  }
  assert.throws(() => createMotionDocument('does-not-exist'), /Unknown motion template/);
});

test('compiled keyframes animate the node and stay within unique times', () => {
  for (const template of motionTemplates) {
    const doc = createMotionDocument(template.id);
    const node = doc.pages[0].nodes[0];
    const at0 = interpolateNode(node, doc, 0);
    const atEnd = interpolateNode(node, doc, doc.timeline!.duration);
    assert.notDeepEqual(at0, atEnd, `${template.id} should change over its timeline`);

    for (const track of doc.timeline!.tracks) {
      const times = track.keyframes.map(k => k.time);
      assert.equal(new Set(times).size, times.length, `${template.id} keyframe times are unique`);
      for (const time of times) assert.ok(time <= doc.timeline!.duration, `${template.id} keyframe within duration`);
    }
  }
});

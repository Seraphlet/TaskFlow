const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/playground/life-geometry-engine.js', 'utf8').replaceAll('export ', '');
const sandbox = { module:{exports:{}}, console, JSON, Math, Set, Map };
vm.runInNewContext(`${source}\nmodule.exports={validateLifeStory,validateLifeResult,normalizeLifeStory,parseLifeImport};`, sandbox);
const { validateLifeStory, validateLifeResult, normalizeLifeStory, parseLifeImport } = sandbox.module.exports;
const story = JSON.parse(fs.readFileSync('examples/life-v4-ensemble-story.json', 'utf8'));

assert.ok(validateLifeStory(story).valid, 'V4 ensemble story must satisfy the public import contract');
const result = normalizeLifeStory(story);
assert.ok(validateLifeResult(result).valid, 'V4 story must normalize into the one playback contract');
assert.strictEqual(result.characters.length, story.characters.length, 'normalization must not silently drop people');
assert.strictEqual(result.events.length, story.events.length, 'normalization must not silently drop independent events');
assert.strictEqual(result.relationships.length, story.relationships.length, 'normalization must not silently drop relationship history');

const byCharacter = new Map(result.characters.map((character) => [character.id, character]));
const eventsFor = (id) => result.events.filter((event) => event.characterId === id);
for (const character of result.characters) {
  assert.ok(eventsFor(character.id).length >= 2, `${character.name} must own independent timeline events`);
  for (const event of eventsFor(character.id)) {
    assert.strictEqual(event.characterAge, event.worldTime - character.birthTime, 'character age must derive from shared world time');
  }
}

// 场景一：同学毕业后拥有创业、婚姻、失业与重新开始等不同人生。
assert.ok(eventsFor('zhou-wen').some((event) => event.id === 'zhou-startup'));
assert.ok(eventsFor('han-tao').some((event) => event.id === 'han-marriage'));
assert.ok(eventsFor('su-qing').some((event) => event.id === 'su-unemployed'));
assert.ok(eventsFor('su-qing').some((event) => event.id === 'su-restart'));

// 场景二：短暂相识结束后，人物仍有后续生活与死亡数据。
const brief = result.relationships.find((relation) => relation.id === 'main-brief');
assert.deepStrictEqual(Array.from(brief.segments, (segment) => segment.status), ['meeting', 'ended']);
assert.ok(eventsFor('gu-zhou').some((event) => event.age > brief.segments[0].toAge));

// 场景三：父母、伴侣与子女都是人物对象，不是描述中的文字。
assert.ok(byCharacter.has('mother') && byCharacter.has('xu-yao') && byCharacter.has('lin-xi'));
assert.ok(result.relationships.filter((relation) => relation.type === 'parent-child').length >= 2);

// 场景四：朋友意外离世后生命线结束，其他人物继续。
assert.strictEqual(byCharacter.get('han-tao').lifeEndReason, 'death');
assert.ok(result.events.some((event) => event.age > byCharacter.get('han-tao').timelineEnd));

// 场景五：主角先离世，世界终点与其他人物时间线继续推进。
assert.strictEqual(byCharacter.get('lin-cheng').timelineEnd, 78);
assert.ok(result.endAge > 78);
assert.ok(['zhou-wen','su-qing','xu-yao','lin-xi'].every((id) => byCharacter.get(id).timelineEnd > 78));

// 场景六：失联后通过结构化关系阶段重联，而不是随机靠近。
const reunion = result.relationships.find((relation) => relation.id === 'main-zhou');
assert.deepStrictEqual(Array.from(reunion.segments, (segment) => segment.status), ['close','distant','reconnecting','close']);
assert.ok(reunion.segments.find((segment) => segment.status === 'reconnecting').eventIds.includes('zhou-reunion'));

const invalid = JSON.parse(JSON.stringify(story));
invalid.relationships.find((relation) => relation.id === 'main-zhou').segments[2].eventIds = ['missing-event'];
assert.throws(() => parseLifeImport(invalid), /引用了不存在的事件/, 'broken relationship event references must fail explicitly');

console.log('Life Geometry V4 six-scenario data contract tests passed');

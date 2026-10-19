const assert = require('assert');
const fs = require('fs');

const index = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
const music = fs.readFileSync('js/playground/music-geometry.js', 'utf8');
const keyboard = fs.readFileSync('js/playground/keyboard-art.js', 'utf8');

assert.strictEqual(index.includes('music-geometry.js'), false, 'music module must not be statically loaded');
assert.strictEqual(index.includes('keyboard-art.js'), false, 'keyboard module must not be statically loaded');
assert.match(app, /import\(modulePath\)/, 'artwork modules must use dynamic import()');
assert.match(app, /artworkLoadToken/, 'dynamic loads must be protected against stale completion');
assert.match(app, /destroyActiveArtwork\(\)/, 'render boundaries must destroy the previous artwork');

for (const [name, source] of [['music', music], ['keyboard', keyboard]]) {
  assert.match(source, /export function createArtwork\(container\)/, `${name} must export createArtwork`);
  assert.match(source, /\bstart\b/, `${name} must expose start`);
  assert.match(source, /\bpause\b/, `${name} must expose pause`);
  assert.match(source, /\bdestroy\b/, `${name} must expose destroy`);
  assert.match(source, /cancelAnimationFrame/, `${name} must cancel animation frames`);
  assert.match(source, /ResizeObserver/, `${name} must manage canvas resize`);
  assert.match(source, /visibilitychange/, `${name} must react to tab visibility`);
  assert.doesNotMatch(source, /from\s+['"]|require\(/, `${name} must not introduce runtime dependencies`);
}

assert.match(music, /new AudioContextClass\(\)/, 'AudioContext must be created lazily in the artwork module');
assert.match(music, /URL\.createObjectURL\(file\)/, 'local audio must stay in the browser');
assert.match(music, /\['wave', 'spiral', 'shuttle'\]/, 'music artwork must provide three motion families');
assert.match(keyboard, /const KEYS = \['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K'\]/, 'keyboard mapping must expose A-K effects');
assert.match(keyboard, /MAX_MARKS = 900/, 'keyboard artwork must cap visual entities');
assert.match(keyboard, /input, textarea, select/, 'keyboard artwork must ignore text inputs');

console.log('Playground lifecycle and cold-start contract tests passed');

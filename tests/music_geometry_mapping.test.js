const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/playground/music-geometry.js', 'utf8');
const analyzerStart = source.indexOf('function createFeatureAnalyzer');
assert.ok(analyzerStart > 0, 'feature analyzer boundary must exist');
const mappingSource = `${source.slice(0, analyzerStart).replaceAll('export function', 'function')}\nmodule.exports = { mapVisualState };`;
const sandbox = { module: { exports: null }, Math };
vm.runInNewContext(mappingSource, sandbox);
const { mapVisualState } = sandbox.module.exports;

function profile({ energy, onset, richness, low, mid, high, flux, centroid = 0.45, longEnergy = energy }) {
  const medium = { energy, richness, low, mid, high, flux, centroid };
  return {
    raw: medium,
    short: { ...medium, flux },
    medium,
    long: { ...medium, energy: longEnergy },
    onsetDensity: onset,
    silenceSeconds: energy < 0.02 ? 3 : 0,
  };
}

const quietPiano = mapVisualState(profile({ energy: 0.12, onset: 0.08, richness: 0.16, low: 0.08, mid: 0.14, high: 0.04, flux: 0.04 }));
const layeredBuild = mapVisualState(profile({ energy: 0.55, onset: 0.38, richness: 0.74, low: 0.5, mid: 0.58, high: 0.42, flux: 0.28, longEnergy: 0.35 }));
const strongSlow = mapVisualState(profile({ energy: 0.82, onset: 0.1, richness: 0.54, low: 0.72, mid: 0.5, high: 0.16, flux: 0.08 }));
const gentleFast = mapVisualState(profile({ energy: 0.22, onset: 0.88, richness: 0.48, low: 0.12, mid: 0.28, high: 0.45, flux: 0.62 }));
const release = mapVisualState(profile({ energy: 0.08, onset: 0.04, richness: 0.1, low: 0.04, mid: 0.08, high: 0.03, flux: 0.03, longEnergy: 0.28 }));

assert.ok(layeredBuild.layerDemand > quietPiano.layerDemand, 'sustained spectral richness must add layers');
assert.ok(strongSlow.amplitude > gentleFast.amplitude, 'strength must control amplitude independently of pace');
assert.ok(gentleFast.detailRate > strongSlow.detailRate, 'rapid light music must be detailed without becoming forceful');
assert.ok(strongSlow.amplitude > quietPiano.amplitude, 'strong music must expand more than quiet music');
assert.ok(release.layerDemand < layeredBuild.layerDemand, 'a sustained release must reduce companion demand');
assert.ok(release.travelSpeed < strongSlow.travelSpeed, 'long-term energy must give the journey visual inertia');

console.log('Music Geometry feature-to-visual mapping tests passed');

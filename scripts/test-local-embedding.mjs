import assert from 'node:assert/strict';
import {embedLocal} from '../server/local-embedding.mjs';
const input='Fictional career evidence: led a software delivery team.';
const vectors=await embedLocal([input,input]);
for(const vector of vectors){assert.equal(vector.length,384);assert.ok(vector.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...vector)-1)<0.001);}
assert.deepEqual(vectors[0],vectors[1]);
console.log('Local embedding test passed: deterministic normalized 384-dimensional vectors.');

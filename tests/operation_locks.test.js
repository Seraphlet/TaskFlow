const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { window:{} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/operation-locks.js','utf8'),context);
const { OperationLockRegistry } = context.window.TaskFlowOperationLocks;

(async()=>{
  const locks=new OperationLockRegistry();
  let release;let calls=0;
  const first=locks.start('save:record-1',()=>{calls+=1;return new Promise((resolve)=>{release=resolve;});});
  const duplicates=Array.from({length:4},()=>locks.start('save:record-1',()=>{calls+=1;}));
  const independent=locks.start('save:record-2',async()=>{calls+=1;return 'independent';});
  assert.strictEqual(first.started,true);
  duplicates.forEach((duplicate)=>{assert.strictEqual(duplicate.started,false);assert.strictEqual(duplicate.promise,first.promise,'duplicate callers share the in-flight promise without invoking another write');});
  assert.strictEqual(independent.started,true,'different operation keys remain independent');
  await Promise.resolve();
  assert.strictEqual(calls,2,'five rapid attempts invoke one write while an unrelated write proceeds');
  release('saved');
  assert.strictEqual(await first.promise,'saved');
  assert.strictEqual(await independent.promise,'independent');
  assert.strictEqual(locks.size,0,'successful operations always release their keys');

  const failed=locks.start('save:record-1',async()=>{throw new Error('write failed');});
  await assert.rejects(failed.promise,/write failed/);
  assert.strictEqual(locks.has('save:record-1'),false,'failed operations release their keys for retry');
  const retry=locks.start('save:record-1',async()=> 'retried');
  assert.strictEqual(retry.started,true);
  assert.strictEqual(await retry.promise,'retried');
  console.log('Operation lock tests passed');
})().catch((error)=>{console.error(error);process.exitCode=1;});

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class MemoryLocalStorage {
  constructor(){this.values=new Map();}
  getItem(key){return this.values.get(key)||null;}
  setItem(key,value){this.values.set(key,String(value));}
}

const context={window:{},localStorage:new MemoryLocalStorage(),crypto};
context.window.localStorage=context.localStorage;
vm.runInNewContext(fs.readFileSync('js/classifications.js','utf8'),context);
const {ClassificationStore}=context.window.TaskFlowClassifications;
const store=new ClassificationStore(context.localStorage);
let config=store.resolve([{contentType:'prompt',category:'AI Engineering'},{contentType:'custom_type',contentTypeLabel:'研究材料',categoryId:'custom_topic',categoryLabel:'灵感'}]);
assert(config.contentTypes.some((item)=>item.id==='custom_type'&&item.label==='研究材料'));
assert(config.categories.some((item)=>item.id==='custom_topic'&&item.label==='灵感'));
config=store.rename(config,'categories','custom_topic','长期灵感');
assert.strictEqual(config.categories.find((item)=>item.id==='custom_topic').label,'长期灵感','rename must preserve the stable id');
config=store.add(config,'categories','新主题');
const created=config.categories.find((item)=>item.label==='新主题');
assert(created.id.startsWith('category_'));
config=store.remove(config,'categories',created.id);
assert(!config.categories.some((item)=>item.id===created.id));
console.log('Classification tests passed');

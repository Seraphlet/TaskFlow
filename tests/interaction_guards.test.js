const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const context={window:{},Math,Number,Boolean};
vm.runInNewContext(fs.readFileSync('js/interaction-guards.js','utf8'),context);
const {createPointerActivationGuard}=context.window.TaskFlowInteractionGuards;

const target=({editor=false,action=null}={})=>({
  closest(selector){
    if(selector.includes('contenteditable'))return editor?this:null;
    if(selector.includes('button'))return action;
    return null;
  },
});

let guard=createPointerActivationGuard(7);
const textarea=target({editor:true});
const navAction={id:'nav'};
const navChild=target({action:navAction});
guard.begin({target:textarea,clientX:100,clientY:20,isPrimary:true});
guard.move({clientX:70,clientY:20,isPrimary:true});
assert.strictEqual(guard.shouldSuppress({target:navChild,detail:1}),true,'dragging from an editor onto navigation must not activate navigation');

guard=createPointerActivationGuard(7);
guard.begin({target:navChild,clientX:10,clientY:10,isPrimary:true});
assert.strictEqual(guard.shouldSuppress({target:navChild,detail:1}),false,'an intentional pointer click must still activate navigation');

guard=createPointerActivationGuard(7);
guard.begin({target:textarea,clientX:10,clientY:10,isPrimary:true});
guard.move({clientX:50,clientY:10,isPrimary:true});
assert.strictEqual(guard.shouldSuppress({target:navChild,detail:0}),false,'keyboard-generated clicks must remain available');

console.log('Interaction guard tests passed');

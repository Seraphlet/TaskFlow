const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const context={window:{},Math,Number,Boolean};
vm.runInNewContext(fs.readFileSync('js/interaction-guards.js','utf8'),context);
const {createPointerActivationGuard}=context.window.TaskFlowInteractionGuards;

const target=({editor=false,action=null,backdrop=false}={})=>({
  classList:{contains(name){return backdrop&&name==='drawer-backdrop';}},
  closest(selector){
    if(selector.includes('contenteditable'))return editor?this:null;
    if(selector.includes('.drawer-backdrop')&&backdrop)return this;
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
guard.end({target:navChild,clientX:70,clientY:20,isPrimary:true});
assert.strictEqual(guard.shouldSuppress({target:navChild,detail:1}),true,'dragging from an editor onto navigation must not activate navigation');

guard=createPointerActivationGuard(7);
guard.begin({target:navChild,clientX:10,clientY:10,isPrimary:true});
guard.end({target:navChild,clientX:10,clientY:10,isPrimary:true});
assert.strictEqual(guard.shouldSuppress({target:navChild,detail:1}),false,'an intentional pointer click must still activate navigation');

guard=createPointerActivationGuard(7);
guard.begin({target:textarea,clientX:10,clientY:10,isPrimary:true});
guard.move({clientX:50,clientY:10,isPrimary:true});
assert.strictEqual(guard.shouldSuppress({target:navChild,detail:0}),false,'keyboard-generated clicks must remain available');

const backdrop=target({backdrop:true});
guard=createPointerActivationGuard(7);
guard.begin({target:textarea,clientX:100,clientY:20,isPrimary:true});
guard.end({target:backdrop,clientX:101,clientY:20,isPrimary:true});
assert.strictEqual(guard.shouldSuppress({target:backdrop,detail:1}),true,'releasing an editor selection on the backdrop must not close the drawer, even below the drag threshold');

guard=createPointerActivationGuard(7);
guard.begin({target:backdrop,clientX:10,clientY:10,isPrimary:true});
guard.end({target:backdrop,clientX:10,clientY:10,isPrimary:true});
assert.strictEqual(guard.shouldSuppress({target:backdrop,detail:1}),false,'a complete pointer activation on the backdrop must remain available');

guard=createPointerActivationGuard(7);
guard.begin({target:backdrop,clientX:10,clientY:10,isPrimary:true});
guard.end({target:textarea,clientX:20,clientY:10,isPrimary:true});
assert.strictEqual(guard.shouldSuppress({target:backdrop,detail:1}),true,'a backdrop activation is invalid unless both pointer endpoints are on the backdrop');

console.log('Interaction guard tests passed');

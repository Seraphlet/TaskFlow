(() => {
  const ACTIVATION_SELECTOR = 'button,a[href],[role="button"],.drawer-backdrop';
  const EDITOR_SELECTOR = 'input,textarea,[contenteditable="true"]';

  function createPointerActivationGuard(threshold = 7) {
    let gesture = null;
    return {
      begin(event) {
        if (event.isPrimary === false) return;
        gesture = {
          x:Number(event.clientX || 0),
          y:Number(event.clientY || 0),
          moved:false,
          fromEditor:Boolean(event.target?.closest?.(EDITOR_SELECTOR)),
          startAction:event.target?.closest?.(ACTIVATION_SELECTOR) || null,
        };
      },
      move(event) {
        if (!gesture || event.isPrimary === false) return;
        const dx=Number(event.clientX || 0)-gesture.x;
        const dy=Number(event.clientY || 0)-gesture.y;
        if (Math.hypot(dx,dy) >= threshold) gesture.moved=true;
      },
      cancel() { gesture=null; },
      shouldSuppress(event) {
        if (!gesture || event.detail === 0) { gesture=null; return false; }
        const endAction=event.target?.closest?.(ACTIVATION_SELECTOR) || null;
        const suppress=Boolean(gesture.fromEditor && gesture.moved && endAction && endAction !== gesture.startAction);
        gesture=null;
        return suppress;
      },
    };
  }

  window.TaskFlowInteractionGuards = { ACTIVATION_SELECTOR, EDITOR_SELECTOR, createPointerActivationGuard };
})();

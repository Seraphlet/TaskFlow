const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,Number(value)||0));
const lerp=(from,to,amount)=>from+(to-from)*amount;
const HIDDEN=Object.freeze({closeness:0,visibility:.035});
const STATUS_METRICS=Object.freeze({
  meeting:{closeness:.52,visibility:.9},
  close:{closeness:.82,visibility:1},
  distant:{closeness:.04,visibility:.16},
  reconnecting:{closeness:.64,visibility:.86},
  ended:{closeness:0,visibility:.035},
});

function metrics(status){return STATUS_METRICS[status]||HIDDEN;}
function mixMetrics(from,to,amount){return{closeness:lerp(from.closeness,to.closeness,amount),visibility:lerp(from.visibility,to.visibility,amount)};}

export function relationshipMetricsAt(relation,time,transitionWindow=1.8){
  const segments=relation?.segments||[];
  if(!segments.length)return{...HIDDEN,status:'none'};
  const half=Math.max(.1,transitionWindow)/2;
  for(let index=0;index<segments.length;index+=1){
    const segment=segments[index],start=Number(segment.fromAge),end=Number(segment.toAge),previous=index?segments[index-1]:null,next=segments[index+1];
    if(time>=start-half&&time<start+half){const from=previous&&Number(previous.toAge)>=start-half?metrics(previous.status):HIDDEN,to=metrics(segment.status),mixed=mixMetrics(from,to,clamp((time-(start-half))/(half*2)));return{...mixed,status:segment.status};}
    if(time>=start+half&&time<=end-half)return{...metrics(segment.status),status:segment.status};
    if(time>end-half&&time<=end+half){const to=next&&Number(next.fromAge)<=end+half?metrics(next.status):HIDDEN,mixed=mixMetrics(metrics(segment.status),to,clamp((time-(end-half))/(half*2)));return{...mixed,status:to===HIDDEN?'none':next.status};}
  }
  return{...HIDDEN,status:'none'};
}

export function ensembleFrame({characters,relationships,primaryId,time,baseLanes,baseOffsets}){
  const ids=characters.map((character)=>character.id),indexById=new Map(ids.map((id,index)=>[id,index]));
  const visibility=characters.map((character)=>character.id===primaryId?1:.035),lanes=[...baseLanes],offsets=[...baseOffsets];
  const active=[];
  for(const relation of relationships||[]){const from=indexById.get(relation.fromId),to=indexById.get(relation.toId);if(from==null||to==null)continue;const state=relationshipMetricsAt(relation,time);active.push({from,to,...state});if(ids[from]===primaryId)visibility[to]=Math.max(visibility[to],state.visibility);if(ids[to]===primaryId)visibility[from]=Math.max(visibility[from],state.visibility);}
  for(let pass=0;pass<2;pass+=1)for(const relation of active){const strength=relation.visibility*.72;visibility[relation.from]=Math.max(visibility[relation.from],visibility[relation.to]*strength);visibility[relation.to]=Math.max(visibility[relation.to],visibility[relation.from]*strength);}
  const primary=characters[indexById.get(primaryId)];
  if(primary&&time>Number(primary.timelineEnd)){for(let index=0;index<characters.length;index+=1){const character=characters[index];if(character.id!==primaryId&&time>=Number(character.timelineStart||0)&&time<=Number(character.timelineEnd||0))visibility[index]=Math.max(visibility[index],.44);}}
  for(let pass=0;pass<2;pass+=1){const nextLanes=[...lanes],nextOffsets=[...offsets];for(const relation of active){if(relation.closeness<=.01)continue;const a=relation.from,b=relation.to,gap=(a%2?-1:1)*.055,weight=relation.closeness*(pass?.24:.42);if(ids[a]!==primaryId){nextLanes[a]=lerp(nextLanes[a],lanes[b]+gap,weight);nextOffsets[a]=lerp(nextOffsets[a],offsets[b],weight*.24);}if(ids[b]!==primaryId){nextLanes[b]=lerp(nextLanes[b],lanes[a]-gap,weight);nextOffsets[b]=lerp(nextOffsets[b],offsets[a],weight*.24);}}for(let index=0;index<lanes.length;index+=1){lanes[index]=nextLanes[index];offsets[index]=nextOffsets[index];}}
  return characters.map((character,index)=>({id:character.id,lane:lanes[index],offset:offsets[index],visibility:clamp(visibility[index])}));
}

export function visibleTrackIds(frame,characters,time,limit=8){
  const byId=new Map(frame.map((item)=>[item.id,item]));
  return characters.filter((character)=>time>=Number(character.timelineStart||0)&&time<=Number(character.timelineEnd||0)).sort((a,b)=>{if(a.role==='primary')return-1;if(b.role==='primary')return 1;return(byId.get(b.id)?.visibility||0)-(byId.get(a.id)?.visibility||0);}).slice(0,Math.max(1,limit)).map((character)=>character.id);
}

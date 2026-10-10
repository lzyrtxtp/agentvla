const videos=[...document.querySelectorAll('video')];
// Load a complete local media Blob before playback. Native seeking then does
// not depend on HTTP Range support in the hosting/authentication layer.
const mediaCache=new Map();
const playerStates=new WeakMap();
function timeLabel(seconds){
  const value=Number.isFinite(seconds)?Math.max(0,Math.floor(seconds)):0;
  return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
}
function addSubtaskProgress(video,bar){
  const track=window.taskProgress?.[video.dataset.progress];
  if(!track?.steps.length)return;
  const panel=document.createElement('div');panel.className='subtask-progress';
  const heading=document.createElement('div');heading.className='progress-heading';
  const title=document.createElement('span');title.textContent=video.hasAttribute('data-comparison')?'Subtask progress':'Recorded milestones';
  const count=document.createElement('span');heading.append(title,count);
  const list=document.createElement('ol');list.className='milestone-list';
  list.style.setProperty('--steps',track.steps.length);
  list.setAttribute('aria-label','Reviewed subtask milestones');
  const cells=track.steps.map((step,index)=>{
    const item=document.createElement('li');item.className='milestone';
    const symbol=document.createElement('span');symbol.className='milestone-symbol';
    const label=document.createElement('span');label.className='milestone-label';label.textContent=step.label;
    item.append(symbol,label);list.append(item);return {item,symbol,step,index};
  });
  panel.append(heading,list);bar.after(panel);
  const update=()=>{
    const end=Number.isFinite(video.duration)&&(video.ended||video.currentTime>=video.duration-.015);
    let complete=0;
    cells.forEach(({item,symbol,step,index})=>{
      const done=(step.at!==null&&video.currentTime>=step.at)||(end&&step.endState==='completed');
      const missed=!done&&end&&step.endState==='incomplete';
      const unannotated=track.partial&&step.at===null&&step.endState!=='incomplete';
      const state=done?'done':missed?'incomplete':'pending';
      item.dataset.state=state;symbol.textContent=done?'✓':missed?'×':unannotated?'—':String(index+1);
      item.setAttribute('aria-label',`${step.label}: ${done?'completed':missed?'not completed at end':unannotated?'not annotated':'not yet confirmed'}`);
      if(done)complete++;
    });
    count.textContent=track.partial?(end?"Insertion incomplete":"Partial annotation"):`${complete} / ${track.steps.length} completed`;
  };
  ['loadedmetadata','timeupdate','seeked','ended','emptied'].forEach(event=>video.addEventListener(event,update));
  update();
}
function addTimeline(video,holder,state){
  const bar=document.createElement('div');bar.className='video-timeline';
  const play=document.createElement('button');play.type='button';play.textContent='Play';
  const label=video.getAttribute('aria-label')||'video';
  const range=document.createElement('input');range.type='range';range.min='0';range.max='100';range.step='0.01';range.value='0';range.disabled=true;range.setAttribute('aria-label',`Seek ${label}`);
  const time=document.createElement('span');time.className='video-time';time.textContent='0:00 / --:--';
  bar.append(play,range,time);holder.after(bar);
  addSubtaskProgress(video,bar);
  if(video.hasAttribute('data-comparison')){
    const expand=document.createElement('button');expand.type='button';expand.className='video-expand';expand.textContent='⛶';expand.setAttribute('aria-label',`Full screen ${label}`);
    expand.addEventListener('click',async()=>{
      const card=video.closest('.comparison-card');
      if(document.fullscreenElement||document.webkitFullscreenElement||card.matches(':fullscreen')){
        if(document.exitFullscreen)await document.exitFullscreen();
        else if(document.webkitExitFullscreen)document.webkitExitFullscreen();
        return;
      }
      if(card.requestFullscreen){try{await card.requestFullscreen();}catch{state.message.textContent='Full screen is unavailable in this browser.';}}
      else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();
    });bar.append(expand);
  }
  let dragging=false,resume=false;
  const update=()=>{
    if(Number.isFinite(video.duration)){
      range.max=String(video.duration);range.disabled=!state.ready;
      if(!dragging)range.value=String(video.currentTime);
      time.textContent=`${timeLabel(Number(range.value))} / ${timeLabel(video.duration)}`;
      range.setAttribute('aria-valuetext',time.textContent);
      range.style.setProperty('--progress',`${Number(range.value)/video.duration*100}%`);
    }
    play.textContent=state.loading?'Loading…':video.paused?'Play':'Pause';
    play.disabled=state.loading;play.setAttribute('aria-label',`${video.paused?'Play':'Pause'} ${label}`);
  };
  play.addEventListener('click',()=>video.paused?playVideo(video):video.pause());
  range.addEventListener('pointerdown',()=>{dragging=true;resume=!video.paused;video.pause();});
  range.addEventListener('input',()=>{if(state.ready){video.currentTime=Number(range.value);update();}});
  const finish=()=>{
    if(!dragging)return;
    dragging=false;
    if(resume){resume=false;video.play().catch(()=>{});}
    update();
  };
  window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
  range.addEventListener('change',finish);range.addEventListener('blur',finish);
  ['loadedmetadata','durationchange','timeupdate','seeked','play','pause','ended'].forEach(event=>video.addEventListener(event,update));
  state.update=update;
  update();
}
async function mediaBlob(url,onProgress){
  if(mediaCache.has(url))return mediaCache.get(url);
  const request=(async()=>{
    const response=await fetch(url,{credentials:'same-origin'});
    if(!response.ok)throw new Error('Video could not be loaded. Please try again.');
    const type=response.headers.get('Content-Type')||'';
    if(type.includes('text/html'))throw new Error('Please sign in to view this private video.');
    const total=Number(response.headers.get('Content-Length'));
    const chunks=[];let received=0;
    if(response.body){
      const reader=response.body.getReader();
      while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.length;onProgress(total?Math.min(99,Math.floor(received/total*100)):null);}
    }else{chunks.push(await response.arrayBuffer());}
    return URL.createObjectURL(new Blob(chunks,{type:'video/mp4'}));
  })();
  mediaCache.set(url,request);
  try{return await request;}catch(error){mediaCache.delete(url);throw error;}
}
async function prepareVideo(video,state){
  if(state.ready)return;
  state.loading=true;state.update();state.button.disabled=true;state.button.textContent='Loading video…';state.message.textContent='Loading the video for smooth seeking.';
  try{
    const url=await mediaBlob(state.source,pct=>{state.button.textContent=pct===null?'Loading video…':`Loading ${pct}%`;});
    const metadata=new Promise((resolve,reject)=>{
      video.addEventListener('loadedmetadata',resolve,{once:true});
      video.addEventListener('error',()=>reject(new Error('This browser could not read the video.')),{once:true});
    });
    video.src=url;video.preload='auto';video.load();await metadata;
    state.ready=true;video.controls=!video.hasAttribute('data-comparison');state.message.textContent='';
    state.button.hidden=true;
  }finally{state.loading=false;state.button.disabled=false;state.update();}
}
async function playVideo(video){
  const state=playerStates.get(video);if(state.loading)return;
  try{
    await prepareVideo(video,state);
    // A user may scroll away during download; do not start offscreen playback.
    const rect=video.getBoundingClientRect();
    if(rect.bottom>0&&rect.top<innerHeight)await video.play();
  }catch(error){state.button.hidden=false;state.button.textContent='Retry video';state.message.textContent=error instanceof TypeError?'Video could not load. Reconnect and retry.':error.message;}
}
videos.forEach(video=>{
  let holder=video.parentElement;
  if(video.matches('.overview-video')){const wrapper=document.createElement('div');wrapper.className='video-player overview-player';video.before(wrapper);wrapper.append(video);holder=wrapper;}
  holder.classList.add('video-player');
  const message=document.createElement('span');message.className='video-load-status';message.setAttribute('role','status');holder.append(message);
  const button=document.createElement('button');
  button.className='video-start';button.textContent='Play video';button.setAttribute('aria-label','Play '+video.getAttribute('aria-label'));holder.append(button);
  const source=video.querySelector('source');
  const state={source:source?.src||video.src,button,message,ready:false,loading:false};
  playerStates.set(video,state);addTimeline(video,holder,state);
  // Avoid a second, non-seekable native request before the user starts playback.
  video.controls=false;video.preload='none';
  button.addEventListener('click',()=>video.paused?playVideo(video):video.pause());
  video.addEventListener('play',()=>videos.forEach(other=>{
    // Comparison panels are independent and may play side by side.
    if(other!==video&&!(video.hasAttribute('data-comparison')&&other.hasAttribute('data-comparison')))other.pause();
  }));
});
const observer=new IntersectionObserver(entries=>entries.forEach(({target,isIntersecting})=>{if(!isIntersecting)target.pause()}),{threshold:0.05});videos.forEach(v=>observer.observe(v));
// Task tabs switch independent players without replacing or recompressing media.
const demoTabs=[...document.querySelectorAll('.demo-tabs [role="tab"]')];
function selectDemoTab(tab,focus=false){
  demoTabs.forEach(button=>{
    const active=button===tab;
    button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    panel.hidden=!active;
    if(!active)panel.querySelectorAll('video').forEach(video=>video.pause());
  });
  if(focus)tab.focus();
}
demoTabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>selectDemoTab(tab));
  tab.addEventListener('keydown',event=>{
    let next;
    if(event.key==='ArrowRight')next=(index+1)%demoTabs.length;
    if(event.key==='ArrowLeft')next=(index-1+demoTabs.length)%demoTabs.length;
    if(event.key==='Home')next=0;
    if(event.key==='End')next=demoTabs.length-1;
    if(next!==undefined){event.preventDefault();selectDemoTab(demoTabs[next],true);}
  });
});
const results={pi:[35.1,42.0,50.5],xvla:[32.3,36.8,44.8]};
document.querySelectorAll('[data-executor]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-executor]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));results[button.dataset.executor].forEach((value,i)=>{const key=['base','planner','full'][i];document.getElementById('bar-'+key).style.width=(value/60*100)+'%';document.getElementById('value-'+key).textContent=value.toFixed(1)+'%'})}));
const dialog=document.getElementById('figure-dialog');let figureTrigger;
document.querySelectorAll('[data-figure]').forEach(button=>button.addEventListener('click',()=>{figureTrigger=button;const im=document.getElementById('enlarged-figure');im.src=button.dataset.figure;im.alt=button.querySelector('img').alt;document.getElementById('figure-caption').textContent=button.dataset.caption;dialog.showModal();document.body.style.overflow='hidden'}));
document.getElementById('close-figure').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});dialog.addEventListener('close',()=>{document.body.style.overflow='';figureTrigger?.focus()});

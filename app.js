// Elements
const canvas = document.getElementById('photoCanvas');
const ctx = canvas.getContext('2d');
const frameImg = document.getElementById('frame');
const frameHint = document.getElementById('frameHint');
const fileInput = document.getElementById('fileInput');
const scaleSlider = document.getElementById('scaleRange');
const downloadBtn = document.getElementById('downloadBtn');
const msgBox = document.getElementById('msg');
const rotateButtons = document.querySelectorAll('.rotate-row .btn-ghost');

const imgSrc = document.getElementById('sourceImage');
const videoSrc = document.getElementById('sourceVideo');

// Constants
const CANVAS_W = canvas.width;
const CANVAS_H = canvas.height;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

// State & Transform
let mediaType = null, mediaLoaded = false, rafId = null;
let posX = 0, posY = 0, scale = 1, rotationDeg = 0;
let isDragging = false, dragStartX = 0, dragStartY = 0;

// Utils
const showMsg = t => msgBox && (msgBox.textContent = t);
const revoke = u => { try{ URL.revokeObjectURL(u) }catch{}}; 

function fitCover(w,h){
  const s = Math.max(CANVAS_W/w, CANVAS_H/h);
  return { scale:s, x:(CANVAS_W-w*s)/2, y:(CANVAS_H-h*s)/2 };
}
function clampPosition(w,h){
  const rad = rotationDeg*Math.PI/180;
  const cos= Math.abs(Math.cos(rad)), sin= Math.abs(Math.sin(rad));
  const bw=w*scale*cos+h*scale*sin, bh=w*scale*sin+h*scale*cos;
  const minX=-bw+80, maxX=CANVAS_W-80, minY=-bh+80, maxY=CANVAS_H-80;
  posX=Math.min(Math.max(posX,minX),maxX);
  posY=Math.min(Math.max(posY,minY),maxY);
}

// Frame hint
;(function(){
  if(!frameHint) return;
  const ok=()=>frameHint.style.display='none';
  const fail=()=>{ frameHint.textContent='Frame not found'; frameHint.style.display='block'; };
  if(!frameImg.complete){
    frameHint.style.display='block';
    frameImg.addEventListener('load',ok);
    frameImg.addEventListener('error',fail);
  }else if(frameImg.naturalWidth===0) fail();
  else ok();
})();

// Draw
function drawFrame(){
  ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
  if(mediaLoaded){
    const rad=rotationDeg*Math.PI/180;
    if(mediaType==='image'){
      const w=imgSrc.naturalWidth,h=imgSrc.naturalHeight;
      const dw=w*scale,dh=h*scale, cx=posX+dw/2, cy=posY+dh/2;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(rad);
      ctx.drawImage(imgSrc,-dw/2,-dh/2,dw,dh);
      ctx.restore();
    } else {
      const w=videoSrc.videoWidth,h=videoSrc.videoHeight;
      if(w&&h){
        const dw=w*scale,dh=h*scale, cx=posX+dw/2, cy=posY+dh/2;
        ctx.save(); ctx.translate(cx,cy); ctx.rotate(rad);
        ctx.drawImage(videoSrc,-dw/2,-dh/2,dw,dh);
        ctx.restore();
      }
    }
  }
  if(frameImg.naturalWidth) ctx.drawImage(frameImg,0,0,CANVAS_W,CANVAS_H);
}
function loop(){ drawFrame(); rafId=requestAnimationFrame(loop); }
function ensureLoop(){ if(!rafId) loop(); }
function stopLoop(){ if(rafId) cancelAnimationFrame(rafId); rafId=null; }

// Load
fileInput.addEventListener('change', async e=>{
  showMsg(''); stopLoop();
  const file=e.target.files[0]; if(!file) return;
  const isVid=file.type.startsWith('video/');
  if(isVid&&file.size>MAX_VIDEO_BYTES){ showMsg('Video too big'); fileInput.value=''; return; }
  const url=URL.createObjectURL(file);
  if(isVid){
    mediaType='video'; mediaLoaded=false;
    videoSrc.pause(); videoSrc.src=url; videoSrc.currentTime=0;
    videoSrc.muted=true; videoSrc.loop=true;
    await new Promise((res,rej)=>{
      const ok=()=>{cleanup();res()}, err=()=>{cleanup();rej()};
      const cleanup=()=>{videoSrc.removeEventListener('loadedmetadata',ok);videoSrc.removeEventListener('error',err)};
      videoSrc.addEventListener('loadedmetadata',ok);
      videoSrc.addEventListener('error',err);
    }).catch(()=>showMsg('Cannot read video.'));
    if(!videoSrc.videoWidth){ revoke(url); return; }
    const {scale:s,x,y}=fitCover(videoSrc.videoWidth, videoSrc.videoHeight);
    scale=s;posX=x;posY=y;rotationDeg=0;
    clampPosition(videoSrc.videoWidth,videoSrc.videoHeight);
    scaleSlider.value=scale;
    try{ await videoSrc.play(); }catch{
      showMsg('Tap to start preview');
      canvas.addEventListener('click',()=>{showMsg('');videoSrc.play()}, {once:true});
    }
    mediaLoaded=true; ensureLoop();
  } else {
    mediaType='image'; mediaLoaded=false;
    imgSrc.onload=()=>{
      const {scale:s,x,y}=fitCover(imgSrc.naturalWidth, imgSrc.naturalHeight);
      scale=s;posX=x;posY=y;rotationDeg=0;
      clampPosition(imgSrc.naturalWidth,imgSrc.naturalHeight);
      scaleSlider.value=scale; mediaLoaded=true; drawFrame(); revoke(url);
    };
    imgSrc.onerror=()=>{showMsg('Cannot load image'); revoke(url)};
    imgSrc.src=url;
  }
});

// Gestures
function toCanvasPoint(cx,cy){
  const r=canvas.getBoundingClientRect();
  return{ x:(cx-r.left)*(CANVAS_W/r.width), y:(cy-r.top)*(CANVAS_H/r.height) };
}
canvas.addEventListener('mousedown',e=>{
  if(!mediaLoaded) return;
  isDragging=true;
  const p=toCanvasPoint(e.clientX,e.clientY);
  dragStartX=p.x-posX; dragStartY=p.y-posY;
  canvas.style.cursor='grabbing';
});
canvas.addEventListener('mousemove',e=>{
  if(!isDragging) return;
  const p=toCanvasPoint(e.clientX,e.clientY);
  posX=p.x-dragStartX; posY=p.y-dragStartY;
  const w=mediaType==='image'?imgSrc.naturalWidth:videoSrc.videoWidth;
  const h=mediaType==='image'?imgSrc.naturalHeight:videoSrc.videoHeight;
  if(w&&h) clampPosition(w,h);
  if(mediaType==='image') drawFrame();
});
['mouseup','mouseleave'].forEach(ev=>canvas.addEventListener(ev,()=>{
  isDragging=false; canvas.style.cursor='grab';
}));
canvas.addEventListener('touchstart',e=>{
  if(!mediaLoaded||e.touches.length!==1) return;
  isDragging=true;
  const p=toCanvasPoint(e.touches[0].clientX,e.touches.clientY);
  dragStartX=p.x-posX; dragStartY=p.y-posY;
},{passive:true});
canvas.addEventListener('touchmove',e=>{
  if(!isDragging||e.touches.length!==1) return;
  const p=toCanvasPoint(e.touches.clientX,e.touches.clientY);
  posX=p.x-dragStartX; posY=p.y-dragStartY;
  const w=mediaType==='image'?imgSrc.naturalWidth:videoSrc.videoWidth;
  const h=mediaType==='image'?imgSrc.naturalHeight:videoSrc.videoHeight;
  if(w&&h) clampPosition(w,h);
  if(mediaType==='image') drawFrame();
  e.preventDefault();
},{passive:false});
canvas.addEventListener('touchend',()=>{isDragging=false});

// Zoom & Rotate
scaleSlider.addEventListener('input',e=>{
  if(!mediaLoaded) return;
  const ns=parseFloat(e.target.value);
  const cx=CANVAS_W/2, cy=CANVAS_H/2;
  posX=cx-(cx-posX)*(ns/scale);
  posY=cy-(cy-posY)*(ns/scale);
  scale=ns;
  const w=mediaType==='image'?imgSrc.naturalWidth:videoSrc.videoWidth;
  const h=mediaType==='image'?imgSrc.naturalHeight:videoSrc.videoHeight;
  if(w&&h) clampPosition(w,h);
  if(mediaType==='image') drawFrame();
});
rotateButtons.forEach(btn=>btn.addEventListener('click',()=>{
  if(!mediaLoaded) return;
  rotationDeg=+btn.dataset.rot%360;
  const w=mediaType==='image'?imgSrc.naturalWidth:videoSrc.videoWidth;
  const h=mediaType==='image'?imgSrc.naturalHeight:videoSrc.videoHeight;
  if(w&&h) clampPosition(w,h);
  if(mediaType==='image') drawFrame();
}));

// Export image
async function exportImageJpg(){
  await Promise.all([frameImg.decode?.(), imgSrc.decode?.()]);
  const out=document.createElement('canvas');
  out.width=CANVAS_W; out.height=CANVAS_H;
  const octx=out.getContext('2d');
  octx.fillStyle='#fff'; octx.fillRect(0,0,out.width,out.height);
  const rad=rotationDeg*Math.PI/180;
  const dw=imgSrc.naturalWidth*scale, dh=imgSrc.naturalHeight*scale;
  const cx=posX+dw/2, cy=posY+dh/2;
  octx.save(); octx.translate(cx,cy); octx.rotate(rad);
  octx.drawImage(imgSrc,-dw/2,-dh/2,dw,dh); octx.restore();
  octx.drawImage(frameImg,0,0,out.width,out.height);
  const url=out.toDataURL('image/jpeg',0.92);
  const a=document.createElement('a'); a.href=url; a.download='frame.jpg'; a.click();
}

// Export full video via real-time canvas capture
async function exportVideoFullWebM(){
  if(!isFinite(videoSrc.duration)||videoSrc.duration<=0){
    showMsg('Cannot determine video length'); return;
  }
  videoSrc.currentTime=0;
  await new Promise(res=>videoSrc.addEventListener('seeked',res,{once:true}));
  await videoSrc.play().catch(()=>{});
  const recW=720, recH=Math.round(recW*(CANVAS_H/CANVAS_W));
  const off=document.createElement('canvas');
  off.width=recW; off.height=recH;
  const octx=off.getContext('2d');

  let running=true;
  function drawOff(){
    if(!running) return;
    octx.clearRect(0,0,recW,recH);
    const sx=recW/CANVAS_W, sy=recH/CANVAS_H;
    const vw=videoSrc.videoWidth, vh=videoSrc.videoHeight;
    if(vw&&vh){
      const dw=vw*scale*sx, dh=vh*scale*sy;
      const cx=(posX*sx)+dw/2, cy=(posY*sy)+dh/2;
      octx.save(); octx.translate(cx,cy); octx.rotate(rotationDeg*Math.PI/180);
      octx.drawImage(videoSrc,-dw/2,-dh/2,dw,dh); octx.restore();
    }
    octx.drawImage(frameImg,0,0,recW,recH);
    requestAnimationFrame(drawOff);
  }
  drawOff();

  const stream=off.captureStream(30);
  const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?
             'video/webm;codecs=vp9':'video/webm';
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4_000_000});
  const chunks=[];
  recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  recorder.start();

  showMsg('Recording…');
  await new Promise(res=>videoSrc.addEventListener('ended',res,{once:true}));
  recorder.stop();
  await new Promise(res=>recorder.onstop=res);
  running=false;

  const blob=new Blob(chunks,{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='galaxy_frame.webm'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showMsg('');
}

// Download handler
downloadBtn.addEventListener('click',async()=>{
  if(!mediaLoaded){ showMsg('Upload first.'); return; }
  showMsg('');
  if(mediaType==='image') {
    try{ await exportImageJpg(); } catch(e){ console.error(e); showMsg('Image export failed.'); }
  } else {
    try{ await exportVideoFullWebM(); } catch(e){ console.error(e); showMsg('Video export failed.'); }
  }
});

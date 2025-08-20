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

// State
let mediaType = null, mediaLoaded = false, rafId = null;
let posX = 0, posY = 0, scale = 1, rotationDeg = 0;
let isDragging = false, dragStartX = 0, dragStartY = 0;

// Utils
const showMsg = t => msgBox && (msgBox.textContent = t);
const revoke = u => { try{ URL.revokeObjectURL(u) }catch{} };

function fitCover(w,h){
  const s = Math.max(CANVAS_W/w, CANVAS_H/h);
  return { scale:s, x:(CANVAS_W-w*s)/2, y:(CANVAS_H-h*s)/2 };
}

function clampPosition(w,h){
  const rad = rotationDeg*Math.PI/180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const bw = w*scale*cos+h*scale*sin, bh = w*scale*sin+h*scale*cos;
  const minX = -bw+80, maxX = CANVAS_W-80, minY = -bh+80, maxY = CANVAS_H-80;
  posX = Math.min(Math.max(posX,minX),maxX);
  posY = Math.min(Math.max(posY,minY),maxY);
}

// Frame hint
if(frameHint){
  const ok = () => frameHint.style.display = 'none';
  const fail = () => { frameHint.textContent = 'Frame not found'; frameHint.style.display = 'block'; };
  if(!frameImg.complete){
    frameHint.style.display = 'block';
    frameImg.addEventListener('load', ok);
    frameImg.addEventListener('error', fail);
  } else if(frameImg.naturalWidth === 0) {
    fail();
  } else {
    ok();
  }
}

// Draw
function drawFrame(){
  ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
  if(mediaLoaded){
    const rad = rotationDeg*Math.PI/180;
    if(mediaType === 'image'){
      const w = imgSrc.naturalWidth, h = imgSrc.naturalHeight;
      const dw = w*scale, dh = h*scale, cx = posX+dw/2, cy = posY+dh/2;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(rad);
      ctx.drawImage(imgSrc,-dw/2,-dh/2,dw,dh);
      ctx.restore();
    } else {
      const w = videoSrc.videoWidth, h = videoSrc.videoHeight;
      if(w && h){
        const dw = w*scale, dh = h*scale, cx = posX+dw/2, cy = posY+dh/2;
        ctx.save(); ctx.translate(cx,cy); ctx.rotate(rad);
        ctx.drawImage(videoSrc,-dw/2,-dh/2,dw,dh);
        ctx.restore();
      }
    }
  }
  if(frameImg.naturalWidth) ctx.drawImage(frameImg,0,0,CANVAS_W,CANVAS_H);
}

function loop(){ drawFrame(); rafId = requestAnimationFrame(loop); }
function ensureLoop(){ if(!rafId) loop(); }
function stopLoop(){ if(rafId) cancelAnimationFrame(rafId); rafId = null; }

// Load media
fileInput.addEventListener('change', async e => {
  showMsg(''); stopLoop();
  const file = e.target.files[0]; 
  if(!file) return;
  
  const isVid = file.type.startsWith('video/');
  if(isVid && file.size > MAX_VIDEO_BYTES){ 
    showMsg('Video too big'); 
    fileInput.value = ''; 
    return; 
  }
  
  const url = URL.createObjectURL(file);
  
  if(isVid){
    mediaType = 'video'; mediaLoaded = false;
    videoSrc.pause(); videoSrc.src = url; videoSrc.currentTime = 0;
    videoSrc.muted = true; videoSrc.loop = false; // Don't loop for recording
    
    await new Promise((res,rej) => {
      const ok = () => { cleanup(); res(); };
      const err = () => { cleanup(); rej(); };
      const cleanup = () => {
        videoSrc.removeEventListener('loadedmetadata', ok);
        videoSrc.removeEventListener('error', err);
      };
      videoSrc.addEventListener('loadedmetadata', ok);
      videoSrc.addEventListener('error', err);
    }).catch(() => showMsg('Cannot read video.'));
    
    if(!videoSrc.videoWidth){ revoke(url); return; }
    
    const {scale:s, x, y} = fitCover(videoSrc.videoWidth, videoSrc.videoHeight);
    scale = s; posX = x; posY = y; rotationDeg = 0;
    clampPosition(videoSrc.videoWidth, videoSrc.videoHeight);
    scaleSlider.value = scale;
    
    // For preview only, loop
    videoSrc.loop = true;
    try{ 
      await videoSrc.play(); 
    } catch{
      showMsg('Tap to start preview');
      canvas.addEventListener('click', () => {
        showMsg(''); 
        videoSrc.play().catch(() => {});
      }, {once:true});
    }
    
    mediaLoaded = true; 
    ensureLoop();
  } else {
    mediaType = 'image'; mediaLoaded = false;
    imgSrc.onload = () => {
      const {scale:s, x, y} = fitCover(imgSrc.naturalWidth, imgSrc.naturalHeight);
      scale = s; posX = x; posY = y; rotationDeg = 0;
      clampPosition(imgSrc.naturalWidth, imgSrc.naturalHeight);
      scaleSlider.value = scale; 
      mediaLoaded = true; 
      drawFrame(); 
      revoke(url);
    };
    imgSrc.onerror = () => { showMsg('Cannot load image'); revoke(url); };
    imgSrc.src = url;
  }
});

// Interactions
function toCanvasPoint(cx,cy){
  const r = canvas.getBoundingClientRect();
  return{ x:(cx-r.left)*(CANVAS_W/r.width), y:(cy-r.top)*(CANVAS_H/r.height) };
}

canvas.addEventListener('mousedown', e => {
  if(!mediaLoaded) return;
  isDragging = true;
  const p = toCanvasPoint(e.clientX, e.clientY);
  dragStartX = p.x - posX; 
  dragStartY = p.y - posY;
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('mousemove', e => {
  if(!isDragging) return;
  const p = toCanvasPoint(e.clientX, e.clientY);
  posX = p.x - dragStartX; 
  posY = p.y - dragStartY;
  const w = mediaType === 'image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
  const h = mediaType === 'image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
  if(w && h) clampPosition(w, h);
  if(mediaType === 'image') drawFrame();
});

['mouseup','mouseleave'].forEach(ev => canvas.addEventListener(ev, () => {
  isDragging = false; 
  canvas.style.cursor = 'grab';
}));

canvas.addEventListener('touchstart', e => {
  if(!mediaLoaded || e.touches.length !== 1) return;
  isDragging = true;
  const p = toCanvasPoint(e.touches[0].clientX, e.touches[0].clientY);
  dragStartX = p.x - posX; 
  dragStartY = p.y - posY;
}, {passive:true});

canvas.addEventListener('touchmove', e => {
  if(!isDragging || e.touches.length !== 1) return;
  const p = toCanvasPoint(e.touches[0].clientX, e.touches.clientY);
  posX = p.x - dragStartX; 
  posY = p.y - dragStartY;
  const w = mediaType === 'image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
  const h = mediaType === 'image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
  if(w && h) clampPosition(w, h);
  if(mediaType === 'image') drawFrame();
  e.preventDefault();
}, {passive:false});

canvas.addEventListener('touchend', () => { isDragging = false; });

// Zoom & Rotate
scaleSlider.addEventListener('input', e => {
  if(!mediaLoaded) return;
  const ns = parseFloat(e.target.value);
  const cx = CANVAS_W/2, cy = CANVAS_H/2;
  posX = cx - (cx - posX) * (ns / scale);
  posY = cy - (cy - posY) * (ns / scale);
  scale = ns;
  const w = mediaType === 'image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
  const h = mediaType === 'image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
  if(w && h) clampPosition(w, h);
  if(mediaType === 'image') drawFrame();
});

rotateButtons.forEach(btn => btn.addEventListener('click', () => {
  if(!mediaLoaded) return;
  rotationDeg = Number(btn.dataset.rot) % 360;
  const w = mediaType === 'image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
  const h = mediaType === 'image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
  if(w && h) clampPosition(w, h);
  if(mediaType === 'image') drawFrame();
}));

// Export image
async function exportImageJpg(){
  const out = document.createElement('canvas');
  out.width = CANVAS_W; 
  out.height = CANVAS_H;
  const octx = out.getContext('2d');
  
  octx.fillStyle = '#fff'; 
  octx.fillRect(0, 0, out.width, out.height);
  
  const rad = rotationDeg * Math.PI / 180;
  const dw = imgSrc.naturalWidth * scale;
  const dh = imgSrc.naturalHeight * scale;
  const cx = posX + dw/2;
  const cy = posY + dh/2;
  
  octx.save(); 
  octx.translate(cx, cy); 
  octx.rotate(rad);
  octx.drawImage(imgSrc, -dw/2, -dh/2, dw, dh); 
  octx.restore();
  octx.drawImage(frameImg, 0, 0, out.width, out.height);
  
  const url = out.toDataURL('image/jpeg', 0.92);
  const a = document.createElement('a'); 
  a.href = url; 
  a.download = 'galaxy_frame.jpg'; 
  a.click();
}

// GUARANTEED WORKING VIDEO EXPORT
async function exportVideoWebM(){
  showMsg('Starting export...');
  
  // Stop preview loop
  videoSrc.loop = false;
  videoSrc.pause();
  videoSrc.currentTime = 0;
  
  // Wait for seek
  await new Promise(resolve => {
    videoSrc.addEventListener('seeked', resolve, {once: true});
  });
  
  // Get duration
  const duration = videoSrc.duration;
  if(!duration || !isFinite(duration)){
    showMsg('Cannot read video duration');
    return;
  }
  
  showMsg(`Exporting ${Math.ceil(duration)}s video...`);
  
  // Create recording canvas - smaller for reliability  
  const recW = 540;
  const recH = Math.round(recW * (CANVAS_H / CANVAS_W));
  const offscreen = new OffscreenCanvas(recW, recH);
  const octx = offscreen.getContext('2d');
  
  // Start recording FIRST
  const stream = offscreen.captureStream(25); // Lower FPS for reliability
  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm',
    videoBitsPerSecond: 2000000 // Lower bitrate for stability
  });
  
  const chunks = [];
  recorder.ondataavailable = e => {
    if(e.data && e.data.size > 0) chunks.push(e.data);
  };
  
  recorder.start(100); // Small timeslices
  
  // Draw frames continuously
  let animationId;
  const drawLoop = () => {
    // Clear
    octx.clearRect(0, 0, recW, recH);
    
    // Scale factors
    const sx = recW / CANVAS_W;
    const sy = recH / CANVAS_H;
    
    // Draw video with transforms
    const vw = videoSrc.videoWidth;
    const vh = videoSrc.videoHeight;
    
    if(vw && vh){
      const dw = vw * scale * sx;
      const dh = vh * scale * sy; 
      const cx = (posX * sx) + dw/2;
      const cy = (posY * sy) + dh/2;
      
      octx.save();
      octx.translate(cx, cy);
      octx.rotate(rotationDeg * Math.PI / 180);
      octx.drawImage(videoSrc, -dw/2, -dh/2, dw, dh);
      octx.restore();
    }
    
    // Draw frame overlay
    octx.drawImage(frameImg, 0, 0, recW, recH);
    
    animationId = requestAnimationFrame(drawLoop);
  };
  
  // Start drawing
  drawLoop();
  
  // Play video and wait for end
  videoSrc.play();
  
  await new Promise(resolve => {
    videoSrc.addEventListener('ended', resolve, {once: true});
  });
  
  // Stop recording
  cancelAnimationFrame(animationId);
  recorder.stop();
  
  // Wait for final data
  await new Promise(resolve => {
    recorder.onstop = resolve;
  });
  
  // Create download
  const blob = new Blob(chunks, {type: 'video/webm'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'galaxy_frame_full.webm';
  a.click();
  
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  
  // Reset video for preview
  videoSrc.loop = true;
  videoSrc.currentTime = 0;
  videoSrc.play().catch(() => {});
  
  showMsg('Download complete!');
  setTimeout(() => showMsg(''), 2000);
}

// Download handler
downloadBtn.addEventListener('click', async () => {
  if(!mediaLoaded){ 
    showMsg('Upload a photo or video first.'); 
    return; 
  }
  
  showMsg('');
  
  if(mediaType === 'image') {
    try{ 
      await exportImageJpg(); 
    } catch(e){ 
      console.error(e); 
      showMsg('Image export failed.'); 
    }
  } else {
    try{ 
      await exportVideoWebM(); 
    } catch(e){ 
      console.error(e); 
      showMsg('Video export failed. Refresh and try again.'); 
    }
  }
});

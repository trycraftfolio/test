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
const CANVAS_W = canvas.width;   // 1080
const CANVAS_H = canvas.height;  // 1350
const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // 25MB input cap

// State
let mediaType = null; // 'image' | 'video'
let mediaLoaded = false;
let rafId = null;

// Transform
let posX = 0, posY = 0, scale = 1, rotationDeg = 0;

// Drag
let isDragging = false, dragStartX = 0, dragStartY = 0;

// Utils
const showMsg = (t='') => { if (msgBox) msgBox.textContent = t; };
const revoke = (u) => { try { URL.revokeObjectURL(u); } catch(_){} };

function fitCover(w, h){
  const s = Math.max(CANVAS_W / w, CANVAS_H / h);
  return { scale: s, x: (CANVAS_W - w*s)/2, y: (CANVAS_H - h*s)/2 };
}

function clampPosition(w, h){
  const rad = rotationDeg * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const bw = w*scale*cos + h*scale*sin;
  const bh = w*scale*sin + h*scale*cos;
  const minX = -bw + 80, maxX = CANVAS_W - 80;
  const minY = -bh + 80, maxY = CANVAS_H - 80;
  posX = Math.min(Math.max(posX, minX), maxX);
  posY = Math.min(Math.max(posY, minY), maxY);
}

// Frame load hint
(function initFrameHint(){
  if (!frameHint) return;
  const ok = () => { frameHint.style.display = 'none'; };
  const fail = () => { frameHint.textContent = 'Frame not found: assets/frame.png'; frameHint.style.display = 'block'; };
  if (!frameImg.complete) {
    frameHint.style.display = 'block';
    frameImg.addEventListener('load', ok);
    frameImg.addEventListener('error', fail);
  } else if (frameImg.naturalWidth === 0) {
    fail();
  } else {
    ok();
  }
})();

// Render
function drawFrame(){
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  if (mediaLoaded) {
    const rad = rotationDeg * Math.PI / 180;
    if (mediaType === 'image') {
      const w = imgSrc.naturalWidth, h = imgSrc.naturalHeight;
      const dw = w * scale, dh = h * scale;
      const cx = posX + dw/2, cy = posY + dh/2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rad);
      ctx.drawImage(imgSrc, -dw/2, -dh/2, dw, dh);
      ctx.restore();
    } else if (mediaType === 'video') {
      const w = videoSrc.videoWidth, h = videoSrc.videoHeight;
      if (w && h) {
        const dw = w * scale, dh = h * scale;
        const cx = posX + dw/2, cy = posY + dh/2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rad);
        ctx.drawImage(videoSrc, -dw/2, -dh/2, dw, dh);
        ctx.restore();
      }
    }
  }
  if (frameImg.naturalWidth) {
    ctx.drawImage(frameImg, 0, 0, CANVAS_W, CANVAS_H);
  }
}

function loop(){ drawFrame(); rafId = requestAnimationFrame(loop); }
function ensureLoop(){ if (!rafId) loop(); }
function stopLoop(){ if (rafId) cancelAnimationFrame(rafId); rafId = null; }

// Load media
fileInput.addEventListener('change', async (e) => {
  showMsg('');
  stopLoop();
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const isVideo = file.type.startsWith('video/');
  if (isVideo && file.size > MAX_VIDEO_BYTES) {
    showMsg('Video exceeds 25MB. Choose a smaller file.');
    fileInput.value = '';
    return;
  }

  const url = URL.createObjectURL(file);

  if (isVideo) {
    mediaType = 'video';
    mediaLoaded = false;
    videoSrc.pause();
    videoSrc.removeAttribute('src');
    videoSrc.src = url;
    videoSrc.currentTime = 0;
    videoSrc.muted = true;
    videoSrc.loop = true;

    await new Promise((res, rej) => {
      const ok = () => { cleanup(); res(); };
      const err = () => { cleanup(); rej(); };
      const cleanup = () => {
        videoSrc.removeEventListener('loadedmetadata', ok);
        videoSrc.removeEventListener('error', err);
      };
      videoSrc.addEventListener('loadedmetadata', ok);
      videoSrc.addEventListener('error', err);
    }).catch(()=> showMsg('Could not read video metadata. Try another file.'));

    if (!videoSrc.videoWidth) { revoke(url); return; }

    const { scale: s, x, y } = fitCover(videoSrc.videoWidth, videoSrc.videoHeight);
    scale = s; posX = x; posY = y; rotationDeg = 0;
    clampPosition(videoSrc.videoWidth, videoSrc.videoHeight);
    scaleSlider.value = String(Math.min(Math.max(scale, parseFloat(scaleSlider.min)), parseFloat(scaleSlider.max)));

    try { await videoSrc.play(); }
    catch {
      showMsg('Tap the stage to start video preview.');
      const oncePlay = () => { showMsg(''); videoSrc.play().catch(()=>{}); canvas.removeEventListener('click', oncePlay); };
      canvas.addEventListener('click', oncePlay, { once: true });
    }
    mediaLoaded = true;
    ensureLoop();
  } else {
    mediaType = 'image';
    mediaLoaded = false;
    imgSrc.onload = () => {
      const { scale: s, x, y } = fitCover(imgSrc.naturalWidth, imgSrc.naturalHeight);
      scale = s; posX = x; posY = y; rotationDeg = 0;
      clampPosition(imgSrc.naturalWidth, imgSrc.naturalHeight);
      scaleSlider.value = String(Math.min(Math.max(scale, parseFloat(scaleSlider.min)), parseFloat(scaleSlider.max)));
      mediaLoaded = true;
      drawFrame();
      revoke(url);
    };
    imgSrc.onerror = () => { showMsg('Could not load the selected image.'); revoke(url); };
    imgSrc.src = url;
  }
});

// Interactions (drag, zoom, rotate) - same as before
function toCanvasPoint(clientX, clientY){
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left) * (CANVAS_W / r.width),
    y: (clientY - r.top) * (CANVAS_H / r.height),
  };
}

canvas.addEventListener('mousedown', (e) => {
  if (!mediaLoaded) return;
  isDragging = true;
  const p = toCanvasPoint(e.clientX, e.clientY);
  dragStartX = p.x - posX;
  dragStartY = p.y - posY;
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const p = toCanvasPoint(e.clientX, e.clientY);
  posX = p.x - dragStartX;
  posY = p.y - dragStartY;
  const w = mediaType==='image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
  const h = mediaType==='image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
  if (w && h) clampPosition(w, h);
  if (mediaType === 'image') drawFrame();
});
['mouseup','mouseleave'].forEach(ev => {
  canvas.addEventListener(ev, () => { isDragging = false; canvas.style.cursor = 'grab'; });
});

canvas.addEventListener('touchstart', (e) => {
  if (!mediaLoaded || e.touches.length !== 1) return;
  isDragging = true;
  const t = e.touches[0];
  const p = toCanvasPoint(t.clientX, t.clientY);
  dragStartX = p.x - posX;
  dragStartY = p.y - posY;
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (!isDragging || e.touches.length !== 1) return;
  const t = e.touches;
  const p = toCanvasPoint(t.clientX, t.clientY);
  posX = p.x - dragStartX;
  posY = p.y - dragStartY;
  const w = mediaType==='image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
  const h = mediaType==='image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
  if (w && h) clampPosition(w, h);
  if (mediaType === 'image') drawFrame();
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', () => { isDragging = false; });

scaleSlider.addEventListener('input', (e) => {
  if (!mediaLoaded) return;
  const newScale = parseFloat(e.target.value);
  const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
  posX = cx - (cx - posX) * (newScale / scale);
  posY = cy - (cy - posY) * (newScale / scale);
  scale = newScale;
  const w = mediaType==='image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
  const h = mediaType==='image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
  if (w && h) clampPosition(w, h);
  if (mediaType === 'image') drawFrame();
});

rotateButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!mediaLoaded) return;
    rotationDeg = Number(btn.getAttribute('data-rot') || 0) % 360;
    const w = mediaType==='image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
    const h = mediaType==='image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
    if (w && h) clampPosition(w, h);
    if (mediaType === 'image') drawFrame();
  });
});

// Export image → JPG
async function exportImageJpg(){
  const ensureLoaded = (img) => new Promise((res, rej) => {
    if (img.complete && img.naturalWidth > 0) return res();
    img.onload = () => res();
    img.onerror = () => rej();
  });
  await ensureLoaded(frameImg);
  await ensureLoaded(imgSrc);

  const out = document.createElement('canvas');
  out.width = CANVAS_W; out.height = CANVAS_H;
  const octx = out.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, out.width, out.height);

  const rad = rotationDeg * Math.PI / 180;
  const dw = imgSrc.naturalWidth * scale;
  const dh = imgSrc.naturalHeight * scale;
  const cx = posX + dw/2, cy = posY + dh/2;
  octx.save();
  octx.translate(cx, cy);
  octx.rotate(rad);
  octx.drawImage(imgSrc, -dw/2, -dh/2, dw, dh);
  octx.restore();
  octx.drawImage(frameImg, 0, 0, out.width, out.height);

  const url = out.toDataURL('image/jpeg', 0.92);
  const a = document.createElement('a'); a.href = url; a.download = 'galaxy_a17_5g_frame.jpg'; a.click();
}

// Full-length video export with browser WASM conversion to MP4
async function exportFullVideoMP4(){
  showMsg('Preparing full video export…');
  
  // Reset video to start and ensure it's ready
  videoSrc.currentTime = 0;
  await new Promise(res => {
    videoSrc.addEventListener('seeked', res, { once: true });
  });

  const duration = videoSrc.duration;
  if (!isFinite(duration) || duration <= 0) {
    showMsg('Cannot determine video length');
    return;
  }

  // Create recording canvas (smaller for better performance)
  const recW = 540;
  const recH = Math.round(recW * (CANVAS_H / CANVAS_W)); // 675
  const offCanvas = document.createElement('canvas');
  offCanvas.width = recW; offCanvas.height = recH;
  const octx = offCanvas.getContext('2d');

  // Record the entire video frame by frame
  const fps = 30;
  const totalFrames = Math.ceil(duration * fps);
  const frameInterval = duration / totalFrames;
  
  showMsg(`Recording ${Math.ceil(duration)}s video (${totalFrames} frames)…`);

  const frames = [];
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i * frameInterval;
    videoSrc.currentTime = currentTime;
    
    await new Promise(res => {
      videoSrc.addEventListener('seeked', res, { once: true });
    });

    // Draw frame with transforms
    octx.clearRect(0, 0, recW, recH);
    const sx = recW / CANVAS_W, sy = recH / CANVAS_H;
    
    const vw = videoSrc.videoWidth, vh = videoSrc.videoHeight;
    if (vw && vh) {
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
    octx.drawImage(frameImg, 0, 0, recW, recH);

    // Capture frame as blob
    const blob = await new Promise(res => offCanvas.toBlob(res, 'image/jpeg', 0.8));
    frames.push(blob);
    
    // Update progress
    const progress = Math.round((i / totalFrames) * 50); // 50% for capture
    showMsg(`Recording frames… ${progress}%`);
  }

  // Convert frames to MP4 using browser WASM
  showMsg('Converting to MP4…');
  
  try {
    // Use WebCodecs API if available (Chrome/Edge)
    if ('VideoEncoder' in window) {
      const mp4Blob = await encodeFramesToMP4WebCodecs(frames, fps, recW, recH);
      downloadBlob(mp4Blob, 'galaxy_a17_5g_frame.mp4');
    } else {
      // Fallback: create WebM and offer download
      showMsg('MP4 encoding not available. Creating WebM…');
      const webmBlob = await createWebMFromFrames(frames, fps, recW, recH);
      downloadBlob(webmBlob, 'galaxy_a17_5g_frame.webm');
    }
    showMsg('');
  } catch (e) {
    console.error(e);
    showMsg('Video export failed. Try a shorter clip.');
  }
}

// WebCodecs MP4 encoder (Chrome/Edge)
async function encodeFramesToMP4WebCodecs(frames, fps, width, height) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    const encoder = new VideoEncoder({
      output: chunk => chunks.push(chunk),
      error: reject
    });
    
    encoder.configure({
      codec: 'avc1.420034', // H.264
      width, height,
      bitrate: 2_000_000,
      framerate: fps
    });

    let frameIndex = 0;
    const processFrame = async () => {
      if (frameIndex >= frames.length) {
        await encoder.flush();
        encoder.close();
        
        // Convert chunks to MP4 blob
        const mp4 = new Blob(chunks.map(c => c.copyTo ? new Uint8Array(c.copyTo()) : c), 
                            { type: 'video/mp4' });
        resolve(mp4);
        return;
      }

      const frameBlob = frames[frameIndex];
      const bitmap = await createImageBitmap(frameBlob);
      const frame = new VideoFrame(bitmap, {
        timestamp: (frameIndex * 1000000) / fps // microseconds
      });
      
      encoder.encode(frame);
      frame.close();
      bitmap.close();
      
      frameIndex++;
      showMsg(`Converting to MP4… ${Math.round(50 + (frameIndex/frames.length) * 50)}%`);
      setTimeout(processFrame, 0); // Non-blocking
    };
    
    processFrame();
  });
}

// WebM fallback for unsupported browsers
async function createWebMFromFrames(frames, fps, width, height) {
  // Create a simple slide show WebM using canvas capture
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  
  const stream = tempCanvas.captureStream(fps);
  const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks = [];
  
  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.start();
  
  // Draw each frame for the right duration
  const frameDuration = 1000 / fps; // ms
  for (let i = 0; i < frames.length; i++) {
    const img = new Image();
    img.src = URL.createObjectURL(frames[i]);
    await new Promise(res => { img.onload = res; });
    
    tempCtx.clearRect(0, 0, width, height);
    tempCtx.drawImage(img, 0, 0, width, height);
    
    await new Promise(res => setTimeout(res, frameDuration));
    URL.revokeObjectURL(img.src);
  }
  
  mediaRecorder.stop();
  return new Promise(res => {
    mediaRecorder.onstop = () => res(new Blob(chunks, { type: 'video/webm' }));
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Download handler
downloadBtn.addEventListener('click', async () => {
  if (!mediaLoaded) { showMsg('Upload a photo or video first.'); return; }
  showMsg('');

  if (mediaType === 'image') {
    try { await exportImageJpg(); }
    catch (e) { console.error(e); showMsg('Image export failed.'); }
  } else {
    try { await exportFullVideoMP4(); }
    catch (e) { console.error(e); showMsg('Video export failed. Try a shorter clip.'); }
  }
});

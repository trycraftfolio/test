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

// Transform (media drawn with its own top-left anchor at posX,posY but rotated around its center)
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

// Keep media from drifting completely outside canvas (soft clamp)
function clampPosition(w, h){
  // Compute axis-aligned bounding box after rotation to know approximate coverage
  const rad = rotationDeg * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const bw = w*scale*cos + h*scale*sin;
  const bh = w*scale*sin + h*scale*cos;

  const minX = -bw + 80; // allow some overdraw, but not all out
  const maxX = CANVAS_W - 80;
  const minY = -bh + 80;
  const maxY = CANVAS_H - 80;

  posX = Math.min(Math.max(posX, minX), maxX);
  posY = Math.min(Math.max(posY, minY), maxY);
}

// Frame load hint
(function initFrameHint(){
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

// Render (rotate around media center)
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

  // Draw frame last
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

    // Clamp to keep within view
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

// Dragging
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

// Touch
canvas.addEventListener('touchstart', (e) => {
  if (!mediaLoaded || e.touches.length !== 1) return;
  isDragging = true;
  const p = toCanvasPoint(e.touches.clientX, e.touches.clientY);
  dragStartX = p.x - posX;
  dragStartY = p.y - posY;
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (!isDragging || e.touches.length !== 1) return;
  const p = toCanvasPoint(e.touches.clientX, e.touches.clientY);
  posX = p.x - dragStartX;
  posY = p.y - dragStartY;

  const w = mediaType==='image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
  const h = mediaType==='image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
  if (w && h) clampPosition(w, h);

  if (mediaType === 'image') drawFrame();
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', () => { isDragging = false; });

// Zoom
scaleSlider.addEventListener('input', (e) => {
  if (!mediaLoaded) return;
  const newScale = parseFloat(e.target.value);

  // Zoom around center of canvas
  const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
  posX = cx - (cx - posX) * (newScale / scale);
  posY = cy - (cy - posY) * (newScale / scale);
  scale = newScale;

  const w = mediaType==='image' ? imgSrc.naturalWidth : videoSrc.videoWidth;
  const h = mediaType==='image' ? imgSrc.naturalHeight : videoSrc.videoHeight;
  if (w && h) clampPosition(w, h);

  if (mediaType === 'image') drawFrame();
});

// Rotate buttons (absolute angle), keep position clamped
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

// Export image → JPG (rotation centered)
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

// Export video → WebM (client-only on GitHub Pages), with rotation centered
async function exportVideoWebM(){
  const recW = 720;
  const recH = Math.round(recW * (CANVAS_H / CANVAS_W)); // 900
  const off = document.createElement('canvas');
  off.width = recW; off.height = recH;
  const octx = off.getContext('2d');

  let running = true;
  function drawOff(){
    if (!running) return;

    octx.clearRect(0, 0, recW, recH);
    const sx = recW / CANVAS_W, sy = recH / CANVAS_H;

    // Video rotated around center
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

    requestAnimationFrame(drawOff);
  }
  drawOff();

  const mime = (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9'
               : MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8'
               : 'video/webm');

  const stream = off.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(200);

  // Record one loop or 6s by default
  let dur = videoSrc.duration;
  if (!isFinite(dur) || dur <= 0) dur = 6;
  dur = Math.min(Math.max(dur, 2), 6);

  await new Promise(res => setTimeout(res, dur * 1000));
  running = false;
  await new Promise(res => { rec.onstop = res; rec.stop(); });

  const blob = new Blob(chunks, { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'galaxy_a17_5g_frame.webm';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

// Download handler
downloadBtn.addEventListener('click', async () => {
  if (!mediaLoaded) { showMsg('Upload a photo or video first.'); return; }
  showMsg('');

  if (mediaType === 'image') {
    try { await exportImageJpg(); } catch (e) { console.error(e); showMsg('Image export failed.'); }
  } else {
    try { await videoSrc.play(); } catch {}
    try { await exportVideoWebM(); }
    catch (e) { console.error(e); showMsg('Video export failed in this browser. Try Chrome/Edge.'); }
  }
});

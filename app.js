// app.js

// Elements
const canvas = document.getElementById('photoCanvas');
const ctx = canvas.getContext('2d');
const frameImg = document.getElementById('frame');
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

// State
let mediaType = null;     // "image" or "video"
let mediaLoaded = false;
let scale = 1;
let rotationDeg = 0;
let posX = 0;
let posY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// Utils
function showMsg(text) {
  msgBox.textContent = text;
}
function toCanvasPoint(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left) * (CANVAS_W / r.width),
    y: (clientY - r.top) * (CANVAS_H / r.height)
  };
}

// Fit cover
function fitCover(w, h) {
  const s = Math.max(CANVAS_W / w, CANVAS_H / h);
  return { scale: s, x: (CANVAS_W - w * s) / 2, y: (CANVAS_H - h * s) / 2 };
}

// Draw
function drawFrame() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (!mediaLoaded) return;

  ctx.save();
  ctx.translate(posX + (mediaType === 'image' ? imgSrc.naturalWidth * scale / 2 : videoSrc.videoWidth * scale / 2),
                posY + (mediaType === 'image' ? imgSrc.naturalHeight * scale / 2 : videoSrc.videoHeight * scale / 2));
  ctx.rotate(rotationDeg * Math.PI / 180);

  if (mediaType === 'image') {
    ctx.drawImage(
      imgSrc,
      -imgSrc.naturalWidth * scale / 2,
      -imgSrc.naturalHeight * scale / 2,
      imgSrc.naturalWidth * scale,
      imgSrc.naturalHeight * scale
    );
  } else {
    ctx.drawImage(
      videoSrc,
      -videoSrc.videoWidth * scale / 2,
      -videoSrc.videoHeight * scale / 2,
      videoSrc.videoWidth * scale,
      videoSrc.videoHeight * scale
    );
  }

  ctx.restore();

  // Overlay frame
  ctx.drawImage(frameImg, 0, 0, CANVAS_W, CANVAS_H);
}

function startLoop() {
  function loop() {
    drawFrame();
    requestAnimationFrame(loop);
  }
  loop();
}

// Upload handler
fileInput.addEventListener('change', async () => {
  showMsg('');
  const file = fileInput.files[0];
  if (!file) return;

  const isVideo = file.type.startsWith('video/');
  mediaType = isVideo ? 'video' : 'image';
  mediaLoaded = false;

  const url = URL.createObjectURL(file);

  if (isVideo) {
    videoSrc.src = url;
    await videoSrc.play().catch(() => {});
    const cover = fitCover(videoSrc.videoWidth, videoSrc.videoHeight);
    scale = cover.scale;
    posX = cover.x;
    posY = cover.y;
    rotationDeg = 0;
    mediaLoaded = true;
    startLoop();
    videoSrc.pause();
  } else {
    imgSrc.src = url;
    imgSrc.onload = () => {
      const cover = fitCover(imgSrc.naturalWidth, imgSrc.naturalHeight);
      scale = cover.scale;
      posX = cover.x;
      posY = cover.y;
      rotationDeg = 0;
      mediaLoaded = true;
      startLoop();
    };
  }
});

// Dragging
canvas.addEventListener('mousedown', e => {
  if (!mediaLoaded) return;
  isDragging = true;
  const p = toCanvasPoint(e.clientX, e.clientY);
  dragStartX = p.x - posX;
  dragStartY = p.y - posY;
});
canvas.addEventListener('mousemove', e => {
  if (!isDragging) return;
  const p = toCanvasPoint(e.clientX, e.clientY);
  posX = p.x - dragStartX;
  posY = p.y - dragStartY;
});
window.addEventListener('mouseup', () => isDragging = false);

// Zoom
scaleSlider.addEventListener('input', e => {
  if (!mediaLoaded) return;
  const newScale = parseFloat(e.target.value);
  scale = newScale;
});

// Rotate
rotateButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!mediaLoaded) return;
    rotationDeg = parseInt(btn.dataset.rot, 10);
  });
});

// Export image as JPEG
async function exportImage() {
  const out = document.createElement('canvas');
  out.width = CANVAS_W;
  out.height = CANVAS_H;
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawFrame();
  octx.drawImage(canvas, 0, 0);
  const url = out.toDataURL('image/jpeg', 0.92);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'framed-image.jpg';
  a.click();
}

// Export video via Netlify Function
async function exportVideo() {
  showMsg('Processing video on server…');
  const file = fileInput.files[0];
  if (!file || !file.type.startsWith('video/')) {
    showMsg('Please upload a video first.');
    return;
  }

  // Collect current transform params
  const params = {
    posX, posY, scale, rotationDeg,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    frameUrl: new URL(frameImg.src, location.href).href
  };

  const form = new FormData();
  form.append('video', file);
  form.append('params', JSON.stringify(params));

  try {
    const res = await fetch('/.netlify/functions/export-mp4', {
      method: 'POST',
      body: form
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'framed-video.mp4';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showMsg('');
  } catch (err) {
    console.error(err);
    showMsg('Video export failed on server.');
  }
}

// Download button
downloadBtn.addEventListener('click', () => {
  if (!mediaLoaded) {
    showMsg('Please upload an image or video first.');
    return;
  }
  if (mediaType === 'image') exportImage();
  else exportVideo();
});

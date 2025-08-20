// Elements
const canvas = document.getElementById('photoCanvas');
const ctx = canvas.getContext('2d');
const frameImg = document.getElementById('frame');
const fileInput = document.getElementById('fileInput');
const scaleSlider = document.getElementById('scaleRange');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const msgBox = document.getElementById('msg');
const imgSrc = document.getElementById('sourceImage');
const uploadLabel = document.getElementById('uploadLabel');

const btnRotate = document.getElementById('btn-rotate');
const btnFit = document.getElementById('btn-fit');
const btnCenter = document.getElementById('btn-center');
const btnTilt = document.getElementById('btn-tilt'); // optional Tilt button if present

const joyUp = document.getElementById('joy-up');
const joyDown = document.getElementById('joy-down');
const joyLeft = document.getElementById('joy-left');
const joyRight = document.getElementById('joy-right');
const joyCenter = document.getElementById('joy-center');

// Canvas/base size
let baseCanvasW = canvas.width;   // 1080
let baseCanvasH = canvas.height;  // 1350

// Frame cutout (transparent window) measurements (pixels at canvas scale)
const CUTOUT = {
  x: 60,
  y: 177,
  w: baseCanvasW - 60 - 60,    // 960
  h: baseCanvasH - 177 - 351   // 822
};

// State
let mediaLoaded = false;
let scale = 1;
let rotationDeg = 0;
let posX = 0; // top-left of drawn image (before rotation)
let posY = 0;
let isDragging = false;
let dragStartCanvasX = 0, dragStartCanvasY = 0;
let dragStartPosX = 0, dragStartPosY = 0;
let loopRunning = false;
let currentObjectURL = null;

// Interaction polish state
const canvasWrap = document.querySelector('.canvas-wrap');
let glowTimer = null;

// Gyro state (optional)
let tiltActive = false;
let lastGamma = 0, lastBeta = 0;
let disableTiltListener = null;

// Utils
const showMsg = (t='') => { if (msgBox) msgBox.textContent = t; };

function toCanvasPoint(clientX, clientY){
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left) * (baseCanvasW / r.width),
    y: (clientY - r.top)  * (baseCanvasH / r.height),
  };
}

// Haptics (mobile only; safely no-op elsewhere)
function haptic(ms = 10){
  if (navigator.vibrate) navigator.vibrate(ms);
}

// Frame glow toggle
function glowPulse(duration = 250){
  if (!canvasWrap) return;
  canvasWrap.classList.add('glow');
  clearTimeout(glowTimer);
  glowTimer = setTimeout(()=>canvasWrap.classList.remove('glow'), duration);
}

// Confetti overlay helpers (robust)
function getCanvasPixelSize() {
  return { w: canvas.width, h: canvas.height };
}
function ensureConfettiOverlay() {
  let overlay = document.getElementById('confettiOverlay');
  if (!overlay){
    overlay = document.createElement('canvas');
    overlay.id = 'confettiOverlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '4'; // above frame (2) and hint (3)
    const wrap = canvas.closest('.canvas-wrap') || canvas.parentElement;
    wrap.appendChild(overlay);
  }
  const { w, h } = getCanvasPixelSize();
  if (overlay.width !== w) overlay.width = w;
  if (overlay.height !== h) overlay.height = h;
  return overlay;
}
function confettiBurst(x = canvas.width - 80, y = 80, count = 20) {
  const overlay = ensureConfettiOverlay();
  const octx = overlay.getContext('2d');

  const particles = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      g: 0.12 + Math.random() * 0.08,
      life: 30 + Math.random() * 20,
      color: `hsl(${Math.floor(Math.random() * 360)},90%,60%)`,
      size: 3 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2
    });
  }

  let frames = 0;
  function step() {
    const { w, h } = getCanvasPixelSize();
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
    }
    octx.clearRect(0, 0, overlay.width, overlay.height);

    particles.forEach(p => {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life--;
      octx.save();
      octx.translate(p.x, p.y);
      octx.rotate(p.rot);
      octx.fillStyle = p.color;
      octx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      octx.restore();
    });

    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0 || particles[i].y > overlay.height + 40) particles.splice(i, 1);
    }

    frames++;
    if (particles.length && frames < 120) {
      requestAnimationFrame(step);
    } else {
      octx.clearRect(0, 0, overlay.width, overlay.height);
    }
  }
  step();
}

// Fits media to fully COVER the rect (may crop)
function fitCoverToRect(mediaW, mediaH, rectW, rectH){
  const s = Math.max(rectW / mediaW, rectH / mediaH);
  const drawW = mediaW * s;
  const drawH = mediaH * s;
  return {
    scale: s,
    x: CUTOUT.x + (rectW - drawW)/2,
    y: CUTOUT.y + (rectH - drawH)/2
  };
}

// Fits media to fully CONTAIN within rect (no crop) – for min zoom bound
function fitContainToRect(mediaW, mediaH, rectW, rectH){
  const s = Math.min(rectW / mediaW, rectH / mediaH);
  const drawW = mediaW * s;
  const drawH = mediaH * s;
  return {
    scale: s,
    x: CUTOUT.x + (rectW - drawW)/2,
    y: CUTOUT.y + (rectH - drawH)/2
  };
}

function setScale(newScale, syncSlider = false){
  // Clamp to current slider bounds so min can be dynamic (contain)
  let min = 0.1, max = 3;
  if (scaleSlider){
    const m1 = parseFloat(scaleSlider.min); if (Number.isFinite(m1)) min = m1;
    const m2 = parseFloat(scaleSlider.max); if (Number.isFinite(m2)) max = m2;
  }
  scale = Math.max(min, Math.min(max, newScale));
  if (syncSlider && scaleSlider) {
    scaleSlider.value = String(scale);
  }
}

function resetMedia(){
  mediaLoaded = false;
  imgSrc.removeAttribute('src');
  imgSrc.hidden = true;
  if (currentObjectURL){
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }
  posX = posY = 0;
  scale = 1;
  rotationDeg = 0;
  showMsg('');
  uploadLabel && (uploadLabel.textContent = 'Upload Photo');
  drawFrame();
}

function preloadImage(el){
  return new Promise((res, rej) => {
    if (el.complete && el.naturalWidth) return res();
    el.addEventListener('load', () => res(), { once: true });
    el.addEventListener('error', () => rej(new Error('Image failed')), { once: true });
  });
}

function isRightAngle(){
  const r = ((rotationDeg % 360) + 360) % 360;
  return r === 90 || r === 270;
}

// Draw
function drawFrame(){
  ctx.clearRect(0, 0, baseCanvasW, baseCanvasH);
  if (!mediaLoaded) return;

  const w = imgSrc.naturalWidth;
  const h = imgSrc.naturalHeight;

  if (w && h) {
    const dw = w * scale, dh = h * scale;
    const cx = posX + dw/2, cy = posY + dh/2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationDeg * Math.PI/180);
    ctx.drawImage(imgSrc, -dw/2, -dh/2, dw, dh);
    ctx.restore();
  }

  // Frame overlay (webp)
  if (frameImg && frameImg.naturalWidth) {
    ctx.drawImage(frameImg, 0, 0, baseCanvasW, baseCanvasH);
  }
}

function startLoop(){
  if (loopRunning) return;
  loopRunning = true;
  function loop(){ drawFrame(); requestAnimationFrame(loop); }
  loop();
}

// Center image inside cutout (does not change scale)
function centerInCutout(){
  if (!mediaLoaded) return;
  const w = imgSrc.naturalWidth, h = imgSrc.naturalHeight;
  if (!(w && h)) return;
  const dw = w * scale, dh = h * scale;
  posX = CUTOUT.x + (CUTOUT.w - dw)/2;
  posY = CUTOUT.y + (CUTOUT.h - dh)/2;
}

// Fit image to cutout (cover) and center
function fitToCutout(syncSlider = true){
  if (!mediaLoaded) return;
  const w = imgSrc.naturalWidth, h = imgSrc.naturalHeight;
  if (!(w && h)) return;

  // Swap W/H for fitting if rotated 90/270 (coverage calc)
  const mw = isRightAngle() ? h : w;
  const mh = isRightAngle() ? w : h;

  const fit = fitCoverToRect(mw, mh, CUTOUT.w, CUTOUT.h);
  setScale(fit.scale, syncSlider);

  // Center the actual drawn image in the cutout
  centerInCutout();
}

// Zoom from the image center (no corner jump)
function zoomFromCenter(newScale){
  if (!mediaLoaded) return;
  const w = imgSrc.naturalWidth, h = imgSrc.naturalHeight;
  if (!(w && h)) return;

  const dwOld = w * scale, dhOld = h * scale;
  const centerX = posX + dwOld/2;
  const centerY = posY + dhOld/2;

  setScale(newScale, true);

  const dwNew = w * scale, dhNew = h * scale;
  posX = centerX - dwNew/2;
  posY = centerY - dhNew/2;
}

// Upload
fileInput.addEventListener('change', async () => {
  showMsg('');
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  resetMedia();

  const url = URL.createObjectURL(file);
  currentObjectURL = url;
  imgSrc.hidden = false; imgSrc.setAttribute('aria-hidden','true');

  imgSrc.onload = () => {
    const w = imgSrc.naturalWidth || 1;
    const h = imgSrc.naturalHeight || 1;

    // Initial fit to cutout using COVER
    const fit = fitCoverToRect(w, h, CUTOUT.w, CUTOUT.h);
    setScale(fit.scale, true);
    posX = fit.x;
    posY = fit.y;
    rotationDeg = 0;

    mediaLoaded = true;

    // Allow zoom-out to CONTAIN (entire photo visible)
    const contain = fitContainToRect(w, h, CUTOUT.w, CUTOUT.h);
    const hardFloor = 0.1;
    scaleSlider.min = String(Math.max(hardFloor, contain.scale));
    scaleSlider.max = '3';
    scaleSlider.step = '0.01';
    scaleSlider.value = String(scale);
  };
  imgSrc.onerror = () => { showMsg('Could not load the selected image.'); };
  imgSrc.src = url;
});

// Drag (delta-based; no jump)
function setDraggingCursor(on){
  document.body.style.userSelect = on ? 'none' : '';
  document.body.style.webkitUserSelect = on ? 'none' : '';
}

canvas.addEventListener('mousedown', (e) => {
  if (!mediaLoaded) return;
  isDragging = true;
  const p = toCanvasPoint(e.clientX, e.clientY);
  dragStartCanvasX = p.x;
  dragStartCanvasY = p.y;
  dragStartPosX = posX;
  dragStartPosY = posY;
  setDraggingCursor(true);
  glowPulse(220);
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const p = toCanvasPoint(e.clientX, e.clientY);
  posX = dragStartPosX + (p.x - dragStartCanvasX);
  posY = dragStartPosY + (p.y - dragStartCanvasY);
  drawFrame();
});

window.addEventListener('mouseup', () => { isDragging = false; setDraggingCursor(false); });

// Touch drag
canvas.addEventListener('touchstart', (e) => {
  if (!mediaLoaded || !e.touches || e.touches.length !== 1) return;
  const t = e.touches[0];
  const p = toCanvasPoint(t.clientX, t.clientY);
  isDragging = true;
  dragStartCanvasX = p.x;
  dragStartCanvasY = p.y;
  dragStartPosX = posX;
  dragStartPosY = posY;
  glowPulse(220);
  e.preventDefault();
}, { passive:false });

canvas.addEventListener('touchmove', (e) => {
  if (!isDragging || !e.touches || e.touches.length !== 1) return;
  const t = e.touches[0];
  const p = toCanvasPoint(t.clientX, t.clientY);
  posX = dragStartPosX + (p.x - dragStartCanvasX);
  posY = dragStartPosY + (p.y - dragStartCanvasY);
  e.preventDefault();
  drawFrame();
}, { passive:false });

canvas.addEventListener('touchend',   (e)=>{ isDragging = false; e.preventDefault(); }, { passive:false });
canvas.addEventListener('touchcancel',(e)=>{ isDragging = false; e.preventDefault(); }, { passive:false });

// Zoom (slider) — centered
scaleSlider.addEventListener('input', (e) => {
  if (!mediaLoaded) return;
  const v = parseFloat(e.target.value);
  if (Number.isFinite(v)) {
    zoomFromCenter(v);
  }
});

// Rotate 90°, then refit to cutout to guarantee coverage
function setRotateAria(){
  if (!btnRotate) return;
  btnRotate.setAttribute('aria-pressed', 'true');
  setTimeout(()=>btnRotate.setAttribute('aria-pressed','false'), 80);
}

btnRotate?.addEventListener('click', () => {
  if (!mediaLoaded) return;
  rotationDeg = (rotationDeg + 90) % 360;
  fitToCutout(true);
  setRotateAria();
  haptic(12);
  glowPulse(260);
});

// Fit / Center buttons
btnFit?.addEventListener('click', () => {
  if (!mediaLoaded) return;
  fitToCutout(true);
  haptic(8);
  glowPulse(220);
});

btnCenter?.addEventListener('click', () => {
  if (!mediaLoaded) return;
  centerInCutout();
  haptic(6);
  glowPulse(200);
});

// Joystick
let joy = { up:false, down:false, left:false, right:false, speed:1, raf:0 };

function joyStep(){
  if (!mediaLoaded) { joy.raf = 0; return; }
  const base = 2;
  const v = base * joy.speed;
  if (joy.up)    posY -= v;
  if (joy.down)  posY += v;
  if (joy.left)  posX -= v;
  if (joy.right) posX += v;
  drawFrame();
  joy.raf = requestAnimationFrame(joyStep);
}

function joyStart(dir){
  joy[dir] = true;
  if (!joy.raf) joy.raf = requestAnimationFrame(joyStep);
}
function joyStop(dir){
  joy[dir] = false;
  if (!joy.up && !joy.down && !joy.left && !joy.right && joy.raf){
    cancelAnimationFrame(joy.raf);
    joy.raf = 0;
  }
}
function bindJoy(btn, dir){
  if (!btn) return;
  const pressOn = () => {
    btn.classList.add('is-active');
    joyStart(dir);
    haptic(4);
  };
  const pressOff = () => {
    btn.classList.remove('is-active');
    joyStop(dir);
  };
  // Mouse
  btn.addEventListener('mousedown', pressOn);
  btn.addEventListener('mouseup',   pressOff);
  btn.addEventListener('mouseleave',pressOff);
  // Touch
  btn.addEventListener('touchstart', (e)=>{ e.preventDefault(); pressOn(); }, { passive:false });
  btn.addEventListener('touchend',   (e)=>{ e.preventDefault(); pressOff(); }, { passive:false });
  btn.addEventListener('touchcancel',(e)=>{ e.preventDefault(); pressOff(); }, { passive:false });
}
bindJoy(joyUp,'up'); bindJoy(joyDown,'down'); bindJoy(joyLeft,'left'); bindJoy(joyRight,'right');

if (joyCenter) {
  joyCenter.title = 'Toggle move speed';
  joyCenter.textContent = '●';
  joyCenter.addEventListener('click', ()=>{
    joy.speed = joy.speed === 1 ? 2 : joy.speed === 2 ? 4 : 1;
    joyCenter.textContent = joy.speed === 1 ? '●' : (joy.speed === 2 ? '●●' : '●●●');
    haptic(8);
    glowPulse(160);
  });
}

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (!mediaLoaded) return;
  const step = 8;
  let handled = false;

  switch (e.key) {
    case 'ArrowUp':    posY -= step; handled = true; break;
    case 'ArrowDown':  posY += step; handled = true; break;
    case 'ArrowLeft':  posX -= step; handled = true; break;
    case 'ArrowRight': posX += step; handled = true; break;
    case 'r':
    case 'R':
      rotationDeg = (rotationDeg + 90) % 360; fitToCutout(true); handled = true; break;
    case '+':
    case '=':
      zoomFromCenter(scale * 1.05); handled = true; break;
    case '-':
    case '_':
      zoomFromCenter(scale / 1.05); handled = true; break;
  }

  if (handled){
    glowPulse(160);
    e.preventDefault();
  }
});

// Double-click / double-tap zoom (fit <-> 2x of fit for cutout)
function toggleZoom(){
  if (!mediaLoaded) return;
  const w = imgSrc.naturalWidth, h = imgSrc.naturalHeight;
  if (!(w && h)) return;

  // Compute fit scale for current orientation to the cutout
  const mw = isRightAngle() ? h : w;
  const mh = isRightAngle() ? w : h;
  const fit = fitCoverToRect(mw, mh, CUTOUT.w, CUTOUT.h);
  const fitScale = fit.scale;

  const target = Math.abs(scale - 2*fitScale) < 0.001
    ? fitScale
    : Math.min(fitScale * 2, parseFloat(scaleSlider.max) || 3);

  zoomFromCenter(target);
  glowPulse(160);
}

let lastTap = 0;
canvas.addEventListener('dblclick', () => { toggleZoom(); });
canvas.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTap < 300) {
    toggleZoom();
    e.preventDefault();
  }
  lastTap = now;
}, { passive:false });

// Export image (always JPEG)
async function exportImage(){
  await new Promise(requestAnimationFrame);
  const out = document.createElement('canvas');
  out.width = baseCanvasW; out.height = baseCanvasH;
  const octx = out.getContext('2d', { alpha: false });
  octx.drawImage(canvas, 0, 0);
  const url = out.toDataURL('image/jpeg', 0.92);
  const a = document.createElement('a');
  a.href = url; a.download = 'framed-image.jpg'; a.click();
}

// Download with confetti + haptic
downloadBtn.addEventListener('click', async () => {
  if (!mediaLoaded) { showMsg('Please upload an image first.'); return; }
  downloadBtn.disabled = true;
  try {
    await exportImage();
    haptic(15);
    confettiBurst(canvas.width - 80, 80, 22);
  } finally {
    downloadBtn.disabled = false;
  }
});

// Clear (reset everything) with haptic
clearBtn?.addEventListener('click', () => {
  fileInput.value = '';
  resetMedia();
  haptic(6);
  glowPulse(140);
});

// Gyro tilt-to-pan (optional, off by default; requires a button with id="btn-tilt")
function applyTilt(gamma, beta){
  if (!mediaLoaded) return;
  const sensX = 0.35; // left/right tilt sensitivity
  const sensY = 0.25; // forward/back tilt sensitivity
  const maxShiftX = CUTOUT.w * 0.08;
  const maxShiftY = CUTOUT.h * 0.08;

  const dx = Math.max(-maxShiftX, Math.min(maxShiftX, gamma * sensX));
  const dy = Math.max(-maxShiftY, Math.min(maxShiftY, beta * sensY));

  const w = imgSrc.naturalWidth, h = imgSrc.naturalHeight;
  const dw = w * scale, dh = h * scale;

  const targetX = CUTOUT.x + (CUTOUT.w - dw)/2 + dx;
  const targetY = CUTOUT.y + (CUTOUT.h - dh)/2 + dy;

  // Smooth approach
  posX = posX + (targetX - posX) * 0.15;
  posY = posY + (targetY - posY) * 0.15;
}

function enableTilt(){
  function onTilt(e){
    lastGamma = e.gamma || 0; // left/right (-90..90)
    lastBeta  = e.beta  || 0; // front/back (-180..180)
  }
  function rafTilt(){
    if (tiltActive){
      applyTilt(lastGamma, lastBeta);
      requestAnimationFrame(rafTilt);
    }
  }
  window.addEventListener('deviceorientation', onTilt);
  requestAnimationFrame(rafTilt);
  return () => window.removeEventListener('deviceorientation', onTilt);
}

btnTilt?.addEventListener('click', async () => {
  if (!tiltActive){
    // iOS permission
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') { showMsg('Tilt access denied'); return; }
      } catch { showMsg('Tilt access failed'); return; }
    }
    tiltActive = true;
    btnTilt.setAttribute('aria-pressed','true');
    btnTilt.textContent = 'Tilt On';
    haptic(8);
    glowPulse(180);
    disableTiltListener = enableTilt();
  } else {
    tiltActive = false;
    btnTilt.setAttribute('aria-pressed','false');
    btnTilt.textContent = 'Tilt';
    haptic(4);
    glowPulse(120);
    if (disableTiltListener) disableTiltListener();
    disableTiltListener = null;
    centerInCutout();
  }
});

// Init: preload frame.webp then start loop
(async function init(){
  const hint = document.getElementById('frameHint');
  try {
    hint && (hint.style.display = 'block');
    await preloadImage(frameImg);
  } catch {}
  hint && (hint.style.display = 'none');
  startLoop();
})();

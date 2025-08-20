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
const btnTilt = document.getElementById('btn-tilt'); // optional if present
const btnEnhance = document.getElementById('btn-enhance'); // Auto Enhance button

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
let posX = 0; // top-left of drawn image (pre-rotation space)
let posY = 0;
let isDragging = false;
let dragStartCanvasX = 0, dragStartCanvasY = 0;
let dragStartPosX = 0, dragStartPosY = 0;
let loopRunning = false;
let currentObjectURL = null;

// Interaction polish state
const canvasWrap = document.querySelector('.canvas-wrap');

// Gyro state (optional)
let tiltActive = false;
let lastGamma = 0, lastBeta = 0;
let disableTiltListener = null;

// Auto Enhance state
let brightness = 0;   // -100..100
let contrast = 0;     // -100..100
let saturation = 0;   // -100..100
let enhanceOn = false;

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

// Press-to-glow: ON during active drag/press, OFF when released
function glowOn(){ canvasWrap?.classList.add('glow'); }
function glowOff(){ canvasWrap?.classList.remove('glow'); }

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
  // Reset enhance
  enhanceOn = false;
  brightness = 0; contrast = 0; saturation = 0;
  const be = document.getElementById('btn-enhance');
  if (be){ be.setAttribute('aria-pressed','false'); be.textContent = 'Enhance'; }
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

// Build photo filter (applies to image only; frame clean)
function buildFilter(bright, cont, sat){
  const b = 1 + (bright / 100);   // 0..2
  const c = 1 + (cont / 100);     // 0..2
  const s = 1 + (sat / 100);      // 0..2
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
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

    // Apply photo filters
    ctx.save();
    ctx.filter = buildFilter(brightness, contrast, saturation);
    ctx.translate(cx, cy);
    ctx.rotate(rotationDeg * Math.PI/180);
    ctx.drawImage(imgSrc, -dw/2, -dh/2, dw, dh);
    ctx.restore();

    // Reset filter so frame is clean
    ctx.filter = 'none';
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

  const mw = isRightAngle() ? h : w;
  const mh = isRightAngle() ? w : h;

  const fit = fitCoverToRect(mw, mh, CUTOUT.w, CUTOUT.h);
  setScale(fit.scale, syncSlider);
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

// Drag (delta-based; no jump) + press-to-glow behavior
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
  glowOn();
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const p = toCanvasPoint(e.clientX, e.clientY);
  posX = dragStartPosX + (p.x - dragStartCanvasX);
  posY = dragStartPosY + (p.y - dragStartCanvasY);
  drawFrame();
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  setDraggingCursor(false);
  glowOff();
});

// Touch drag + press-to-glow
canvas.addEventListener('touchstart', (e) => {
  if (!mediaLoaded || !e.touches || e.touches.length !== 1) return;
  const t = e.touches[0];
  const p = toCanvasPoint(t.clientX, t.clientY);
  isDragging = true;
  dragStartCanvasX = p.x;
  dragStartCanvasY = p.y;
  dragStartPosX = posX;
  dragStartPosY = posY;
  glowOn();
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

canvas.addEventListener('touchend',   (e)=>{ isDragging = false; glowOff(); e.preventDefault(); }, { passive:false });
canvas.addEventListener('touchcancel',(e)=>{ isDragging = false; glowOff(); e.preventDefault(); }, { passive:false });

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
});

// Fit / Center buttons
btnFit?.addEventListener('click', () => {
  if (!mediaLoaded) return;
  fitToCutout(true);
  haptic(8);
});

btnCenter?.addEventListener('click', () => {
  if (!mediaLoaded) return;
  centerInCutout();
  haptic(6);
});

// Auto Enhance toggle (brightness/contrast/saturation)
btnEnhance?.addEventListener('click', () => {
  enhanceOn = !enhanceOn;
  if (enhanceOn) {
    brightness = 8;   // +8%
    contrast = 10;    // +10%
    saturation = 12;  // +12%
    btnEnhance.setAttribute('aria-pressed','true');
    btnEnhance.textContent = 'Enhance ✓';
  } else {
    brightness = 0;
    contrast = 0;
    saturation = 0;
    btnEnhance.setAttribute('aria-pressed','false');
    btnEnhance.textContent = 'Enhance';
  }
  haptic(8);
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
    e.preventDefault();
  }
});

// Double-click / double-tap zoom (fit <-> 2x of fit for cutout)
function toggleZoom(){
  if (!mediaLoaded) return;
  const w = imgSrc.naturalWidth, h = imgSrc.naturalHeight;
  if (!(w && h)) return;

  const mw = isRightAngle() ? h : w;
  const mh = isRightAngle() ? w : h;
  const fit = fitCoverToRect(mw, mh, CUTOUT.w, CUTOUT.h);
  const fitScale = fit.scale;

  const target = Math.abs(scale - 2*fitScale) < 0.001
    ? fitScale
    : Math.min(fitScale * 2, parseFloat(scaleSlider.max) || 3);

  zoomFromCenter(target);
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

  // Redraw the current canvas output onto the export canvas
  // (Since we already render the composed result to canvas each frame,
  //  drawing the screen canvas is enough. Alternatively, redraw layers.)
  octx.drawImage(canvas, 0, 0);

  const url = out.toDataURL('image/jpeg', 0.92);
  const a = document.createElement('a');
  a.href = url; a.download = 'framed-image.jpg'; a.click();
}

// Download
downloadBtn.addEventListener('click', async () => {
  if (!mediaLoaded) { showMsg('Please upload an image first.'); return; }
  downloadBtn.disabled = true;
  try {
    await exportImage();
    haptic(15);
  } finally {
    downloadBtn.disabled = false;
  }
});

// Clear (reset everything)
clearBtn?.addEventListener('click', () => {
  fileInput.value = '';
  resetMedia();
  haptic(6);
});

// Gyro tilt-to-pan (optional, off by default)
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
    disableTiltListener = enableTilt();
  } else {
    tiltActive = false;
    btnTilt.setAttribute('aria-pressed','false');
    btnTilt.textContent = 'Tilt';
    haptic(4);
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

  // Lightweight, mobile-friendly particle background
(function initParticles(){
  const fx = document.getElementById('particlesCanvas');
  if (!fx) return;

  const ctx = fx.getContext('2d', { alpha: true });
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize(){
    const wrap = fx.parentElement; // .fx-wrap
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * DPR));
    const h = Math.max(1, Math.floor(rect.height * DPR));
    fx.width = w;
    fx.height = h;
  }
  resize();
  window.addEventListener('resize', resize);

  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  const COUNT = isMobile ? 90 : 180;

  function spawn(w,h){
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 1,
      vy: (Math.random() - 0.5) * 1,
      r: 0.8 + Math.random() * 0.5,
      hue: (Math.random() * 360) | 0,
      a: 0.45 + Math.random() * 5.35
    };
  }

  let particles = Array.from({ length: COUNT }, () => spawn(fx.width, fx.height));

  // Pause when tab hidden (battery-friendly)
  let running = true;
  document.addEventListener('visibilitychange', () => {
    running = document.visibilityState === 'visible';
  });

  function step(){
    if (!running) { requestAnimationFrame(step); return; }
    ctx.clearRect(0, 0, fx.width, fx.height);

    for (let p of particles){
      p.x += p.vx; p.y += p.vy;

      // wrap-around edges
      if (p.x < -10) p.x = fx.width + 10; else if (p.x > fx.width + 10) p.x = -10;
      if (p.y < -10) p.y = fx.height + 10; else if (p.y > fx.height + 10) p.y = -10;

      ctx.fillStyle = `hsla(${p.hue},30%,80%,${p.a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  // FPS guard: reduce particle count if FPS is low for a while
  let last = performance.now(), frames = 0, accum = 0;
  function fpsGuard(now){
    const dt = now - last; last = now;
    accum += dt; frames++;
    if (accum >= 2000) {
      const avg = accum / frames;
      const fps = 1000 / avg;
      if (fps < 45 && particles.length > 40) {
        particles = particles.slice(0, Math.floor(particles.length * 2));
      }
      accum = 0; frames = 0;
    }
    requestAnimationFrame(fpsGuard);
  }
  requestAnimationFrame(fpsGuard);

  // Respect reduced motion
  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (mq && mq.matches) particles = [];
})();

})();

/* eslint-disable no-alert */

const SCREENS = {
  start: document.getElementById('screen-start'),
  camera: document.getElementById('screen-camera'),
  final: document.getElementById('screen-final'),
};

const el = {
  startBtn: document.getElementById('start-btn'),
  bloomLayer: document.getElementById('bloom-layer'),
  video: document.getElementById('video'),
  flash: document.getElementById('flash'),
  countdown: document.getElementById('countdown'),
  shotPill: document.getElementById('shot-pill'),
  cancelBtn: document.getElementById('cancel-btn'),
  captureCanvas: document.getElementById('capture-canvas'),
  stripImg: document.getElementById('strip-img'),
  printImg: document.getElementById('print-img'),
  printBtn: document.getElementById('print-btn'),
  saveBtn: document.getElementById('save-btn'),
  restartBtn: document.getElementById('restart-btn'),
  uploadStatus: document.getElementById('upload-status'),
};

const CONFIG = {
  bloomMs: 2000,
  captureBufferMs: 2000,
  countdownSeconds: 10,
  shots: 4,
  // 16:9 landscape capture target
  captureWidth: 1920,
  captureHeight: 1080,
  // Print composition sizing
  // Strip: 2×6 inches (vertical)
  // Print sheet: 4×6 inches (two strips side-by-side)
  dpi: 300,
  stripInches: { w: 2, h: 6 },
  sheetInches: { w: 4, h: 6 },
  photoInches: { w: 1.15, h: 1.25 },
};

let mediaStream = null;
let wakeLock = null;
let cancelled = false;
/** @type {string[]} */
let shots = [];
/** @type {string|null} */
let compositeDataUrl = null;
/** @type {string|null} */
let printableDataUrl = null;

function setScreen(active) {
  Object.values(SCREENS).forEach((s) => s.classList.remove('screen--active'));
  SCREENS[active].classList.add('screen--active');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function flashOnce() {
  if (!el.flash) return;
  el.flash.classList.add('is-on');
  await sleep(70);
  el.flash.classList.remove('is-on');
}

async function showReadyBuffer() {
  el.countdown.classList.add('is-ready');
  el.countdown.textContent = 'Get ready...';
  await sleep(CONFIG.captureBufferMs);
  el.countdown.classList.remove('is-ready');
}

async function tryLockOrientationLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch {
    // iOS Safari often blocks this; safe to ignore.
  }
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && navigator.wakeLock && navigator.wakeLock.request) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {});
    }
  } catch {
    // Not supported / denied.
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release?.();
  } catch {
    // ignore
  } finally {
    wakeLock = null;
  }
}

function cleanupBloom() {
  el.bloomLayer.innerHTML = '';
}

function bloomFromButton(btn) {
  cleanupBloom();
  const rect = btn.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;

  const count = 18;
  for (let i = 0; i < count; i += 1) {
    const d = document.createElement('div');
    d.className = `bloom b${(i % 4) + 1}`;

    const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.6 - 0.3);
    const radius = 240 + Math.random() * 420;
    const dx = Math.cos(angle) * radius;
    const dy = Math.sin(angle) * radius * 0.72;
    const rot = `${Math.round(-30 + Math.random() * 60)}deg`;

    d.style.left = `${originX}px`;
    d.style.top = `${originY}px`;
    d.style.setProperty('--dx', `${dx}px`);
    d.style.setProperty('--dy', `${dy}px`);
    d.style.setProperty('--rot', rot);
    d.style.animation = `bloomOut ${CONFIG.bloomMs}ms cubic-bezier(.16,.9,.2,1) forwards`;
    d.style.animationDelay = `${Math.random() * 160}ms`;

    const size = 64 + Math.random() * 72;
    d.style.width = `${size}px`;
    d.style.height = `${size}px`;

    el.bloomLayer.appendChild(d);
  }
}

async function ensureCamera() {
  if (mediaStream) return;

  const constraints = {
    video: {
      facingMode: 'user',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  };

  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  el.video.srcObject = mediaStream;

  await new Promise((resolve) => {
    el.video.onloadedmetadata = () => resolve();
  });

  await el.video.play();
}

function stopCamera() {
  if (!mediaStream) return;
  mediaStream.getTracks().forEach((t) => t.stop());
  mediaStream = null;
}

function drawVideoFrame16x9(ctx, video, w, h) {
  // cover-crop video into 16:9 w×h
  const vw = video.videoWidth || 1920;
  const vh = video.videoHeight || 1080;
  const targetAR = w / h;
  const videoAR = vw / vh;

  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;

  if (videoAR > targetAR) {
    // video wider than target; crop sides
    sw = Math.round(vh * targetAR);
    sx = Math.round((vw - sw) / 2);
  } else if (videoAR < targetAR) {
    // video taller than target; crop top/bottom
    sh = Math.round(vw / targetAR);
    sy = Math.round((vh - sh) / 2);
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
}

function captureShotDataUrl() {
  const canvas = el.captureCanvas;
  canvas.width = CONFIG.captureWidth;
  canvas.height = CONFIG.captureHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('Canvas unavailable');

  drawVideoFrame16x9(ctx, el.video, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function runCountdown(seconds, onTick) {
  for (let t = seconds; t >= 0; t -= 1) {
    if (cancelled) return false;
    onTick(t);
    if (t > 0) await sleep(1000);
  }
  return true;
}

async function captureFlow() {
  cancelled = false;
  shots = [];
  compositeDataUrl = null;
  el.uploadStatus.textContent = '';

  setScreen('camera');
  await ensureCamera();

  for (let i = 0; i < CONFIG.shots; i += 1) {
    el.shotPill.textContent = `Photo ${i + 1} of ${CONFIG.shots}`;
    el.countdown.textContent = String(CONFIG.countdownSeconds);

    const ok = await runCountdown(CONFIG.countdownSeconds, (t) => {
      el.countdown.textContent = String(t);
    });
    if (!ok) return;

    // Capture on 0
    const dataUrl = captureShotDataUrl();
    shots.push(dataUrl);

    await flashOnce();

    if (i < CONFIG.shots - 1) {
      await showReadyBuffer();
    }
  }

  stopCamera();
  await buildCompositeAndShow();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function px(inches) {
  return Math.round(inches * CONFIG.dpi);
}

function drawFrameCover(ctx, frameImg, outW, outH) {
  // Scale the (vertical) frame to cover the 2×6 output.
  const scale = Math.max(outW / frameImg.width, outH / frameImg.height);
  const dw = frameImg.width * scale;
  const dh = frameImg.height * scale;
  const dx = (outW - dw) / 2;
  const dy = (outH - dh) / 2;
  ctx.drawImage(frameImg, dx, dy, dw, dh);
}

async function buildStripCanvas() {
  const outW = px(CONFIG.stripInches.w);
  const outH = px(CONFIG.stripInches.h);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  // Base background
  ctx.fillStyle = '#fbf4dc';
  ctx.fillRect(0, 0, outW, outH);

  // Layout in "design" pixels, then scale to physical strip size.
  // Design spec (from product requirements):
  // - Each photo logical size: 500×350
  // - Vertical spacing between photos: 33
  // - Header above first photo: 57
  // - Footer below last photo: 235
  const DESIGN = {
    photoW: 500,
    photoH: 350,
    gap: 33,
    header: 57,
    footer: 235,
  };
  const designTotalH = DESIGN.header + DESIGN.photoH * 4 + DESIGN.gap * 3 + DESIGN.footer;

  // Use a uniform scale so proportions match design exactly and
  // the full height maps into the physical 2×6 strip.
  const scale = outH / designTotalH;

  const photoW = DESIGN.photoW * scale;
  const photoH = DESIGN.photoH * scale;
  const gap = DESIGN.gap * scale;
  const header = DESIGN.header * scale;
  const radius = Math.max(18, Math.round(photoW * 0.06));

  const x = Math.round((outW - photoW) / 2);
  const startY = header;

  for (let i = 0; i < 4; i += 1) {
    let y = startY + i * (photoH + gap);
    // Nudge the third captured image (index 2) down by 6 logical pixels
    // (after previous adjustments), scaled into strip space. Shift all
    // rows at or below that index so spacing between photos stays even.
    if (i >= 2) {
      y += 6 * scale;
    }
    const img = await loadImage(shots[i]);

    ctx.save();
    roundRect(ctx, x, y, photoW, photoH, radius);
    ctx.clip();
    // Fill the photo slot (cover-crop the landscape photo into the portrait-ish slot)
    drawCover(ctx, img, x, y, photoW, photoH);
    ctx.restore();
  }

  // Frame overlay (your provided frame fits this vertical strip concept well)
  try {
    const frame = await loadImage('./assets/real frame.png');
    drawFrameCover(ctx, frame, outW, outH);
  } catch {
    // If frame missing, keep composite clean.
  }

  return canvas;
}

function drawCover(ctx, img, dx, dy, dw, dh) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(dw / iw, dh / ih);
  const sw = dw / s;
  const sh = dh / s;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

async function buildStripDataUrl() {
  const stripCanvas = await buildStripCanvas();
  return stripCanvas.toDataURL('image/png');
}

async function buildPrintableDataUrlFromStrip(stripCanvas) {
  const outW = px(CONFIG.sheetInches.w);
  const outH = px(CONFIG.sheetInches.h);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  // White page background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  const stripW = px(CONFIG.stripInches.w);
  const stripH = px(CONFIG.stripInches.h);

  // Two identical strips side-by-side: [2×6][2×6] fills 4×6 exactly
  ctx.drawImage(stripCanvas, 0, 0, stripW, stripH);
  ctx.drawImage(stripCanvas, stripW, 0, stripW, stripH);

  return canvas.toDataURL('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function buildCompositeAndShow() {
  setScreen('final');
  const stripCanvas = await buildStripCanvas();
  compositeDataUrl = stripCanvas.toDataURL('image/png');
  printableDataUrl = await buildPrintableDataUrlFromStrip(stripCanvas);

  // Display the 2×6 strip on screen, but print the 4×6 sheet.
  el.stripImg.src = compositeDataUrl;
  el.printImg.src = printableDataUrl;
}

function timestampFilename() {
  const d = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `photobooth_${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}.png`;
}

function shotFilename(index) {
  const d = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `photobooth_shot${index}_${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}.jpg`;
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function saveAllToDevice() {
  // Best-effort: trigger downloads so the user can save into Photos.
  if (!shots.length && !compositeDataUrl) return;

  // Save individual shots first.
  shots.forEach((dataUrl, idx) => {
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, shotFilename(idx + 1));
  });

  // Then save the final composite strip.
  if (compositeDataUrl) {
    downloadDataUrl(compositeDataUrl, timestampFilename());
  }
}

function resetApp() {
  cancelled = true;
  stopCamera();
  releaseWakeLock();
  cleanupBloom();
  setScreen('start');
  shots = [];
  compositeDataUrl = null;
  printableDataUrl = null;
  el.stripImg.removeAttribute('src');
  el.printImg.removeAttribute('src');
  el.uploadStatus.textContent = '';
}

async function startAppFlow() {
  await requestWakeLock();
  await tryLockOrientationLandscape();

  bloomFromButton(el.startBtn);
  await sleep(CONFIG.bloomMs);

  cleanupBloom();
  await captureFlow();
}

// Wire up UI
el.startBtn.addEventListener('click', () => {
  void startAppFlow();
});

el.cancelBtn.addEventListener('click', () => {
  cancelled = true;
  stopCamera();
  resetApp();
});

el.restartBtn.addEventListener('click', () => {
  resetApp();
});

el.printBtn.addEventListener('click', () => {
  window.print();
});

el.saveBtn.addEventListener('click', () => {
  void saveAllToDevice();
});

// iOS Safari: if page is backgrounded, release wake lock
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseWakeLock();
});

// Initial
resetApp();


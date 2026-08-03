"use strict";

/* Picture Frame — Chromebook / web edition.
 * Same behavior as the Windows app: slideshow with configurable interval,
 * periodic folder rescan with newly added pictures shown first, video
 * support, orientation / fit / filler options, settings dialog, controls
 * tooltip, cursor auto-hide. Runs fullscreen and holds a screen wake lock
 * so it works as a kiosk picture frame.
 */

const DEFAULTS = {
  displaySeconds: 180,
  rescanSeconds: 600,
  shuffle: true,
  recursive: true,
  orientation: "landscape",           // landscape | portrait | portrait-flipped
  fitMode: "fit",                     // fit | fill
  background: "white",                // white | black | auto (edge color) | blur (photo bg)
  extensions: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"],
  videoExtensions: [".mp4", ".m4v", ".webm", ".mov"],
};

let settings = loadSettings();
let dirHandle = null;      // FileSystemDirectoryHandle of the photos folder
let staticFiles = null;    // fallback mode (file:// pages): files picked once
                           // via <input webkitdirectory> — no live rescanning
let known = new Set();     // every path seen so far
let playlist = [];         // [{path, handle}]
let pos = -1;
let newQueue = [];         // newly discovered files, shown first
let history = [];
let started = false;
let paused = false;
let advanceTimer = null;
let rescanTimer = null;
let currentUrl = null;     // object URL of the media on screen
let currentItem = null;
let wakeLock = null;

const stage = document.getElementById("stage");
const bgBlur = document.getElementById("bg-blur");
const photo = document.getElementById("photo");
const video = document.getElementById("video");
const message = document.getElementById("message");
const tooltip = document.getElementById("tooltip");
const controls = document.getElementById("controls");
const overlay = document.getElementById("start-overlay");
const dlg = document.getElementById("settings");

/* Diagnostics go to the browser console (F12) only. */
function dlog(msg) {
  console.log(msg);
}

/* ---------- settings persistence ---------- */

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("pf-settings") || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  localStorage.setItem("pf-settings", JSON.stringify(settings));
}

/* ---------- IndexedDB (remembers the chosen folder) ---------- */

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("picture-frame", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- helpers ---------- */

function extOf(name) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function isVideoPath(path) {
  return settings.videoExtensions.includes(extOf(path));
}

function parseExtensions(text) {
  return text.replace(/,/g, " ").split(/\s+/)
    .map(p => p.trim().toLowerCase())
    .filter(p => p && p !== ".")
    .map(p => (p.startsWith(".") ? p : "." + p));
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* ---------- folder scanning ---------- */

async function listFiles(handle, prefix, out, recursive) {
  for await (const entry of handle.values()) {
    if (entry.kind === "file") {
      const ext = extOf(entry.name);
      if (settings.extensions.includes(ext) || settings.videoExtensions.includes(ext)) {
        out.push({ path: prefix + entry.name, handle: entry });
      }
    } else if (entry.kind === "directory" && recursive) {
      await listFiles(entry, prefix + entry.name + "/", out, true);
    }
  }
}

function wantedExt(name) {
  const ext = extOf(name);
  return settings.extensions.includes(ext) || settings.videoExtensions.includes(ext);
}

async function scan(initial) {
  let found;
  if (staticFiles) {
    // Fallback mode: a fixed snapshot of files from <input webkitdirectory>.
    found = staticFiles
      .filter(f => wantedExt(f.name))
      .filter(f => settings.recursive
        || (f.webkitRelativePath || "").split("/").length <= 2)
      .map(f => ({
        path: f.webkitRelativePath || f.name,
        handle: { getFile: async () => f },
      }));
  } else {
    found = [];
    try {
      await listFiles(dirHandle, "", found, settings.recursive);
    } catch (err) {
      console.warn("Folder scan failed:", err);
      return;
    }
  }
  const foundPaths = new Set(found.map(f => f.path));

  // Drop files that were deleted from the folder.
  playlist = playlist.filter(f => foundPaths.has(f.path));
  newQueue = newQueue.filter(f => foundPaths.has(f.path));
  known = new Set([...known].filter(p => foundPaths.has(p)));

  const fresh = found.filter(f => !known.has(f.path));
  fresh.forEach(f => known.add(f.path));

  if (initial) {
    playlist = found;
    if (settings.shuffle) shuffleArray(playlist);
    else playlist.sort((a, b) => a.path.localeCompare(b.path));
    pos = -1;
    newQueue = [];
  } else if (fresh.length) {
    // Newest first, then queue them ahead of the regular rotation.
    for (const f of fresh) {
      try { f.mtime = (await f.handle.getFile()).lastModified; }
      catch { f.mtime = 0; }
    }
    fresh.sort((a, b) => b.mtime - a.mtime);
    newQueue.push(...fresh);
    playlist.push(...fresh);
    console.log(`Found ${fresh.length} new file(s); showing them next.`);
  }
}

async function rescan() {
  if (staticFiles) return;   // snapshot mode: nothing new can be discovered
  await scan(false);
  if (newQueue.length && !paused) next();
}

function restartRescanTimer() {
  clearInterval(rescanTimer);
  rescanTimer = setInterval(rescan, settings.rescanSeconds * 1000);
}

/* ---------- slideshow ---------- */

function pickNext() {
  if (newQueue.length) return newQueue.shift();
  if (!playlist.length) return null;
  pos = (pos + 1) % playlist.length;
  return playlist[pos];
}

function next() {
  showItem(pickNext());
}

function showPrevious() {
  if (history.length < 2) return;
  history.pop();                      // current item
  showItem(history[history.length - 1], { record: false });
}

async function showItem(item, { record = true } = {}) {
  clearTimeout(advanceTimer);
  advanceTimer = null;
  stopVideo();

  if (!item) {
    showMessage("No pictures found in the folder.\nAdd some and they will appear automatically.");
    advanceTimer = setTimeout(next, settings.displaySeconds * 1000);
    return;
  }

  let file;
  try {
    file = await item.handle.getFile();
    dlog(`showing ${item.path} (${Math.round(file.size / 1024)} KB)`);
  } catch (err) {
    dlog(`READ FAILED ${item.path}: ${err.name || err}`);
    mediaFailed();
    return;
  }

  const url = URL.createObjectURL(file);
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = url;
  currentItem = item;
  message.hidden = true;

  if (isVideoPath(item.path)) {
    photo.hidden = true;
    video.hidden = false;
    video.src = url;
    try {
      await video.play();               // advances via its "ended" event
    } catch {
      mediaFailed();
      return;
    }
  } else {
    video.hidden = true;
    photo.hidden = false;
    photo.src = url;
    advanceTimer = setTimeout(next, settings.displaySeconds * 1000);
  }

  if (record) {
    history.push(item);
    if (history.length > 50) history.shift();
  }
}

function stopVideo() {
  if (!video.hidden) {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.hidden = true;
  }
}

function showMessage(text) {
  photo.hidden = true;
  stopVideo();
  message.textContent = text;
  message.style.color = bgTextColor;
  message.hidden = false;
}

/* ---------- auto filler color (sampled from the picture's edges) ---------- */

let autoBgColor = "rgb(128, 128, 128)";
let bgTextColor = "black";   // contrast color for on-screen messages

function edgeColor(source) {
  // Downscale to a tiny canvas and average the border pixels.
  const size = 32;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  try {
    ctx.drawImage(source, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
          const i = (y * size + x) * 4;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
      }
    }
    return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
  } catch {
    return autoBgColor;   // unreadable frame: keep the previous color
  }
}

function isLightColor(color) {
  if (color === "white") return true;
  if (color === "black") return false;
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return true;
  return 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3] >= 140;
}

function applyBackground() {
  const mode = settings.background;
  const bg = mode === "auto" ? autoBgColor
           : mode === "blur" ? "black"      // behind/around the blurred copy
           : mode;
  document.body.style.background = bg;
  bgBlur.hidden = mode !== "blur" || !bgBlur.getAttribute("src");
  bgTextColor = mode === "blur" ? "white" : (isLightColor(bg) ? "black" : "white");
  if (!message.hidden) message.style.color = bgTextColor;
}

/* "blur" filler: a blurred copy of what's on screen fills the background. */
let blurUrl = null;   // object URL of a captured video frame (photos reuse photo.src)

function setBlurBackground(source) {
  if (source === photo) {
    bgBlur.src = photo.src;
    bgBlur.hidden = false;
    return;
  }
  // Video: capture the current frame at small size (it gets blurred anyway).
  try {
    const cv = document.createElement("canvas");
    cv.width = 160;
    cv.height = Math.max(1, Math.round(160 * source.videoHeight / source.videoWidth)) || 90;
    cv.getContext("2d").drawImage(source, 0, 0, cv.width, cv.height);
    cv.toBlob((b) => {
      if (!b) return;
      if (blurUrl) URL.revokeObjectURL(blurUrl);
      blurUrl = URL.createObjectURL(b);
      bgBlur.src = blurUrl;
      bgBlur.hidden = false;
    }, "image/jpeg", 0.7);
  } catch {}
}

function currentMediaEl() {
  if (!video.hidden && video.readyState >= 2) return video;
  if (!photo.hidden && photo.naturalWidth) return photo;
  return null;
}

/* Called whenever new media is on screen (or the filler mode changes). */
function updateFillerForMedia(source) {
  if (!source) return;
  if (settings.background === "auto") {
    autoBgColor = edgeColor(source);
    applyBackground();
  } else if (settings.background === "blur") {
    setBlurBackground(source);
    applyBackground();
  }
}

/* If every file in the playlist fails in a row, say so on screen instead of
 * looping over a blank screen forever. The classic cause: the folder lives
 * in OneDrive/Drive and the files are cloud-only placeholders. */
let failStreak = 0;

function mediaFailed() {
  failStreak++;
  if (playlist.length && failStreak >= Math.max(playlist.length, 3)) {
    showMessage(
      `Found ${playlist.length} file(s) but none of them could be read.\n\n` +
      "If the folder is synced from the cloud (OneDrive / Google Drive), " +
      "make the files available offline\n" +
      "(right-click the folder → “Always keep on this device”), then try again."
    );
    failStreak = 0;
    advanceTimer = setTimeout(next, 10000);
    return;
  }
  advanceTimer = setTimeout(next, 1000);
}

video.addEventListener("ended", () => { if (!paused) next(); });
video.addEventListener("playing", () => {
  failStreak = 0;
  updateFillerForMedia(video);
});
video.addEventListener("error", () => {
  if (started && !video.hidden) mediaFailed();
});
photo.addEventListener("load", () => {
  failStreak = 0;
  updateFillerForMedia(photo);
});
photo.addEventListener("error", () => {
  if (started && !photo.hidden) {
    dlog(`IMAGE DECODE FAILED: ${currentItem ? currentItem.path : "?"}`);
    mediaFailed();
  }
});

function togglePause() {
  if (!started) return;
  paused = !paused;
  if (paused) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
    if (!video.hidden) video.pause();
  } else if (!video.hidden && video.paused && !video.ended) {
    video.play();
  } else {
    next();
  }
  updatePauseButton();
}

/* ---------- appearance ---------- */

function applyAppearance() {
  applyBackground();
  stage.classList.toggle("portrait", settings.orientation === "portrait");
  stage.classList.toggle("portrait-flipped", settings.orientation === "portrait-flipped");
  const fit = settings.fitMode === "fill" ? "cover" : "contain";
  photo.style.objectFit = fit;
  video.style.objectFit = fit;
}

function cycleOrientation() {
  const order = ["landscape", "portrait", "portrait-flipped"];
  settings.orientation = order[(order.indexOf(settings.orientation) + 1) % order.length];
  applyAppearance();
  saveSettings();
}

function toggleFit() {
  settings.fitMode = settings.fitMode === "fit" ? "fill" : "fit";
  applyAppearance();
  saveSettings();
}

function toggleBackground() {
  const order = ["white", "black", "auto", "blur"];
  settings.background = order[(order.indexOf(settings.background) + 1) % order.length];
  updateFillerForMedia(currentMediaEl());   // take effect immediately
  applyAppearance();
  saveSettings();
  if (started) toast(`Filler: ${settings.background}`, 2000);
}

/* ---------- fullscreen + wake lock (kiosk behavior) ---------- */

function enterFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else enterFullscreen();
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && started) requestWakeLock();
});

/* ---------- controls tooltip + cursor auto-hide ---------- */

let tooltipTimer = null;
let cursorTimer = null;
const TOOLTIP_HTML = tooltip.innerHTML;

function hideTooltip() {
  tooltip.hidden = true;
  tooltip.innerHTML = TOOLTIP_HTML;   // clear any toast text
}

function toast(text, ms = 6000) {
  tooltip.textContent = text;
  tooltip.hidden = false;
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(hideTooltip, ms);
}

document.addEventListener("mousemove", () => {
  showControls();
  document.body.classList.remove("no-cursor");
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add("no-cursor"), 5000);
});

/* ---------- touch control bar ---------- */

let controlsTimer = null;

function showControls() {
  if (!started || !overlay.hidden) return;
  controls.hidden = false;
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => { controls.hidden = true; }, 5000);
}

document.addEventListener("touchstart", showControls, { passive: true });

function updatePauseButton() {
  // ⏸ while playing, ▶ while paused
  document.getElementById("btn-pause").textContent = paused ? "▶" : "⏸";
}

const CONTROL_ACTIONS = {
  "btn-prev": () => showPrevious(),
  "btn-pause": () => togglePause(),
  "btn-next": () => next(),
  "btn-full": () => toggleFullscreen(),
  "btn-orient": () => cycleOrientation(),
  "btn-fit": () => toggleFit(),
  "btn-bg": () => toggleBackground(),
  "btn-settings": () => openSettings(),
};
for (const [id, action] of Object.entries(CONTROL_ACTIONS)) {
  document.getElementById(id).addEventListener("click", () => {
    action();
    showControls();   // keep the bar up while it's being used
  });
}

/* Swipe left/right anywhere on the picture = next/previous. */
let swipeStart = null;

stage.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  swipeStart = { x: t.clientX, y: t.clientY };
}, { passive: true });

stage.addEventListener("touchend", (e) => {
  if (!swipeStart || !started) { swipeStart = null; return; }
  const t = e.changedTouches[0];
  const dx = t.clientX - swipeStart.x;
  const dy = t.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
    if (dx < 0) next();
    else showPrevious();
  }
}, { passive: true });

/* ---------- settings dialog ---------- */

function openSettings() {
  document.getElementById("folder-name").textContent = dirHandle ? dirHandle.name : "(not chosen)";
  document.getElementById("f-display").value = settings.displaySeconds;
  document.getElementById("f-rescan").value = settings.rescanSeconds;
  document.getElementById("f-shuffle").checked = settings.shuffle;
  document.getElementById("f-recursive").checked = settings.recursive;
  document.getElementById("f-orientation").value = settings.orientation;
  document.getElementById("f-fit").value = settings.fitMode;
  document.getElementById("f-bg").value = settings.background;
  document.getElementById("f-ext").value = settings.extensions.join(" ");
  document.getElementById("f-vext").value = settings.videoExtensions.join(" ");
  dlg.showModal();
}

document.getElementById("change-folder").addEventListener("click", async () => {
  const handle = await pickDirectory();
  if (handle === "fallback") return;   // dir-input change event takes over
  if (!handle) return;
  dirHandle = handle;
  staticFiles = null;
  currentFolderChanged = true;
  await idbSet("dirHandle", handle).catch(() => {});
  document.getElementById("folder-name").textContent = handle.name;
});

document.getElementById("cancel-btn").addEventListener("click", () => dlg.close());

document.getElementById("save-btn").addEventListener("click", async () => {
  const display = parseInt(document.getElementById("f-display").value, 10);
  const rescanS = parseInt(document.getElementById("f-rescan").value, 10);
  if (!(display >= 1) || !(rescanS >= 1)) {
    alert("Seconds must be positive whole numbers.");
    return;
  }
  const before = JSON.stringify([
    settings.recursive, settings.shuffle, settings.extensions, settings.videoExtensions,
  ]);
  settings.displaySeconds = display;
  settings.rescanSeconds = rescanS;
  settings.shuffle = document.getElementById("f-shuffle").checked;
  settings.recursive = document.getElementById("f-recursive").checked;
  settings.orientation = document.getElementById("f-orientation").value;
  settings.fitMode = document.getElementById("f-fit").value;
  settings.background = document.getElementById("f-bg").value;
  settings.extensions = parseExtensions(document.getElementById("f-ext").value);
  settings.videoExtensions = parseExtensions(document.getElementById("f-vext").value);
  saveSettings();
  applyAppearance();
  dlg.close();

  if (started) {
    restartRescanTimer();
    const after = JSON.stringify([
      settings.recursive, settings.shuffle, settings.extensions, settings.videoExtensions,
    ]);
    if (after !== before || currentFolderChanged) {
      currentFolderChanged = false;
      known.clear();
      history = [];
      await scan(true);
      next();
    }
  }
});

let currentFolderChanged = false;   // set when Change… picks a new folder mid-show

/* ---------- keyboard ---------- */

document.addEventListener("keydown", (e) => {
  if (dlg.open) return;
  if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
  switch (e.key.toLowerCase()) {
    case " ": e.preventDefault(); togglePause(); break;
    case "arrowright": case "n": if (started) next(); break;
    case "arrowleft": case "p": if (started) showPrevious(); break;
    case "f": toggleFullscreen(); break;
    case "r": cycleOrientation(); break;
    case "m": toggleFit(); break;
    case "c": toggleBackground(); break;
    case "e": e.preventDefault(); openSettings(); break;
  }
});

/* ---------- startup ---------- */

async function startShow() {
  dlog("starting show, scanning folder…");
  overlay.hidden = true;
  started = true;
  enterFullscreen();
  requestWakeLock();
  showMessage("Loading pictures…");
  await scan(true);
  dlog(`scan complete: ${playlist.length} file(s) in playlist`);
  if (!playlist.length) {
    showMessage(
      "The chosen folder contains no pictures or videos the frame can show.\n" +
      "Press E to check the folder and file-type settings."
    );
  }
  next();
  restartRescanTimer();

  // If the browser dropped (or never granted) fullscreen — e.g. the folder
  // dialog interrupted it — one click/tap anywhere brings it back.
  setTimeout(() => {
    if (!document.fullscreenElement) {
      toast("Click anywhere (or press F) to go fullscreen");
      const once = () => {
        enterFullscreen();
        document.removeEventListener("click", once);
      };
      document.addEventListener("click", once);
    }
  }, 600);
}

/* Any unexpected failure must be visible, not a silent blank screen. */
function reportError(msg) {
  console.error(msg);
  if (!overlay.hidden) showStartError(String(msg));
  else showMessage("Something went wrong:\n" + msg);
}

window.addEventListener("error", (e) => reportError(e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));

function showStartError(msg) {
  const el = document.getElementById("start-error");
  el.textContent = msg;
  el.hidden = false;
}

/* The live folder API is blocked on pages opened straight from disk
 * (file://). Crucially we must decide this BEFORE calling the API: a failed
 * showDirectoryPicker() call consumes the click's user activation, after
 * which Chrome silently refuses to open the fallback dialog too — the
 * button then appears dead. */
const LIVE_FOLDER_API =
  typeof window.showDirectoryPicker === "function" && location.protocol !== "file:";

/* Returns a directory handle, null (cancelled/denied), or the string
 * "fallback" when the classic <input webkitdirectory> dialog was opened
 * instead (its change event continues the flow). */
async function pickDirectory() {
  if (!LIVE_FOLDER_API) {
    // Synchronously, inside the click's user gesture.
    dlog("opening classic folder dialog (snapshot mode)");
    document.getElementById("dir-input").click();
    return "fallback";
  }
  try {
    dlog("opening live folder picker");
    return await window.showDirectoryPicker();
  } catch (err) {
    if (err.name === "AbortError") { dlog("picker cancelled"); return null; }
    dlog(`live picker failed (${err.name}) — trying classic dialog`);
    document.getElementById("dir-input").click();
    return "fallback";
  }
}

document.getElementById("pick-btn").addEventListener("click", async () => {
  dlog("choose-folder clicked");
  // Claim fullscreen with this click's gesture — the folder dialog's own
  // interaction doesn't count as one, so waiting until after picking fails.
  enterFullscreen();
  const handle = await pickDirectory();
  if (handle === "fallback" || !handle) return;
  dlog(`live folder granted: ${handle.name}`);
  dirHandle = handle;
  staticFiles = null;
  await idbSet("dirHandle", handle).catch(() => {});
  startShow();
});

document.getElementById("dir-input").addEventListener("change", (e) => {
  const files = [...e.target.files].filter(f => wantedExt(f.name));
  dlog(`classic dialog returned ${e.target.files.length} file(s), ${files.length} usable`);
  e.target.value = "";
  if (!files.length) {
    showStartError("That folder has no pictures or videos the frame can show.");
    return;
  }
  staticFiles = files;
  dirHandle = null;
  const rootName = (files[0].webkitRelativePath || "").split("/")[0] || "chosen folder";
  if (dlg.open) {
    // Picked from the settings dialog: apply on Save.
    currentFolderChanged = true;
    document.getElementById("folder-name").textContent = rootName;
    return;
  }
  startShow();
  toast("Folder loaded. Opened as a local file, so newly added pictures "
      + "appear after re-choosing the folder — see the README for the "
      + "full-features setup.", 8000);
});

document.getElementById("resume-btn").addEventListener("click", async () => {
  enterFullscreen();
  const saved = await idbGet("dirHandle").catch(() => null);
  if (!saved) return;
  let perm = await saved.queryPermission({ mode: "read" });
  if (perm !== "granted") perm = await saved.requestPermission({ mode: "read" });
  if (perm !== "granted") {
    showStartError("Folder access was not granted — choose the folder again.");
    return;
  }
  dirHandle = saved;
  staticFiles = null;
  startShow();
});

async function init() {
  dlog(`page loaded: ${location.protocol} live-folder-API=${LIVE_FOLDER_API}`);
  applyAppearance();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const probe = document.createElement("input");
  if (!window.showDirectoryPicker && !("webkitdirectory" in probe)) {
    showStartError("This browser cannot open folders — please use Chrome.");
    document.getElementById("pick-btn").disabled = true;
    return;
  }
  // A remembered folder only exists where the live folder API works.
  if (LIVE_FOLDER_API) {
    const saved = await idbGet("dirHandle").catch(() => null);
    if (saved && saved.queryPermission) {
      const btn = document.getElementById("resume-btn");
      btn.hidden = false;
      btn.textContent = `Resume last folder (${saved.name})`;
    }
  }
}

init();

// Exposed for debugging in the console.
window.__pf = {
  get settings() { return settings; },
  get playlist() { return playlist; },
  get newQueue() { return newQueue; },
  get paused() { return paused; },
  get currentItem() { return currentItem; },
  parseExtensions,
  next,
  showPrevious,
  togglePause,
  scan,
  pickNext,
  setDirHandle(h) { dirHandle = h; },
  setStarted(v) { started = v; },
};

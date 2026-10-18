/* =========================================================
   S&S · DSP 复习本 · app.js
   科目：ss = 信号与系统（连续）/ dsp = 数字信号处理（离散），顶部切换，数据按 subject 字段分区。
   两个视图：q = 错题 / k = 知识点，数据分开存，共用一套标签。
   在基座（数学复习本）之上新增：
     · 学科绘图（plot.js / conv.js）
     · 变换对 / 性质 / 连续↔离散 速查表（transforms.js）
     · 配图编号、顺序调整、卡片大图模式、多图灯箱（翻页/缩放/旋转/拖动）
     · 拖拽与剪贴板粘贴图片、公式快捷插入条、学科预设标签
     · 搜索扩展 has:img、只看有图
     · 学科化 AI 识题提示词
   ========================================================= */

/* ===================== 存储键 =====================
   注意：本站与「数学复习本」可能同源（同为 *.github.io），
   因此 localStorage / IndexedDB 的键名与库名必须完全独立，避免串库。 */
const K_Q = 'sd_items';
const K_K = 'sd_kps';
const K_C_Q = 'sd_collections_q';   // 错题库的合集树
const K_C_K = 'sd_collections_k';   // 知识点库的合集树
const K_SET = 'sd_settings';
const K_TRASH = 'sd_trash';
const K_AI = 'sd_ai';
const K_LASTEXPORT = 'sd_lastexport';
const IDB_NAME = 'sdimg';

/* 纯逻辑统一放在 lib.js（浏览器与单测共用），此处引用即可 */
const {
  SUBJECT, SUBJECT_SHORT,
  STATUS, STATUS_NEXT, uid, normText,
  makeGramProfile, simFromProfile,
  parseText, parseSearch,
  normalizeQuestion, normalizeKp, scheduleSrs, isDue, dueLabel, DAY,
  settleCollections, collectionSubtreeIds, flattenCollections, collectionChildren,
  collectionPath, addCollection, renameCollection, canMoveCollection, moveCollection,
  deleteCollection, collectionCounts, sanitizeItemCollections,
  bareMathSegments,
} = MQ;

/* 学科模块（经典脚本已先行加载，挂到 window 上） */
const MQP = window.MQP || {};   // 绘图
const MQV = window.MQV || {};   // 卷积图解
const MQT = window.MQT || {};   // 速查表
const MQG = window.MQG || {};   // 一键生成（标签驱动，纯本地）

/* ===================== 设置（偏好，与数据分开存） ===================== */
const SET_DEF = {
  cols: 'auto', theme: 'system', density: 'comfortable', anim: 'on',
  imgsize: 'small', subject: 'ss', rail: 'off',
};

function readSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(K_SET));
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}
const settings = Object.assign({}, SET_DEF, readSettings());
if (!SUBJECT[settings.subject]) settings.subject = 'ss';

function saveSettings() {
  try { localStorage.setItem(K_SET, JSON.stringify(settings)); } catch (e) {}
}

const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const effectiveTheme = () => settings.theme === 'system' ? (mqDark.matches ? 'dark' : 'light') : settings.theme;
const effectiveAnim = () => settings.anim === 'off' ? 'off' : (mqMotion.matches ? 'off' : 'on');

// 实际列数：手机（<768）固定 1 列；宽屏按设置，同时不超过屏幕能容纳的列数
function effectiveCols() {
  const w = window.innerWidth;
  if (w < 768) return 1;
  const cap = Math.max(1, Math.floor((w - 48) / 320));
  let want;
  if (settings.cols === 'auto') want = w >= 1440 ? 3 : (w >= 1024 ? 2 : 1);
  else want = parseInt(settings.cols, 10) || 1;
  return Math.min(want, cap);
}

function applySettings() {
  const root = document.documentElement;
  const cols = effectiveCols();
  root.dataset.theme = effectiveTheme();
  root.dataset.density = settings.density;
  root.dataset.anim = effectiveAnim();
  root.dataset.cols = cols;
  root.dataset.imgsize = settings.imgsize;
  root.style.setProperty('--cols', cols);
  root.style.setProperty('--mainw', cols >= 3 ? '1560px' : (cols === 2 ? '1180px' : '840px'));

  document.querySelectorAll('#setCols button').forEach(b => b.classList.toggle('on', b.dataset.cols === settings.cols));
  document.querySelectorAll('#setTheme button').forEach(b => b.classList.toggle('on', b.dataset.theme === settings.theme));
  document.querySelectorAll('#setDensity button').forEach(b => b.classList.toggle('on', b.dataset.density === settings.density));
  document.querySelectorAll('#setAnim button').forEach(b => b.classList.toggle('on', b.dataset.anim === settings.anim));
  document.querySelectorAll('#setImgSize button').forEach(b => b.classList.toggle('on', b.dataset.imgsize === settings.imgsize));

  document.querySelectorAll('#subjectSeg button').forEach(b => {
    const on = b.dataset.subject === settings.subject;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  document.querySelectorAll('#setRail button').forEach(b => b.classList.toggle('on', b.dataset.rail === settings.rail));

  // 宽屏且已「收起」→ 侧栏切成窄竖条；窄屏（<1024）始终是抽屉，不加该类
  if (colTreeEl) {
    colTreeEl.classList.toggle('rail', settings.rail === 'on' && window.innerWidth >= 1024);
    renderColTree();
  }

  const note = document.getElementById('colsNote');
  if (note) {
    note.textContent = window.innerWidth < 768
      ? '当前屏幕较窄，固定 1 列（把窗口拉宽或平板横屏后可多列）。'
      : `当前实际显示 ${cols} 列。`;
  }
}

/* ===================== 通用小工具 ===================== */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function copyText(text) {
  const s = String(text == null ? '' : text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(s).then(() => true, () => legacyCopy(s));
  }
  return Promise.resolve(legacyCopy(s));
}
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}
function moveInArray(arr, dir, id) {
  const i = arr.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return arr.slice();
  const out = arr.slice();
  out[i] = arr[j];
  out[j] = arr[i];
  return out;
}

/* ===================== 图片 / 文本持久化（IndexedDB；文本在 IDB 不可用时回退 localStorage） ===================== */
let idbPromise = null;
function idb() {
  if (!idbPromise) {
    idbPromise = new Promise((res, rej) => {
      const rq = indexedDB.open(IDB_NAME, 2);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('imgs')) db.createObjectStore('imgs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  return idbPromise;
}
async function idbPut(rec) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('imgs', 'readwrite');
    tx.objectStore('imgs').put(rec);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(id) {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction('imgs', 'readonly').objectStore('imgs').get(id);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(id) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('imgs', 'readwrite');
    tx.objectStore('imgs').delete(id);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function idbKeys() {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction('imgs', 'readonly').objectStore('imgs').getAllKeys();
    rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error);
  });
}
// base64（不含前缀）→ Blob，用于从完整备份还原图片
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: type || 'image/jpeg' });
}
// 仍被引用（含回收站）的图片 id 集合，用于清理孤儿图片
function referencedImageIds() {
  const s = new Set();
  const add = list => list.forEach(it => (it.images || []).forEach(id => s.add(id)));
  add(stores.q.items); add(stores.k.items); add(trash.map(t => t.item));
  return s;
}
async function gcImages() {
  try {
    const keep = referencedImageIds();
    const keys = await idbKeys();
    const gone = keys.filter(k => !keep.has(k));
    for (const k of gone) await idbDel(k);
    return gone.length;
  } catch (e) { return 0; }
}

const imgCache = new Map(); // id -> objectURL
async function imgUrl(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  try {
    const rec = await idbGet(id);
    if (!rec || !rec.blob) return null;
    const u = URL.createObjectURL(rec.blob);
    imgCache.set(id, u);
    return u;
  } catch (e) { return null; }
}
function hydrateImages(root) {
  root.querySelectorAll('img[data-img-id]').forEach(el => {
    imgUrl(el.dataset.imgId).then(u => {
      if (u) el.src = u; else el.classList.add('broken');
    });
  });
}
function dropImage(id) {
  const u = imgCache.get(id);
  if (u) { URL.revokeObjectURL(u); imgCache.delete(id); }
  idbDel(id).catch(() => {});
}

// 压缩：默认最长边 1600、JPEG 0.85；小图或压缩后反而更大则保留原图
function compressImage(file, maxSide, quality) {
  const limit = maxSide || 1600;
  const q = quality || 0.85;
  return new Promise(resolve => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, limit / Math.max(w, h));
      if (scale === 1 && file.size <= 200 * 1024) { URL.revokeObjectURL(url); return resolve(file); }
      const outW = Math.max(1, Math.round(w * scale));
      const outH = Math.max(1, Math.round(h * scale));
      const cv = document.createElement('canvas');
      cv.width = outW; cv.height = outH;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(img, 0, 0, outW, outH);
      URL.revokeObjectURL(url);
      cv.toBlob(b => resolve(b && b.size < file.size ? b : file), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function attachImages(item, files) {
  let added = 0;
  for (const f of files) {
    const blob = await compressImage(f);
    if (!blob) continue;
    const id = 'img_' + uid();
    await idbPut({ id, blob, type: blob.type || 'image/jpeg', size: blob.size || 0, addedAt: Date.now() });
    item.images = (item.images || []).concat(id);
    added++;
  }
  return added;
}

// 卡片里的配图条：带编号（图1、图2…），与解析中的 [图1] 引用一一对应
const imgStrip = it => (it.images && it.images.length)
  ? `<div class="imgs">${it.images.map((id, i) =>
      `<div class="thumb-wrap"><img class="thumb" data-img-id="${esc(id)}" alt="配图" loading="lazy"><span class="thumb-num">图${i + 1}</span></div>`
    ).join('')}</div>`
  : '';

/* 缩略图编辑区：编号 + 前移/后移 + 删除。onMove(dir, id) 可选。 */
function renderThumbs(box, ids, onDelete, onMove) {
  if (!ids.length) { box.innerHTML = '<span class="section-label">还没有图片</span>'; return; }
  box.innerHTML = ids.map((id, i) => `
    <div class="thumb-wrap">
      <img class="thumb" data-img-id="${esc(id)}" alt="配图">
      <span class="thumb-num">图${i + 1}</span>
      ${onMove ? `<div class="thumb-move">
        <button type="button" data-mv="-1" title="前移" ${i === 0 ? 'disabled' : ''}>‹</button>
        <button type="button" data-mv="1" title="后移" ${i === ids.length - 1 ? 'disabled' : ''}>›</button>
      </div>` : ''}
      ${onDelete ? `<button class="thumb-del" data-del="${esc(id)}" title="移除">×</button>` : ''}
    </div>`).join('');
  hydrateImages(box);
  if (onDelete) box.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = e => { e.stopPropagation(); onDelete(b.dataset.del); };
  });
  if (onMove) box.querySelectorAll('[data-mv]').forEach(b => {
    b.onclick = e => { e.stopPropagation(); onMove(b.dataset.mv === '1' ? 1 : -1, b.closest('.thumb-wrap').querySelector('[data-img-id]').dataset.imgId, +b.closest('.thumb-wrap').dataset); };
  });
}
// 由外部传入的移动回调真正需要的是 id，这里从 DOM 取（见上）；再补一层包装，简化调用
function moveThumb(dir, id, setter) { setter(moveInArray(setter.value, dir, id)); }

/* ---------- 从拖拽 / 剪贴板取图片文件 ---------- */
function filesFromDataTransfer(dt) {
  if (!dt) return [];
  const out = [];
  if (dt.items && dt.items.length) {
    [...dt.items].forEach(it => {
      if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f); }
    });
  }
  if (!out.length && dt.files) [...dt.files].forEach(f => out.push(f));
  return out.filter(f => f && f.type && f.type.startsWith('image/'));
}
function bindDropzone(el, onFiles) {
  if (!el) return;
  const over = e => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); };
  ['dragenter', 'dragover'].forEach(ev => el.addEventListener(ev, over));
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('over');
    const fs = filesFromDataTransfer(e.dataTransfer);
    if (!fs.length) return;
    el.classList.add('pasted');
    setTimeout(() => el.classList.remove('pasted'), 700);
    onFiles(fs);
  });
}

/* ---------- 图片查看：多图翻页 + 缩放 + 旋转 + 拖动 ---------- */
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxStage = document.getElementById('lightboxStage');
const lightboxBar = lightbox.querySelector('.lightbox-bar');
const lbIndexEl = document.getElementById('lbIndex');
const lb = { list: [], idx: 0, scale: 1, rot: 0, tx: 0, ty: 0, count: 0 };

function lbApply() {
  lightboxImg.style.transform = `translate(${lb.tx}px, ${lb.ty}px) scale(${lb.scale}) rotate(${lb.rot}deg)`;
  lightboxImg.classList.toggle('zoomed', lb.scale > 1.01);
}
function lbShow() {
  const id = lb.list[lb.idx];
  imgUrl(id).then(u => {
    lightboxImg.src = u || '';
    lightboxImg.style.display = u ? '' : 'none';
  });
  lbIndexEl.textContent = lb.list.length ? `图 ${lb.idx + 1} / ${lb.list.length}` : '';
  const multi = lb.list.length > 1;
  document.getElementById('lbPrev').disabled = !multi;
  document.getElementById('lbNext').disabled = !multi;
  lbApply();
}
function openLightbox(list, index) {
  const arr = (list || []).filter(Boolean);
  if (!arr.length) return;
  lb.list = arr;
  lb.idx = Math.max(0, Math.min(arr.length - 1, index || 0));
  lb.scale = 1; lb.rot = 0; lb.tx = 0; lb.ty = 0;
  lbShow();
  lightbox.classList.add('open');
}
function lbGo(d) {
  if (lb.list.length < 2) return;
  lb.idx = (lb.idx + d + lb.list.length) % lb.list.length;
  lb.scale = 1; lb.rot = 0; lb.tx = 0; lb.ty = 0;
  lbShow();
}
function lbZoom(f) {
  lb.scale = Math.max(0.25, Math.min(8, lb.scale * f));
  lbApply();
}
function lbReset() { lb.scale = 1; lb.rot = 0; lb.tx = 0; lb.ty = 0; lbApply(); }
function lbClose() {
  lightbox.classList.remove('open');
  lightboxImg.src = '';
  lb.list = [];
}
document.getElementById('lightboxClose').onclick = lbClose;
document.getElementById('lbPrev').onclick = () => lbGo(-1);
document.getElementById('lbNext').onclick = () => lbGo(1);
document.getElementById('lbZoomIn').onclick = () => lbZoom(1.25);
document.getElementById('lbZoomOut').onclick = () => lbZoom(0.8);
document.getElementById('lbRotate').onclick = () => { lb.rot = (lb.rot + 90) % 360; lbApply(); };
document.getElementById('lbReset').onclick = lbReset;
lightbox.onclick = e => { if (e.target === lightbox || e.target === lightboxStage) lbClose(); };
lightboxStage.addEventListener('wheel', e => { e.preventDefault(); lbZoom(e.deltaY < 0 ? 1.12 : 0.9); }, { passive: false });

let lbDrag = null;
lightboxImg.addEventListener('pointerdown', e => {
  lbDrag = { x: e.clientX, y: e.clientY, tx: lb.tx, ty: lb.ty, moved: false };
  if (lightboxImg.setPointerCapture) { try { lightboxImg.setPointerCapture(e.pointerId); } catch (err) {} }
});
lightboxImg.addEventListener('pointermove', e => {
  if (!lbDrag) return;
  const dx = e.clientX - lbDrag.x, dy = e.clientY - lbDrag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) lbDrag.moved = true;
  if (lbDrag.moved) { lb.tx = lbDrag.tx + dx; lb.ty = lbDrag.ty + dy; lbApply(); }
});
lightboxImg.addEventListener('pointerup', () => {
  if (lbDrag && !lbDrag.moved) lbZoom(lb.scale > 1.01 ? 1 / lb.scale : 2);
  lbDrag = null;
});
lightboxImg.addEventListener('pointercancel', () => { lbDrag = null; });

function scopeImages(scope) {
  return [...scope.querySelectorAll('img[data-img-id]')].map(x => x.dataset.imgId);
}
// 统一打开：找最近的「图片容器」以支持同一条目内多图翻页
function openFromThumb(el, id) {
  const scope = el.closest('.imgs, .thumbs, .cram-card, .pvi, #randomBody, .print-area') || document;
  const ids = scopeImages(scope);
  const hit = ids.indexOf(id);
  openLightbox(ids.length ? ids : [id], hit >= 0 ? hit : 0);
}
document.addEventListener('click', e => {
  if (!e.target || !e.target.closest) return;
  const fig = e.target.closest('.figref');
  if (fig) {
    const scope = fig.closest('.card, .cram-card, .pvi, #randomBody, .print-area') || document;
    const ids = scopeImages(scope);
    const hit = ids.indexOf(fig.dataset.fig);
    openLightbox(ids.length ? ids : [fig.dataset.fig], hit >= 0 ? hit : 0);
    return;
  }
  const t = e.target.closest('img.thumb');
  if (t && t.dataset.imgId) openFromThumb(t, t.dataset.imgId);
});

/* ---------- 回收站（软删除，30 天自动清理） ---------- */
const TRASH_DAYS = 30;
let trash = []; // 启动时由 loadInitial 从 IndexedDB 载入
function saveTrash() { persist(K_TRASH, trash); }
function updateTrashCount() {
  const el = document.getElementById('trashCount');
  if (el) el.textContent = trash.length;
}
function toTrash(kind, item) {
  trash.unshift({ kind, item, deletedAt: Date.now() });
  saveTrash();
  updateTrashCount();
}
function purgeTrash() {
  const limit = TRASH_DAYS * 24 * 3600 * 1000;
  const keep = [], gone = [];
  for (const t of trash) (Date.now() - t.deletedAt > limit ? gone : keep).push(t);
  if (!gone.length) return;
  trash = keep;
  saveTrash();
  gone.forEach(t => (t.item.images || []).forEach(dropImage));
}
function purgeTrashOne(i) {
  const t = trash[i];
  if (!t) return;
  (t.item.images || []).forEach(dropImage);
  trash.splice(i, 1);
  saveTrash();
  updateTrashCount();
}
function restoreTrashOne(i) {
  const t = trash[i];
  if (!t) return;
  const kind = t.kind === 'k' ? 'k' : 'q';
  stores[kind].items.push(stores[kind].norm(t.item));
  saveStore(stores[kind].key, stores[kind].items);
  trash.splice(i, 1);
  saveTrash();
  updateTrashCount();
  refreshTagPicker();
  render();
}

const trashModal = document.getElementById('trashModal');
function renderTrash() {
  const box = document.getElementById('trashList');
  if (!trash.length) {
    box.innerHTML = '<div class="empty" style="padding:24px 0">回收站是空的。</div>';
    return;
  }
  box.innerHTML = trash.map((t, i) => {
    const isK = t.kind === 'k';
    const title = isK ? (t.item.title || '（无名称）') : (t.item.stem || '（无题目）');
    const days = Math.floor((Date.now() - t.deletedAt) / 86400000);
    const sub = SUBJECT_SHORT[t.item.subject] || '—';
    return `<div class="pvi">
      <div class="section-label" style="margin-bottom:6px">${isK ? '知识点' : '错题'} · ${esc(sub)} · 删除于 ${days > 0 ? days + ' 天前' : '今天'}</div>
      <div class="stem">${renderMath(title, t.item.images)}</div>
      ${t.item.images && t.item.images.length ? `<div class="imgs">${t.item.images.map((id, k) => `<div class="thumb-wrap"><img class="thumb" data-img-id="${esc(id)}" alt="配图"><span class="thumb-num">图${k + 1}</span></div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:8px">
        <button data-restore="${i}">恢复</button>
        <button class="danger" data-purge="${i}">彻底删除</button>
      </div>
    </div>`;
  }).join('');
  hydrateImages(box);
  box.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => { restoreTrashOne(+b.dataset.restore); renderTrash(); });
  box.querySelectorAll('[data-purge]').forEach(b => b.onclick = () => {
    if (confirm('彻底删除，无法恢复。确定？')) { purgeTrashOne(+b.dataset.purge); renderTrash(); }
  });
}
document.getElementById('openTrash').onclick = () => {
  settingsDrawer.classList.remove('open');
  renderTrash();
  trashModal.classList.add('open');
};
document.getElementById('trashClose').onclick = () => trashModal.classList.remove('open');
trashModal.onclick = e => { if (e.target === trashModal) trashModal.classList.remove('open'); };
document.getElementById('trashEmpty').onclick = () => {
  if (!trash.length) return;
  if (!confirm(`彻底删除回收站里的全部 ${trash.length} 项？无法恢复。`)) return;
  trash.forEach(t => (t.item.images || []).forEach(dropImage));
  trash = [];
  saveTrash();
  updateTrashCount();
  renderTrash();
};

/* ---------- 重复检测（bigram 预编译；批量导入时复用同一索引） ---------- */
function dupKey(kind) { return kind === 'k' ? 'title' : 'stem'; }

function buildDupIndex(kind) {
  const key = dupKey(kind);
  const out = [];
  for (const it of stores[kind].items) {
    const p = makeGramProfile(it[key]);
    if (p.len) out.push({ item: it, profile: p });
  }
  return out;
}
function findDupIn(index, value) {
  if (!normText(value)) return null;
  let best = null;
  for (const p of index) {
    const s = simFromProfile(p.profile, value);
    if (s >= 0.85 && (!best || s > best.score)) best = { score: s, item: p.item };
  }
  return best;
}
function countDups(kind, incoming) {
  const key = dupKey(kind);
  const index = buildDupIndex(kind);
  let n = 0;
  for (const o of incoming) {
    const val = o && o[key];
    if (!normText(val)) continue;
    if (findDupIn(index, val)) n++;
  }
  return n;
}

/* ---------- 持久化：优先 IndexedDB（容量大），不可用时回退 localStorage ---------- */
const KV_STORE = 'kv';
function lsRead(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return undefined; } }
function lsWrite(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }

async function idbKVGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).get(key);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
async function idbKVPut(key, json) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(KV_STORE, 'readwrite');
    tx.objectStore(KV_STORE).put({ key, json });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function kvGet(key) {
  try {
    const rec = await idbKVGet(key);
    return rec === undefined ? undefined : JSON.parse(rec.json);
  } catch (e) { return lsRead(key); }
}
async function persist(key, val) {
  try {
    await idbKVPut(key, JSON.stringify(val));
    localStorage.removeItem(key); // 迁移到 IDB 后释放 localStorage 空间
    return true;
  } catch (e) {
    if (lsWrite(key, val)) return true;
    alert('本地存储写入失败（可能是隐私模式或空间不足），建议先「导出」备份。');
    return false;
  }
}
function saveStore(key, list) { return persist(key, list); }

/* ===================== 种子数据（S&S / DSP 各两条例） ===================== */
function seedQuestions() {
  const now = Date.now();
  return [
    {
      id: uid(), subject: 'ss', status: 'new', tags: ['卷积', '阶跃信号', '因果系统'],
      createdAt: now, updatedAt: now,
      stem: '设 $x(t)=\\mathrm{u}(t)-\\mathrm{u}(t-2)$，$h(t)=e^{-t}\\mathrm{u}(t)$，求卷积 $y(t)=x(t)*h(t)$。',
      analysis: [
        '$y(t)=\\int_{-\\infty}^{\\infty}x(\\tau)h(t-\\tau)\\,d\\tau$，其中 $h(t-\\tau)=e^{-(t-\\tau)}\\mathrm{u}(t-\\tau)$。',
        '当 $0<t<2$ 时：$y(t)=\\int_{0}^{t}e^{-(t-\\tau)}d\\tau=1-e^{-t}$；',
        '当 $t\\ge 2$ 时：$y(t)=\\int_{0}^{2}e^{-(t-\\tau)}d\\tau=e^{-t}(e^{2}-1)$；',
        '$t<0$ 时 $y(t)=0$。',
      ].join('\n'),
      knowledge: '卷积积分“翻褶—平移—相乘—积分”四步法；含 $\mathrm{u}$ 的因果信号相乘时，要注意两个阶跃函数共同限定的积分区间（分段点由分段信号边界给出）。',
      myAnswer: '',
    },
    {
      id: uid(), subject: 'ss', status: 'reviewing', tags: ['拉普拉斯变换', '稳定性', '零极点'],
      createdAt: now, updatedAt: now,
      stem: '某因果 LTI 系统 $H(s)=\\dfrac{s+2}{s^{2}+2s+5}$，判断系统是否稳定，并说明理由。',
      analysis: [
        '分母 $s^{2}+2s+5=0$ 的根为 $s=-1\\pm 2j$，两个极点实部均为 $-1<0$。',
        '因果系统稳定的判据：所有极点位于 $s$ 左半平面。',
        '此处全部极点实部为负，故系统**稳定**（收敛域 $\\mathrm{Re}\\{s\\}>-1$，包含虚轴）。',
      ].join('\n'),
      knowledge: '因果系统稳定 ⟺ 全部极点位于左半平面（连续）/ 单位圆内（离散）。收敛域包含虚轴（$j\\omega$ 轴）即稳定；因果性要求收敛域在极点最右侧。',
      myAnswer: '',
    },
    {
      id: uid(), subject: 'dsp', status: 'new', tags: ['Z变换', '收敛域', '几何序列'],
      createdAt: now, updatedAt: now,
      stem: '求序列 $x[n]=0.8^{\\,n}\\mathrm{u}[n]$ 的 Z 变换 $X(z)$ 与收敛域。',
      analysis: [
        '$X(z)=\\sum_{n=0}^{\\infty}0.8^{n}z^{-n}=\\sum_{n=0}^{\\infty}(0.8z^{-1})^{n}$。',
        '当 $|0.8z^{-1}|<1$ 即 $|z|>0.8$ 时级数收敛，得',
        '$X(z)=\\dfrac{1}{1-0.8z^{-1}}=\\dfrac{z}{z-0.8}$，收敛域 $|z|>0.8$。',
      ].join('\n'),
      knowledge: '几何序列对：$a^{n}\\mathrm{u}[n]\\leftrightarrow\\dfrac{z}{z-a}$（$|z|>|a|$）。极点在 $z=a$，收敛域为极点外侧；因果序列的收敛域总是某圆外区域。',
      myAnswer: '',
    },
    {
      id: uid(), subject: 'dsp', status: 'reviewing', tags: ['DFT', '频谱', 'FFT'],
      createdAt: now, updatedAt: now,
      stem: '对 8 点序列 $x[n]=\\{1,1,1,1,0,0,0,0\\}$ 求 8 点 DFT 的幅度谱，并说明它和 DTFT 的关系。',
      analysis: [
        '$X[k]=\\sum_{n=0}^{7}x[n]e^{-j2\\pi kn/8}=\\sum_{n=0}^{3}e^{-j2\\pi kn/8}$。',
        '当 $k=0$ 时 $X[0]=4$；$k\\neq 0$ 时为有限等比和，$|X[k]|=\\left|\\dfrac{\\sin(\\pi k/2)}{\\sin(\\pi k/8)}\\right|$。',
        '$X[k]$ 是 DTFT $X(e^{j\\omega})$ 在 $\\omega=2\\pi k/8$ 上的 $N$ 点等间隔采样。',
      ].join('\n'),
      knowledge: 'N 点 DFT 是 DTFT 在 $[0,2\\pi)$ 上的 N 点等间隔取样：$X[k]=X(e^{j\\omega})\\big|_{\\omega=2\\pi k/N}$。补零只能加密取样点（谱更“光滑”），**不提高真实分辨率**；真实分辨率由观测时长决定。',
      myAnswer: '',
    },
  ];
}

function seedKps() {
  const now = Date.now();
  return [
    {
      id: uid(), subject: 'ss', status: 'new', tags: ['抽样定理', '频谱混叠'],
      createdAt: now, updatedAt: now,
      title: '抽样定理（奈奎斯特）',
      content: [
        '若 $x(t)$ 为带限信号，最高频率为 $f_m$，当抽样频率',
        '$$f_s>2f_m$$',
        '时，可由样值序列无失真地恢复原信号；否则发生**频谱混叠**。',
        '恢复：理想低通滤波，截止频率取 $f_m<f_c<f_s-f_m$。',
        '注意：抽样在频域表现为频谱以 $\\omega_s=2\\pi f_s$ 为周期延拓。',
      ].join('\n'),
    },
    {
      id: uid(), subject: 'ss', status: 'reviewing', tags: ['卷积定理', '变换性质'],
      createdAt: now, updatedAt: now,
      title: '卷积定理与时域↔频域对偶',
      content: [
        '时域卷积 $x(t)*h(t)\\leftrightarrow X(j\\omega)H(j\\omega)$；',
        '时域相乘 $x(t)h(t)\\leftrightarrow\\dfrac{1}{2\\pi}X(j\\omega)*H(j\\omega)$。',
        '应用：LTI 系统 $Y(j\\omega)=X(j\\omega)H(j\\omega)$（相乘），理想滤波即频域取窗；调制即频域搬移。',
      ].join('\n'),
    },
    {
      id: uid(), subject: 'dsp', status: 'new', tags: ['Z变换', '稳定性', '单位圆'],
      createdAt: now, updatedAt: now,
      title: '单位圆与因果稳定判据',
      content: [
        'Z 变换在 $z=e^{j\\omega}$（单位圆）上取值即 DTFT $X(e^{j\\omega})$。',
        '因果系统稳定 ⟺ 全部极点在单位圆内（$|z|<1$）；此时收敛域包含单位圆。',
        '频率响应 $H(e^{j\\omega})$ 可看作 $z$ 平面单位圆上的取值，极点靠近单位圆→该频率处出现峰值。',
      ].join('\n'),
    },
    {
      id: uid(), subject: 'dsp', status: 'new', tags: ['DTFT', 'DFT', '频率分辨率'],
      createdAt: now, updatedAt: now,
      title: 'DFT 与加窗、补零的区别',
      content: [
        '对有限长序列取 N 点 DFT，相当于在频域对 DTFT 等间隔取样。',
        '**加窗**：把无限长（或长）序列截断为 N 点，频域被窗谱卷积 → 产生拖尾/泄漏，真实分辨率由窗主瓣宽度（≈ 观测时长）决定。',
        '**补零**：只在频率轴上加密取样点，让曲线更连贯，**不改变真实分辨率**。',
      ].join('\n'),
    },
  ];
}

const stores = {
  q: { key: K_Q, norm: normalizeQuestion, items: [] },
  k: { key: K_K, norm: normalizeKp, items: [] },
};

/* 合集树：错题、知识点各一棵（与标签并存，互不影响） */
const colStores = { q: [], k: [] };
const colKey = kind => kind === 'k' ? K_C_K : K_C_Q;
const saveCols = kind => persist(colKey(kind), colStores[kind]);
// 合集树/未分类在侧栏里作为「虚拟节点」的筛选值
const COL_ALL = '__all__';

// 启动时从 IndexedDB 载入（并把旧版 localStorage 数据迁移过来）
async function loadInitial() {
  for (const kind of ['q', 'k']) {
    const key = stores[kind].key;
    let raw = await kvGet(key);
    if (!Array.isArray(raw)) raw = lsRead(key);
    if (Array.isArray(raw)) {
      stores[kind].items = raw.map(stores[kind].norm);
    } else {
      stores[kind].items = (kind === 'q' ? seedQuestions() : seedKps()).map(stores[kind].norm);
    }
    await persist(key, stores[kind].items);
  }
  // 合集树（两库各一棵）
  for (const kind of ['q', 'k']) {
    const key = colKey(kind);
    let raw = await kvGet(key);
    if (!Array.isArray(raw)) raw = lsRead(key);
    colStores[kind] = settleCollections(Array.isArray(raw) ? raw : []);
    await persist(key, colStores[kind]);
    // 把指向已不存在合集的条目纠正为「未分类」，保证筛选与计数口径一致
    if (sanitizeItemCollections(stores[kind].items, colStores[kind])) await persist(stores[kind].key, stores[kind].items);
  }
  let t = await kvGet(K_TRASH);
  if (!Array.isArray(t)) t = lsRead(K_TRASH);
  trash = Array.isArray(t) ? t : [];
}

/* ===================== 视图定义 ===================== */
const DEF = {
  q: {
    noun: '道错题',
    addLabel: '+ 新增错题',
    randomLabel: '随机一题',
    overviewTitle: '随机一题 · 先自己想，再展开',
    fieldLabels: {
      stem: '题目（公式用 $...$）',
      analysis: '解析',
      knowledge: '知识点讲解',
      myAnswer: '我的错误答案（可选）',
    },
    importFieldMap: { 题目: 'stem', 解析: 'analysis', 知识点: 'knowledge', 我的错误答案: 'myAnswer', 标签: 'tags' },
    importRequired: '题目',
    importExample: [
      '【题目】',
      '已知 $x(t)=e^{-2t}\\mathrm{u}(t)$，求其傅里叶变换 $X(j\\omega)$。',
      '（可以写 [图1] 引用配图，解析里会显示成可点击的图号）',
      '【解析】',
      '第 1 步：写出定义式。傅里叶变换的定义为 $X(j\\omega)=\\int_{-\\infty}^{\\infty}x(t)e^{-j\\omega t}\\,dt$。',
      '第 2 步：代入 $x(t)$ 并处理阶跃。$\\mathrm{u}(t)$ 在 $t<0$ 时为 $0$，故积分下限从 $-\\infty$ 收缩到 $0$：$$X(j\\omega)=\\int_{0}^{\\infty}e^{-2t}e^{-j\\omega t}\\,dt$$',
      '第 3 步：合并指数。$e^{-2t}e^{-j\\omega t}=e^{-(2+j\\omega)t}$。',
      '第 4 步：算出积分。$\\int_{0}^{\\infty}e^{-(2+j\\omega)t}\\,dt=\\left.\\frac{e^{-(2+j\\omega)t}}{-(2+j\\omega)}\\right|_{0}^{\\infty}=\\frac{1}{2+j\\omega}$，成立条件是 $\\mathrm{Re}\\{2+j\\omega\\}=2>0$（等价于信号绝对可积）。',
      '第 5 步：写出结论。$X(j\\omega)=\\frac{1}{2+j\\omega}$，幅频 $|X(j\\omega)|=\\frac{1}{\\sqrt{4+\\omega^2}}$，相频 $\\angle X(j\\omega)=-\\arctan\\frac{\\omega}{2}$。',
      '【知识点】',
      '单边指数信号：$e^{-at}\\mathrm{u}(t)\\leftrightarrow\\frac{1}{a+j\\omega}$，收敛条件 $\\mathrm{Re}\\{a\\}>0$；本题取 $a=2$。',
      '【我的错误答案】',
      '（选填：我当时是怎么错的）',
      '【标签】',
      '傅里叶变换, 频谱, 收敛域',
      '',
      '多题之间用单独一行 === 分隔',
    ].join('\n'),
    main: it => `<div class="stem">${renderMath(it.stem, it.images)}</div>`,
    details: it => [
      { label: '查看我的错误答案', text: it.myAnswer || '' },
      { label: '查看解析', text: it.analysis },
      { label: '查看知识点讲解', text: it.knowledge },
    ],
    hay: it => [it.stem, it.analysis, it.knowledge, it.myAnswer || '', it.tags.join(' ')].join(' '),
    previewMain: o => o.stem || '（无题目）',
    previewInfo: o => `解析 ${o.analysis ? '✓' : '✗'} · 知识点 ${o.knowledge ? '✓' : '✗'} · 标签 ${o.tags.length}`,
  },
  k: {
    noun: '个知识点',
    addLabel: '+ 新增知识点',
    randomLabel: '随机一个知识点',
    overviewTitle: '只看知识点 · 先回忆，再展开',
    fieldLabels: { title: '知识点名称', content: '讲解（公式用 $...$）' },
    importFieldMap: { 知识点: 'title', 讲解: 'content', 标签: 'tags' },
    importRequired: '知识点',
    importExample: [
      '【知识点】',
      '抽样定理',
      '【讲解】',
      '第 1 步：说清问题。一般连续信号的频谱不是有限带宽的，想用离散样本恢复原信号，就必须先限制带宽。',
      '第 2 步：给出条件。设 $x(t)$ 为带限信号、最高频率为 $f_m$（角频率 $\\omega_m=2\\pi f_m$），抽样频率须满足 $$f_s>2f_m$$ 时，才能由样本 $x(nT_s)$ 无失真地恢复 $x(t)$，其中 $T_s=1/f_s$。',
      '第 3 步：解释原因。时域抽样相当于频域频谱以 $f_s$ 为周期延拓；若 $f_s\\le 2f_m$，相邻频谱副本会重叠，产生频谱混叠，高频分量被折叠到低频而无法还原。',
      '第 4 步：给出恢复方法。用一个理想低通滤波器滤出原频谱，时域上就是 $\\mathrm{sinc}$ 插值：$$x(t)=\\sum_{n=-\\infty}^{\\infty}x(nT_s)\\,\\mathrm{sinc}\\left(\\frac{t-nT_s}{T_s}\\right)$$',
      '第 5 步：易错点。$f_s=2f_m$ 是临界抽样（奈奎斯特率），工程上要留裕量（常取 $2.5\\sim 5$ 倍）；抽样前一般要先加抗混叠低通滤波器。',
      '【标签】',
      '抽样定理, 频谱混叠',
      '',
      '多个知识点之间用单独一行 === 分隔',
    ].join('\n'),
    main: it => `<div class="stem"><span class="kp-badge">知识点</span>${renderMath(it.title, it.images)}</div>`,
    details: it => [{ label: '查看讲解', text: it.content }],
    hay: it => [it.title, it.content, it.tags.join(' ')].join(' '),
    previewMain: o => o.title || '（无名称）',
    previewInfo: o => `讲解 ${o.content ? '✓' : '✗'} · 标签 ${o.tags.length}`,
  },
};

/* ===================== 公式快捷插入条 ===================== */
const LATEX_SNIPPETS = [
  ['分式', '\\frac{a}{b}'],
  ['积分', '\\int_{-\\infty}^{\\infty} '],
  ['求和', '\\sum_{n=-\\infty}^{\\infty} '],
  ['冲激', '\\delta(t)'],
  ['阶跃', '\\mathrm{u}(t)'],
  ['矩形', '\\mathrm{rect}(t)'],
  ['sinc', '\\mathrm{sinc}(x)'],
  ['复指数', 'e^{j\\omega t}'],
  ['频域', 'X(j\\omega)'],
  ['H(z)', 'H(z)=\\frac{1}{1-az^{-1}}'],
  ['对应', '\\leftrightarrow'],
  ['卷积', '*'],
  ['ω', '\\omega'],
  ['上标', '^{}'],
  ['下标', '_{}'],
  ['矩阵', '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'],
];
function insertAtCursor(el, text) {
  const start = el.selectionStart == null ? el.value.length : el.selectionStart;
  const end = el.selectionEnd == null ? start : el.selectionEnd;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.focus();
  try { el.setSelectionRange(pos, pos); } catch (e) {}
}
function buildLatexBar(bar) {
  if (!bar || bar.dataset.built) return;
  bar.dataset.built = '1';
  bar.innerHTML = '<span class="lb-hint">插入：</span>' + LATEX_SNIPPETS
    .map((s, i) => `<button type="button" data-ltx="${i}" title="${esc(s[1])}">${esc(s[0])}</button>`).join('');
  bar.querySelectorAll('button[data-ltx]').forEach(b => {
    b.onclick = () => {
      const panel = bar.closest('.panel');
      const snip = LATEX_SNIPPETS[+b.dataset.ltx][1];
      let target = null;
      const focused = document.activeElement;
      if (focused && panel && panel.contains(focused) && /^(TEXTAREA|INPUT)$/.test(focused.tagName)) target = focused;
      if (!target && panel) target = panel.querySelector('textarea');
      if (target) insertAtCursor(target, snip);
    };
  });
}
buildLatexBar(document.getElementById('latexBar'));
buildLatexBar(document.getElementById('latexBarEdit'));

/* ===================== 学科预设标签 ===================== */
const PRESET_TAGS = {
  ss: {
    '基本信号': ['单位冲激', '单位阶跃', '冲激偶', '复指数信号', 'Sa 函数', '矩形脉冲', '三角脉冲', '符号函数'],
    '变换': ['傅里叶级数', '傅里叶变换', '拉普拉斯变换', '频谱', '幅度谱', '相位谱', '收敛域', '变换性质'],
    '系统': ['线性时不变', '因果', '稳定', '卷积', '冲激响应', '阶跃响应', '系统函数', '零极点', '频率响应', '全通', '无失真传输'],
    '应用': ['抽样定理', '频谱混叠', '调制', '滤波器', '微分方程', '状态方程', '信号分解'],
  },
  dsp: {
    '基本序列': ['单位脉冲序列', '单位阶跃序列', '指数序列', '复指数序列', '周期序列', '序列运算'],
    '变换': ['DTFT', 'DFT', 'FFT', 'Z变换', '循环卷积', '线性卷积', '频谱泄漏', '频率分辨率'],
    '系统': ['线性移不变', '因果稳定', '差分方程', '系统函数', '零极点', '频率响应', '全通', '最小相位', 'IIR', 'FIR'],
    '实现': ['采样', '抽取', '内插', '多速率', '窗函数', 'DFT 对称性', 'FFT 算法'],
  },
};
// 该标签是否能驱动「一键生成」（用于给预设标签加 ⚡ 角标）
function isDrivableTag(subject, tag) {
  if (!MQG.drivableTags) return false;
  const flat = t => String(t).replace(/\s+/g, '');
  const key = flat(tag);
  return MQG.drivableTags(subject).some(t => flat(t) === key);
}
function presetTagsHTML(subject) {
  const groups = PRESET_TAGS[subject] || {};
  return Object.keys(groups).map(g => `
    <div class="preset-group">${esc(g)}</div>
    <div class="preset-tags">${groups[g].map(t => {
      const ok = isDrivableTag(subject, t);
      return `<button type="button" class="preset-tag${ok ? ' drivable' : ''}" data-tag="${esc(t)}"${ok ? ' title="该标签可驱动「一键生成」"' : ''}>${esc(t)}${ok ? '<span class="pt-bolt">⚡</span>' : ''}</button>`;
    }).join('')}</div>
  `).join('');
}
function paintPresetState(box, isOn) {
  box.querySelectorAll('.preset-tag').forEach(b => b.classList.toggle('on', isOn(b.dataset.tag)));
}

/* ===================== 视图状态 ===================== */
const PAGE = 30;
const views = {
  q: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), tagMode: 'all', search: '', status: '', starOnly: false, dueOnly: false, imgOnly: false, collectionFilter: COL_ALL },
  k: { visibleCount: PAGE, selected: new Set(), selectMode: false, groupMode: false, activeTags: new Set(), tagMode: 'all', search: '', status: '', starOnly: false, dueOnly: false, imgOnly: false, collectionFilter: COL_ALL },
};
let active = 'q';
let editingId = null;
let pending = [];
let pendingTags = new Set();
let pendingAnim = false;
// 记录已展开的折叠区（键为 `itemId|label`），使重渲染后不丢失展开状态
const openDetails = new Set();

const cur = () => views[active];
const curItems = () => stores[active].items;
const saveActive = () => saveStore(stores[active].key, curItems());
const curSubjectName = () => SUBJECT[settings.subject] || '';
const curSubjectShort = () => SUBJECT_SHORT[settings.subject] || '';

/* ===================== render ===================== */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 把正文里的 [图1]、[图 2] 变成可点击的图号（与配图编号一一对应）
function figRefs(html, images) {
  return html.replace(/\[图\s*(\d+)\]/g, (all, n) => {
    const idx = (+n) - 1;
    const id = images && images[idx];
    if (!id) return all;
    return `<span class="figref" data-fig="${esc(id)}" data-figidx="${idx}">图${n}</span>`;
  });
}

// 依次识别：$$...$$ / \[...\] 行间公式，$...$ / \(...\) 行内公式，
// 以及没有任何定界符的裸 LaTeX（如部分 AI 直接输出 y'' = \frac{dp}{dx} …）。
function renderMath(text, images) {
  if (!text) return '';
  const parts = String(text).split(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([\s\S]+?\\\))/g);
  return parts.map(p => {
    let m;
    if ((m = p.match(/^\$\$([\s\S]+?)\$\$$/)) || (m = p.match(/^\\\[([\s\S]+?)\\\]$/))) {
      try { return katex.renderToString(m[1], { displayMode: true, throwOnError: false }); }
      catch (e) { return esc(p); }
    }
    if ((m = p.match(/^\$([^$]+?)\$$/)) || (m = p.match(/^\\\(([\s\S]+?)\\\)$/))) {
      try { return katex.renderToString(m[1], { throwOnError: false }); }
      catch (e) { return esc(p); }
    }
    return renderBareMath(p, images);
  }).join('');
}

// 无定界符文本：切出裸 LaTeX 片段后渲染，其余按普通文本处理（保留换行与配图引用）
function renderBareMath(text, images) {
  return bareMathSegments(text).map(seg => {
    if (seg.t === 'text') return figRefs(esc(seg.v), images).replace(/\n/g, '<br>');
    try { return katex.renderToString(seg.v, { displayMode: !!seg.display, throwOnError: false }); }
    catch (e) { return esc(seg.v); }
  }).join('');
}

// 折叠区内容：走公式渲染
function sectionHTML(x, images) {
  if (!x.text) return `<span class="section-label">${esc(x.empty || '（暂无）')}</span>`;
  return renderMath(x.text, images);
}

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const searchEl = document.getElementById('search');
const statusEl = document.getElementById('statusFilter');
const loadMoreRow = document.getElementById('loadMoreRow');
const addBtn = document.getElementById('addBtn');
const randomBtn = document.getElementById('randomBtn');
const subjectSeg = document.getElementById('subjectSeg');
const tabEls = [...document.querySelectorAll('.tab')];

// 搜索文本缓存：按 id + updatedAt 命中，避免每次筛选重新拼接
const hayCache = new Map();
function hayOf(it) {
  const c = hayCache.get(it.id);
  if (c && c.u === it.updatedAt) return c.hay;
  const hay = DEF[active].hay(it).toLowerCase();
  hayCache.set(it.id, { u: it.updatedAt, hay });
  return hay;
}

function currentFiltered() {
  const v = cur();
  const s = parseSearch(v.search);
  const now = Date.now();
  // 合集筛选：null = 未分类；其余 = 该合集及其子合集；COL_ALL = 不过滤
  const cf = v.collectionFilter;
  const subIds = (cf && cf !== COL_ALL) ? collectionSubtreeIds(colStores[active] || [], cf) : null;
  const out = curItems().filter(it => {
    if (it.subject !== settings.subject) return false;
    if (cf !== COL_ALL) {
      if (cf == null) { if (it.collectionId) return false; }
      else if (!it.collectionId || !subIds.has(it.collectionId)) return false;
    }
    if (v.status && it.status !== v.status) return false;
    if (s.status && it.status !== s.status) return false;
    if (v.starOnly && !it.star) return false;
    if (s.star && !it.star) return false;
    if (v.dueOnly && !isDue(it, now)) return false;
    if (s.due && !isDue(it, now)) return false;
    const hasImg = !!(it.images && it.images.length);
    if (v.imgOnly && !hasImg) return false;
    if (s.hasImg && !hasImg) return false;
    // 标签筛选：默认「同时满足全部（交集）」；由「相关 X 个」跳转时改为「满足其一（并集）」
    if (v.activeTags.size) {
      const hit = v.tagMode === 'any'
        ? [...v.activeTags].some(t => it.tags.includes(t))
        : [...v.activeTags].every(t => it.tags.includes(t));
      if (!hit) return false;
    }
    if (s.tags.length && !s.tags.every(t => it.tags.includes(t))) return false;
    if (s.text && !hayOf(it).includes(s.text)) return false;
    return true;
  });
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

function bindLazy(detailsEl, key, sec, images) {
  const body = detailsEl.querySelector('.body');
  const paint = () => {
    if (body.dataset.done === '1') return;
    body.innerHTML = sectionHTML(sec, images);
    body.dataset.done = '1';
  };
  if (detailsEl.open) paint();
  detailsEl.addEventListener('toggle', () => {
    if (detailsEl.open) { openDetails.add(key); paint(); }
    else openDetails.delete(key);
  });
}

// 与「另一库」按标签交集的数量（同一科目内）：错题视图看知识点，知识点视图看错题
function relatedCount(it) {
  if (!it.tags.length) return 0;
  const other = active === 'k' ? stores.q.items : stores.k.items;
  return other.filter(o => o.subject === settings.subject && o.tags.some(t => it.tags.includes(t))).length;
}

// 统一的复习动作：切换状态并安排下次复习时间（SRS）
function applyStatus(item, next) {
  item.status = next;
  item.updatedAt = Date.now();
  scheduleSrs(item, next);
  saveActive();
}

// 折叠区：过滤掉空内容（空「我的错误答案」不显示）
function visibleSections(it) {
  return DEF[active].details(it).filter(x => {
    if (x.label === '查看我的错误答案') return !!x.text;
    return true;
  });
}

function makeCard(it) {
  const d = DEF[active];
  const v = cur();
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = it.id;
  const tags = it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  const rc = relatedCount(it); // 只计算一次
  const rel = rc
    ? `<span class="relchip" data-rel="1">相关${active === 'k' ? '错题' : '知识点'} ${rc} ${active === 'k' ? '道' : '个'}</span>` : '';
  const due = `<span class="duechip${isDue(it) ? ' due' : ''}" data-due="1" title="点击标记为「复习中」">🕒 ${dueLabel(it)}</span>`;
  const col = it.collectionId ? collectionById(active, it.collectionId) : null;
  const colChip = col
    ? `<span class="colchip" data-col="${esc(col.id)}" title="所属合集，点击只看这个合集">📁 ${esc(col.name)}</span>` : '';
  const dets = visibleSections(it);
  card.innerHTML = `
    ${v.selectMode ? `<input type="checkbox" class="chk" data-act="pick" ${v.selected.has(it.id) ? 'checked' : ''}>` : ''}
    ${d.main(it)}
    ${imgStrip(it)}
    <div class="meta">
      <button class="star ${it.star ? 'on' : ''}" data-act="star" title="${it.star ? '取消收藏' : '收藏'}">${it.star ? '★' : '☆'}</button>
      ${tags}${rel}${colChip}
      <div class="cardacts">
        ${hasGenPlan(it) ? `<button class="link" data-act="gen" title="按标签一键生成图表（本地离线，不联网）">⚡ 生成</button>` : ''}
        ${due}
        <span class="status ${it.status}" data-act="status">● ${STATUS[it.status]}</span>
        <button class="link" data-act="edit">编辑</button>
        <button class="link" data-act="delete">删除</button>
      </div>
    </div>
    ${dets.map(x => {
      const key = it.id + '|' + x.label;
      return `<details data-key="${esc(key)}"${openDetails.has(key) ? ' open' : ''}><summary>${x.label}</summary><div class="body"></div></details>`;
    }).join('')}
  `;
  card.querySelectorAll('details').forEach((el, i) => bindLazy(el, it.id + '|' + dets[i].label, dets[i], it.images));

  card.querySelector('[data-act="status"]').onclick = () => {
    applyStatus(it, STATUS_NEXT[it.status]);
    const el = card.querySelector('[data-act="status"]');
    el.className = 'status ' + it.status;
    el.textContent = '● ' + STATUS[it.status];
    const dueEl = card.querySelector('[data-due]');
    if (dueEl) { dueEl.textContent = '🕒 ' + dueLabel(it); dueEl.classList.toggle('due', isDue(it)); }
    if (v.status || v.dueOnly) render();
  };
  card.querySelector('[data-act="star"]').onclick = () => {
    it.star = !it.star;
    saveActive();
    const btn = card.querySelector('[data-act="star"]');
    btn.classList.toggle('on', it.star);
    btn.textContent = it.star ? '★' : '☆';
    btn.title = it.star ? '取消收藏' : '收藏';
    if (v.starOnly && !it.star) render();
  };
  const genBtn = card.querySelector('[data-act="gen"]');
  if (genBtn) genBtn.onclick = () => openGenDrawer(it);
  card.querySelector('[data-act="edit"]').onclick = () => openEdit(it);
  card.querySelector('[data-act="delete"]').onclick = () => {
    if (confirm('移入回收站？30 天内可在「设置 → 回收站」恢复。')) {
      toTrash(active, it);
      stores[active].items = curItems().filter(x => x.id !== it.id);
      v.selected.delete(it.id);
      saveActive();
      refreshTagPicker();
      render();
    }
  };
  const pick = card.querySelector('[data-act="pick"]');
  if (pick) pick.onchange = () => {
    pick.checked ? v.selected.add(it.id) : v.selected.delete(it.id);
    updateToolbar();
    if (v.groupMode) render();
  };
  const relEl = card.querySelector('[data-rel]');
  if (relEl) relEl.onclick = () => {
    const other = active === 'k' ? 'q' : 'k';
    const ov = views[other];
    ov.activeTags = new Set(it.tags);
    ov.tagMode = 'any';          // 与「相关 X 个」的计数口径一致：命中任一标签即算相关
    ov.visibleCount = PAGE;
    ov.search = '';
    ov.status = '';
    ov.starOnly = false;
    ov.dueOnly = false;
    ov.imgOnly = false;
    ov.selectMode = false;
    ov.selected.clear();
    switchView(other);
  };
  const colEl = card.querySelector('[data-col]');
  if (colEl) colEl.onclick = () => {
    v.collectionFilter = colEl.dataset.col;
    closeColDrawerIfNarrow();
    applyFilters();
  };
  // 移动端：长按 0.5 秒进入多选并选中该项
  let pressT = null, moved = false;
  card.addEventListener('touchstart', () => {
    if (v.selectMode) return;
    moved = false;
    pressT = setTimeout(() => {
      if (moved) return;
      enterSelectMode([it.id]);
      if (navigator.vibrate) navigator.vibrate(15);
      const s = window.getSelection && window.getSelection();
      if (s && s.removeAllRanges) s.removeAllRanges();
    }, 500);
  }, { passive: true });
  card.addEventListener('touchmove', () => { moved = true; clearTimeout(pressT); }, { passive: true });
  card.addEventListener('touchend', () => clearTimeout(pressT));
  card.addEventListener('touchcancel', () => { moved = true; clearTimeout(pressT); });

  return card;
}

function render() {
  renderColTree();
  const v = cur();
  const filtered = currentFiltered();
  const shown = filtered.slice(0, v.visibleCount);
  countEl.textContent = `【${curSubjectName()}】共 ${curItems().filter(i => i.subject === settings.subject).length} ${DEF[active].noun}，筛选出 ${filtered.length}，已显示 ${shown.length}`;
  listEl.innerHTML = '';

  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty">这个科目下还没有内容。点右上角「${DEF[active].addLabel}」粘贴一段试试。</div>`;
    loadMoreRow.style.display = 'none';
    pendingAnim = false;
    updateToolbar();
    return;
  }

  if (v.groupMode) {
    const groups = new Map();
    for (const it of shown) {
      const key = it.tags[0] || '未分类';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    for (const [tag, arr] of groups) {
      const g = document.createElement('details');
      g.className = 'group';
      g.open = true;
      g.innerHTML = `<summary>${esc(tag)} · ${arr.length} 道</summary>`;
      const box = document.createElement('div');
      box.className = 'group-body';
      arr.forEach(it => box.appendChild(makeCard(it)));
      g.appendChild(box);
      listEl.appendChild(g);
    }
  } else {
    shown.forEach(it => listEl.appendChild(makeCard(it)));
  }

  if (pendingAnim) {
    [...listEl.querySelectorAll('.card')].forEach((c, i) => {
      c.classList.add('enter');
      c.style.animationDelay = Math.min(i, 12) * 18 + 'ms';
    });
    pendingAnim = false;
  }
  loadMoreRow.style.display = filtered.length > shown.length ? 'flex' : 'none';
  hydrateImages(listEl);
  updateToolbar();
}

function updateToolbar() {
  const v = cur();
  document.getElementById('toolbar').style.display = v.selectMode ? 'flex' : 'none';
  document.getElementById('selCount').textContent = `已选 ${v.selected.size} 项`;
}

/* ===================== 标签（两库并集，限定当前科目） ===================== */
function allTags() {
  const sub = settings.subject;
  return [...new Set([...stores.q.items, ...stores.k.items]
    .filter(i => i.subject === sub)
    .flatMap(i => i.tags))].sort();
}

function refreshTagPicker() {
  const menu = document.getElementById('tagMenu');
  const v = cur();
  const tags = allTags();
  const clearRow = v.activeTags.size ? '<div class="tagopt clear">清除标签筛选</div>' : '';
  const note = v.activeTags.size >= 2
    ? `<div class="tagopt" style="color:var(--muted); font-size:12px; cursor:default">已选 ${v.activeTags.size} 个 · ${v.tagMode === 'any' ? '满足其一即可（并集）' : '需同时满足（交集）'}</div>`
    : '';
  menu.innerHTML = clearRow + note + (tags.length
    ? tags.map(t => `<label class="tagopt"><input type="checkbox" value="${esc(t)}" ${v.activeTags.has(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')
    : `<div class="tagopt" style="color:var(--muted)">「${esc(curSubjectName())}」下暂无标签</div>`);
  menu.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = () => {
      v.tagMode = 'all';
      cb.checked ? v.activeTags.add(cb.value) : v.activeTags.delete(cb.value);
      refreshTagPicker();
      applyFilters();
    };
  });
  const clear = menu.querySelector('.tagopt.clear');
  if (clear) clear.onclick = () => { v.activeTags.clear(); v.tagMode = 'all'; refreshTagPicker(); applyFilters(); };
  document.getElementById('tagPickBtn').textContent = v.activeTags.size ? `标签 · ${v.activeTags.size}个 ▾` : '标签 ▾';
}

/* ===================== 合集（文件夹式，每库一棵可嵌套的树） ===================== */
const colTreeEl = document.getElementById('colTree');
const colBackdrop = document.getElementById('colBackdrop');
const colCollapsed = new Set();   // 被折叠的合集 id（默认展开）

const colKind = () => active === 'k' ? 'k' : 'q';

// 「侧栏收起为竖条」的偏好：全局（错题 / 知识点共用），存于 sd_settings.rail（'on' | 'off'）
const colRailOn = () => settings.rail === 'on';
function setColRail(on) {
  settings.rail = on ? 'on' : 'off';
  saveSettings();
  applySettings();
}
const colList = kind => (colStores[kind] || []);
function collectionById(kind, id) { return colList(kind).find(c => c.id === id); }
function collectionName(kind, id) { const c = collectionById(kind, id); return c ? c.name : '未分类'; }

// 生成「所属合集」下拉的选项：未分类 + 缩进树 + 新建入口
function collectionOptionsHtml(kind, selectedId) {
  const opts = [`<option value=""${selectedId == null ? ' selected' : ''}>未分类</option>`];
  for (const c of flattenCollections(colList(kind))) {
    const ind = c.depth ? '　'.repeat(c.depth) + '└ ' : '';
    opts.push(`<option value="${esc(c.id)}"${selectedId === c.id ? ' selected' : ''}>${ind}${esc(c.name)}</option>`);
  }
  opts.push(`<option value="__new__">＋ 新建合集…</option>`);
  return opts.join('');
}

// 新建合集：加在指定父节点下（同名同级拒绝）
function addCollectionQuick(kind, parentId, name) {
  const nm = String(name == null ? '' : name).trim();
  if (!nm) return null;
  const pid = parentId || null;
  if (collectionChildren(colList(kind), pid).some(c => c.name === nm)) {
    alert(`同级下已存在同名合集「${nm}」。`);
    return null;
  }
  const r = addCollection(colList(kind), nm, pid, Date.now());
  colStores[kind] = r.cols;
  if (pid) colCollapsed.delete(pid);      // 展开父节点，让新建的子合集可见
  saveCols(kind);
  return r.node.id;
}

if (colBackdrop) colBackdrop.onclick = () => closeColDrawer();
function openColDrawer() { colTreeEl.classList.add('open'); colBackdrop.classList.add('show'); }
function closeColDrawer() { colTreeEl.classList.remove('open'); colBackdrop.classList.remove('show'); }
function closeColDrawerIfNarrow() { if (window.innerWidth < 1024) closeColDrawer(); }
document.getElementById('colToggle').onclick = () => {
  // 宽屏：一键在「完整侧栏 ⇄ 窄竖条」之间切换；窄屏：开合抽屉（行为不变）
  if (window.innerWidth >= 1024) { setColRail(!colRailOn()); return; }
  colTreeEl.classList.contains('open') ? closeColDrawer() : openColDrawer();
};

const NONE_ID = '__none__';   // 侧栏「未分类」虚拟行的 id

function renderColTree() {
  if (!colTreeEl) return;
  if (active !== 'q' && active !== 'k') { colTreeEl.innerHTML = ''; return; }
  const kind = colKind();
  const v = cur();
  const cols = colList(kind);
  const { subtree, unassigned } = collectionCounts(curItems(), cols);
  const sel = v.collectionFilter;
  const st = colTreeEl.scrollTop;

  // 宽屏 + 已收起 → 渲染窄竖条（平铺所有合集）；否则保持现有完整树
  if (colRailOn() && window.innerWidth >= 1024) {
    renderColRail(kind, cols, subtree, unassigned, sel);
    return;
  }

  const nodeRow = o => {
    const pad = 6 + o.depth * 14;
    const twist = o.hasKids
      ? `<span class="twist" data-twist="${esc(o.id)}">${o.collapsed ? '▸' : '▾'}</span>`
      : '<span class="twist"></span>';
    const acts = o.virtual ? '' : `
      <span class="cacts">
        <button data-cnew="${esc(o.id)}" title="新建子合集">＋</button>
        <button data-cedit="${esc(o.id)}" title="重命名">✎</button>
        <button data-cdel="${esc(o.id)}" class="del" title="删除">🗑</button>
      </span>`;
    return `<div class="colrow${o.active ? ' active' : ''}" data-crow="${esc(o.id)}" style="padding-left:${pad}px">
      ${twist}<span class="cname">${esc(o.name)}</span><span class="ccount">${o.count}</span>${acts}
    </div>`;
  };

  let html = `<div class="coltree-head"><span class="t">合集</span><button class="railbtn" id="colCollapse" title="收起侧栏">«</button><button class="cls" id="colClose" title="关闭">✕</button></div>`;
  html += nodeRow({ id: COL_ALL, name: '全部', count: curItems().length, active: sel === COL_ALL, depth: 0, virtual: true });
  html += nodeRow({ id: NONE_ID, name: '未分类', count: unassigned, active: sel == null, depth: 0, virtual: true });

  const walk = (parentId, depth) => {
    let s = '';
    for (const c of collectionChildren(cols, parentId)) {
      const kids = collectionChildren(cols, c.id);
      const collapsed = colCollapsed.has(c.id);
      s += nodeRow({ id: c.id, name: c.name, count: subtree.get(c.id) || 0, active: sel === c.id, depth, hasKids: !!kids.length, collapsed });
      if (kids.length && !collapsed) s += walk(c.id, depth + 1);
    }
    return s;
  };
  const tree = walk(null, 0);
  html += tree || '<div class="col-empty">还没有合集。点下面「＋ 新建合集」开始，或先把几条内容归进去。</div>';
  html += `<button class="coltree-new" id="colNew">＋ 新建合集</button>`;
  colTreeEl.innerHTML = html;
  colTreeEl.scrollTop = st;

  colTreeEl.querySelectorAll('[data-crow]').forEach(el => {
    el.onclick = e => {
      if (e.target.closest('[data-cnew],[data-cedit],[data-cdel],[data-twist]')) return;
      const raw = el.dataset.crow;
      v.collectionFilter = raw === NONE_ID ? null : raw;   // COL_ALL 原样保留
      applyFilters();
      closeColDrawerIfNarrow();
    };
  });
  colTreeEl.querySelectorAll('[data-twist]').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      const id = el.dataset.twist;
      colCollapsed.has(id) ? colCollapsed.delete(id) : colCollapsed.add(id);
      renderColTree();
    };
  });
  colTreeEl.querySelectorAll('[data-cnew]').forEach(b => b.onclick = e => { e.stopPropagation(); createCollection(b.dataset.cnew); });
  colTreeEl.querySelectorAll('[data-cedit]').forEach(b => b.onclick = e => { e.stopPropagation(); renameCollectionPrompt(b.dataset.cedit); });
  colTreeEl.querySelectorAll('[data-cdel]').forEach(b => b.onclick = e => { e.stopPropagation(); deleteCollectionPrompt(b.dataset.cdel); });
  const nb = colTreeEl.querySelector('#colNew');
  if (nb) nb.onclick = () => createCollection(null);
  const cb = colTreeEl.querySelector('#colClose');
  if (cb) cb.onclick = () => closeColDrawer();
  const cc = colTreeEl.querySelector('#colCollapse');
  if (cc) cc.onclick = () => setColRail(true);
}

// 首字（竖条方块上显示一个字符；对代理对/emoji 安全）
const firstChar = s => { const t = String(s == null ? '' : s).trim(); return t ? [...t][0] : '?'; };

// 窄竖条：平铺「全部」「未分类」+ 所有合集（含子合集，不体现缩进），复用同一份 collectionFilter 选中态
function renderColRail(kind, cols, subtree, unassigned, sel) {
  const v = cur();
  // 保留竖条内部滚动位置
  const prev = colTreeEl.querySelector('.colrail-items');
  const st = prev ? prev.scrollTop : 0;

  const item = (id, name, active, tip) =>
    `<button class="colrail-item${active ? ' active' : ''}" data-rrow="${esc(id)}" title="${esc(tip)}">${esc(firstChar(name))}</button>`;

  let items = '';
  items += item(COL_ALL, '全部', sel === COL_ALL, `全部 · ${curItems().length} 条`);
  items += item(NONE_ID, '未分类', sel == null, `未分类 · ${unassigned} 条`);
  for (const c of flattenCollections(cols)) {
    const path = collectionPath(cols, c.id).map(x => x.name).join(' / ');
    items += item(c.id, c.name, sel === c.id, `${path} · ${subtree.get(c.id) || 0} 条`);
  }

  colTreeEl.innerHTML = '<div class="colrail">'
    + '<button class="colrail-btn" id="colRailExpand" title="展开合集侧栏">»</button>'
    + `<div class="colrail-items">${items}</div>`
    + '<button class="colrail-btn" id="colRailNew" title="新建合集">＋</button>'
    + '</div>';

  const itemsEl = colTreeEl.querySelector('.colrail-items');
  if (itemsEl) itemsEl.scrollTop = st;

  colTreeEl.querySelectorAll('[data-rrow]').forEach(el => {
    el.onclick = () => {
      const raw = el.dataset.rrow;
      v.collectionFilter = raw === NONE_ID ? null : raw;   // COL_ALL 原样保留
      applyFilters();                                       // 重渲染 → 竖条高亮与列表同步更新
    };
  });
  const ex = colTreeEl.querySelector('#colRailExpand');
  if (ex) ex.onclick = () => setColRail(false);
  const nw = colTreeEl.querySelector('#colRailNew');
  if (nw) nw.onclick = () => createCollection(null);
}

function createCollection(parentId) {
  const kind = colKind();
  const name = prompt(parentId ? '新建子合集名称：' : '新建合集名称：');
  if (name == null) return;
  if (addCollectionQuick(kind, parentId, name)) { renderColTree(); applyFilters(); }
}

function renameCollectionPrompt(id) {
  const kind = colKind();
  const c = collectionById(kind, id);
  if (!c) return;
  const name = prompt('重命名合集：', c.name);
  if (name == null) return;
  const nm = name.trim();
  if (!nm || nm === c.name) return;
  if (collectionChildren(colList(kind), c.parentId || null).filter(x => x.id !== id).some(x => x.name === nm)) {
    alert(`同级下已存在同名合集「${nm}」。`);
    return;
  }
  colStores[kind] = renameCollection(colList(kind), id, nm, Date.now());
  saveCols(kind);
  renderColTree();
  applyFilters();
}

function deleteCollectionPrompt(id) {
  const kind = colKind();
  const cols = colList(kind);
  const c = collectionById(kind, id);
  if (!c) return;
  const ids = collectionSubtreeIds(cols, id);
  const extra = ids.size - 1;
  const n = (collectionCounts(curItems(), cols).subtree.get(id)) || 0;
  const msg = `删除合集「${c.name}」？`
    + (extra ? `其下 ${extra} 个子合集会一并删除。` : '')
    + (n ? `\n其中 ${n} 条内容会回到「未分类」。` : '')
    + '\n此操作不可撤销。';
  if (!confirm(msg)) return;
  colStores[kind] = deleteCollection(cols, id).cols;
  let changed = false;
  for (const it of curItems()) {
    if (it.collectionId && ids.has(it.collectionId)) { it.collectionId = null; changed = true; }
  }
  saveCols(kind);
  if (changed) saveActive();
  const v = cur();
  if (v.collectionFilter && ids.has(v.collectionFilter)) v.collectionFilter = COL_ALL;
  render();
}

/* ===================== ui ===================== */
function applyFilters() {
  cur().visibleCount = PAGE;
  cur().selected.clear();
  pendingAnim = true;
  render();
}

function syncHeader() {
  const v = cur();
  searchEl.value = v.search;
  statusEl.value = v.status;
  document.getElementById('selectBtn').classList.toggle('primary', v.selectMode);
  document.getElementById('groupBtn').classList.toggle('primary', v.groupMode);
  const sb = document.getElementById('starBtn');
  sb.classList.toggle('on', v.starOnly);
  sb.textContent = v.starOnly ? '★ 只看收藏' : '☆ 只看收藏';
  const db = document.getElementById('dueBtn');
  if (db) {
    db.classList.toggle('on', v.dueOnly);
    const dueN = curItems().filter(it => it.subject === settings.subject && isDue(it)).length;
    db.textContent = dueN ? `🕒 待复习 ${dueN}` : '🕒 待复习';
  }
  const ib = document.getElementById('imgOnlyBtn');
  if (ib) ib.classList.toggle('primary', v.imgOnly);
}

function switchView(v) {
  active = v;
  tabEls.forEach(t => t.classList.toggle('active', t.dataset.view === v));
  addBtn.textContent = DEF[v].addLabel;
  randomBtn.textContent = DEF[v].randomLabel;
  syncHeader();
  refreshTagPicker();
  pendingAnim = true;
  render();
}

function switchSubject(sub) {
  if (!SUBJECT[sub] || sub === settings.subject) return;
  settings.subject = sub;
  saveSettings();
  applySettings();
  for (const kind of ['q', 'k']) {
    views[kind].visibleCount = PAGE;
    views[kind].selected.clear();
    views[kind].activeTags.clear();
    views[kind].search = '';
    views[kind].status = '';
    views[kind].starOnly = false;
    views[kind].dueOnly = false;
    views[kind].imgOnly = false;
    views[kind].selectMode = false;
  }
  syncHeader();
  refreshTagPicker();
  pendingAnim = true;
  render();
}

subjectSeg.querySelectorAll('button').forEach(b => b.onclick = () => switchSubject(b.dataset.subject));

tabEls.forEach(t => t.onclick = () => switchView(t.dataset.view));
searchEl.oninput = debounce(() => { cur().search = searchEl.value; applyFilters(); }, 200);
statusEl.onchange = () => { cur().status = statusEl.value; applyFilters(); };
document.getElementById('loadMoreBtn').onclick = () => { cur().visibleCount += PAGE; render(); };

document.getElementById('tagPickBtn').onclick = e => {
  e.stopPropagation();
  document.getElementById('tagMenu').classList.toggle('open');
};
document.getElementById('tagMenu').onclick = e => e.stopPropagation();
document.addEventListener('click', () => document.getElementById('tagMenu').classList.remove('open'));

document.getElementById('selectBtn').onclick = () => {
  const v = cur();
  v.selectMode = !v.selectMode;
  if (!v.selectMode) v.selected.clear();
  document.getElementById('selectBtn').classList.toggle('primary', v.selectMode);
  render();
};
document.getElementById('groupBtn').onclick = () => {
  const v = cur();
  v.groupMode = !v.groupMode;
  document.getElementById('groupBtn').classList.toggle('primary', v.groupMode);
  render();
};

function enterSelectMode(ids) {
  const v = cur();
  v.selectMode = true;
  v.selected = new Set(ids || []);
  document.getElementById('selectBtn').classList.add('primary');
  render();
}

document.getElementById('starBtn').onclick = () => {
  const v = cur();
  v.starOnly = !v.starOnly;
  syncHeader();
  applyFilters();
};

document.getElementById('dueBtn').onclick = () => {
  const v = cur();
  v.dueOnly = !v.dueOnly;
  syncHeader();
  applyFilters();
};

document.getElementById('imgOnlyBtn').onclick = () => {
  const v = cur();
  v.imgOnly = !v.imgOnly;
  syncHeader();
  applyFilters();
};

/* ---------- 批量操作 ---------- */
document.getElementById('selAll').onclick = () => {
  const v = cur();
  currentFiltered().slice(0, v.visibleCount).forEach(it => v.selected.add(it.id));
  render();
};
document.getElementById('selNone').onclick = () => { cur().selected.clear(); render(); };
document.getElementById('exitSelect').onclick = () => {
  const v = cur();
  v.selectMode = false;
  v.selected.clear();
  document.getElementById('selectBtn').classList.remove('primary');
  render();
};
document.querySelectorAll('[data-batch-status]').forEach(btn => {
  btn.onclick = () => {
    const v = cur();
    if (!v.selected.size) return alert('还没选任何项。');
    curItems().forEach(it => {
      if (v.selected.has(it.id)) { it.status = btn.dataset.batchStatus; it.updatedAt = Date.now(); scheduleSrs(it, btn.dataset.batchStatus); }
    });
    saveActive();
    render();
  };
});
document.getElementById('batchTag').onclick = () => {
  const v = cur();
  if (!v.selected.size) return alert('还没选任何项。');
  const input = prompt('给选中的项添加标签（多个用逗号分隔）：');
  if (!input) return;
  const add = input.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  curItems().forEach(it => {
    if (v.selected.has(it.id)) { it.tags = [...new Set(it.tags.concat(add))]; it.updatedAt = Date.now(); }
  });
  saveActive();
  refreshTagPicker();
  render();
};
document.getElementById('batchSubject').onclick = () => {
  const v = cur();
  if (!v.selected.size) return alert('还没选任何项。');
  const other = settings.subject === 'ss' ? 'dsp' : 'ss';
  if (!confirm(`把选中的 ${v.selected.size} 项改到「${SUBJECT[other]}」（${SUBJECT_SHORT[other]}）？改后它们会从当前列表里消失。`)) return;
  curItems().forEach(it => {
    if (v.selected.has(it.id)) { it.subject = other; it.updatedAt = Date.now(); }
  });
  saveActive();
  refreshTagPicker();
  render();
};
/* 批量移动到合集 */
const moveModal = document.getElementById('moveModal');
const moveSelect = document.getElementById('moveSelect');
document.getElementById('batchMove').onclick = () => {
  const v = cur();
  if (!v.selected.size) return alert('还没选任何项。');
  // 默认选当前正在筛选的合集，省一步
  const def = (v.collectionFilter && v.collectionFilter !== COL_ALL) ? v.collectionFilter : null;
  moveSelect.innerHTML = collectionOptionsHtml(active, def);
  moveModal.classList.add('open');
};
document.getElementById('moveCancel').onclick = () => moveModal.classList.remove('open');
moveModal.onclick = e => { if (e.target === moveModal) moveModal.classList.remove('open'); };
moveSelect.onchange = () => {
  if (moveSelect.value !== '__new__') return;
  const name = prompt('新建合集名称：');
  const id = name == null ? null : addCollectionQuick(active, null, name);
  moveSelect.innerHTML = collectionOptionsHtml(active, id);
};
document.getElementById('moveConfirm').onclick = () => {
  const v = cur();
  let target = moveSelect.value;
  if (target === '__new__') {
    const name = prompt('新建合集名称：');
    target = name == null ? null : addCollectionQuick(active, null, name);
  }
  if (target === '__new__') return;
  target = target || null;
  curItems().forEach(it => {
    if (v.selected.has(it.id)) { it.collectionId = target; it.updatedAt = Date.now(); }
  });
  saveActive();
  moveModal.classList.remove('open');
  render();
};
document.getElementById('batchDelete').onclick = () => {
  const v = cur();
  if (!v.selected.size) return alert('还没选任何项。');
  if (!confirm(`确定把选中的 ${v.selected.size} 项移入回收站？30 天内可恢复。`)) return;
  curItems().filter(it => v.selected.has(it.id)).forEach(it => toTrash(active, it));
  stores[active].items = curItems().filter(it => !v.selected.has(it.id));
  v.selected.clear();
  saveActive();
  refreshTagPicker();
  render();
};

/* ---------- 新增 / 粘贴导入 ---------- */
const modal = document.getElementById('modal');
const previewEl = document.getElementById('preview');
const importRow = document.getElementById('importRow');
const addImgRow = document.getElementById('addImgRow');

/* 导入时临时配图（只有解析出 1 项时可用） */
let pendingImgs = [];
function renderPendingThumbs() {
  renderThumbs(document.getElementById('addThumbs'), pendingImgs,
    id => {
      pendingImgs = pendingImgs.filter(x => x !== id);
      dropImage(id);
      document.getElementById('addImgMsg').textContent = '';
      renderPendingThumbs();
    },
    (dir, id) => { pendingImgs = moveInArray(pendingImgs, dir, id); renderPendingThumbs(); });
}
function resetPendingImgs() {
  pendingImgs = [];
  document.getElementById('addThumbs').innerHTML = '';
  document.getElementById('addImgMsg').textContent = '';
  addImgRow.style.display = 'none';
}
async function addPendingFiles(files) {
  const holder = { images: pendingImgs };
  const n = await attachImages(holder, files);
  pendingImgs = holder.images;
  addImgRow.style.display = 'block';
  document.getElementById('addImgMsg').textContent = n ? `已添加 ${n} 张` : '没有可用的图片';
  renderPendingThumbs();
}
document.getElementById('addImgBtn').onclick = () => document.getElementById('addImgInput').click();
document.getElementById('addImgInput').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) await addPendingFiles(files);
};
document.getElementById('addDrop').addEventListener('click', () => document.getElementById('addImgInput').click());
bindDropzone(document.getElementById('addDrop'), addPendingFiles);

/* 新增表单上的预设标签区（动态插入到公式工具条之后） */
const addPresetBox = document.createElement('div');
addPresetBox.id = 'addPreset';
document.getElementById('latexBar').insertAdjacentElement('afterend', addPresetBox);
function renderAddPreset() {
  addPresetBox.innerHTML =
    `<div class="preset-group">预设标签 · ${esc(curSubjectName())}<span class="badge-note" style="margin-left:8px">会加在本次导入的所有条目上</span></div>` +
    presetTagsHTML(settings.subject);
  addPresetBox.querySelectorAll('.preset-tag').forEach(b => {
    b.onclick = () => {
      const t = b.dataset.tag;
      pendingTags.has(t) ? pendingTags.delete(t) : pendingTags.add(t);
      paintPresetState(addPresetBox, x => pendingTags.has(x));
    };
  });
  paintPresetState(addPresetBox, x => pendingTags.has(x));
}

// 新增/粘贴导入时的「所属合集」选择（null = 未分类）
let addCollectionId = null;
const addColSel = document.getElementById('addCollection');
function refreshAddCollection() {
  addColSel.innerHTML = collectionOptionsHtml(active, addCollectionId);
}
function newCollectionFromAdd() {
  const name = prompt('新建合集名称：');
  const id = name == null ? null : addCollectionQuick(active, null, name);
  if (id != null) addCollectionId = id;
  refreshAddCollection();
}
addColSel.onchange = () => {
  if (addColSel.value === '__new__') newCollectionFromAdd();
  else addCollectionId = addColSel.value || null;
};
document.getElementById('addColNew').onclick = newCollectionFromAdd;

addBtn.onclick = () => {
  pending = [];
  pendingTags = new Set();
  resetPendingImgs();
  addCollectionId = null;
  refreshAddCollection();
  document.getElementById('addTitle').textContent = active === 'q'
    ? `粘贴 AI 内容 / 手动填写（${curSubjectShort()}）`
    : `粘贴 / 手动新增知识点（${curSubjectShort()}）`;
  document.getElementById('addHint').innerHTML = `按固定格式粘贴，点「拆分预览」自动拆成字段。多项之间用单独一行 <b>===</b> 分隔。`;
  document.getElementById('formatHint').textContent = '格式示例：\n' + DEF[active].importExample;
  document.getElementById('rawInput').value = '';
  previewEl.classList.remove('show');
  previewEl.innerHTML = '';
  importRow.style.display = 'none';
  document.getElementById('parseMsg').textContent = '';
  renderAddPreset();
  modal.classList.add('open');
  document.getElementById('rawInput').focus();
};
document.getElementById('closeBtn').onclick = () => modal.classList.remove('open');
modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };

document.getElementById('parseBtn').onclick = () => {
  const d = DEF[active];
  pending = parseText(document.getElementById('rawInput').value, d.importFieldMap, d.importRequired);
  const msg = document.getElementById('parseMsg');
  if (!pending.length) {
    previewEl.classList.remove('show');
    importRow.style.display = 'none';
    msg.textContent = '没解析到内容，检查一下格式。';
    return;
  }
  const bad = pending.filter(p => p.errors.length).length;
  msg.textContent = `解析到 ${pending.length} 项${bad ? `，其中 ${bad} 项有问题` : ''}。`;
  previewEl.classList.add('show');
  importRow.style.display = 'flex';
  if (pending.length === 1) {
    addImgRow.style.display = 'block';
    renderPendingThumbs();
  } else {
    resetPendingImgs();
  }
  previewEl.innerHTML = pending.map((p, i) => `
    <div class="pvi">
      <div class="row" style="margin:0 0 8px">
        <input type="checkbox" data-i="${i}" checked>
        <span class="section-label">第 ${i + 1} 项</span>
        ${p.errors.length ? `<span class="badge-note">⚠ ${p.errors.map(esc).join('；')}</span>` : ''}
      </div>
      <div class="stem">${renderMath(d.previewMain(p))}</div>
      <div class="fields">${d.previewInfo(p)}</div>
    </div>
  `).join('');
};

document.getElementById('importBtn').onclick = () => {
  const checked = [...previewEl.querySelectorAll('input[type=checkbox]')].filter(c => c.checked).map(c => +c.dataset.i);
  if (!checked.length) { alert('至少选一项。'); return; }

  const dupIndex = buildDupIndex(active);
  const key = dupKey(active);
  const dups = checked.filter(i => findDupIn(dupIndex, pending[i][key]));
  if (dups.length) {
    const names = dups.slice(0, 5).map(i => '· ' + DEF[active].previewMain(pending[i])).join('\n');
    if (!confirm(`检测到 ${dups.length} 项与已有内容高度相似：\n${names}${dups.length > 5 ? '\n…' : ''}\n\n仍要全部导入吗？点「取消」将中止本次导入。`)) return;
  }

  if (checked.length === 1 && pendingImgs.length) pending[checked[0]].images = pendingImgs.slice();

  const extra = [...pendingTags];
  const norm = stores[active].norm;
  for (const i of checked) {
    const o = pending[i];
    if (extra.length) o.tags = [...new Set((o.tags || []).concat(extra))];
    if (!o.subject) o.subject = settings.subject;
    o.collectionId = addCollectionId;
    stores[active].items.push(norm(o));
  }
  saveActive();
  refreshTagPicker();
  resetPendingImgs();
  pendingTags = new Set();
  modal.classList.remove('open');
  applyFilters();
};

/* ---------- 编辑弹窗 ----------
   图片改动走「草稿」：在弹窗里的增删只改草稿，点「保存」才落盘并清理被移除的图片；
   点「取消」/关闭则丢弃本次新增的图片，不动原始条目。 */
const editModal = document.getElementById('editModal');
let editImgs = [];      // 草稿图片列表
let editOrig = null;    // 打开弹窗时的原始图片集合

function renderEditThumbs() {
  renderThumbs(document.getElementById('editThumbs'), editImgs,
    id => { editImgs = editImgs.filter(x => x !== id); renderEditThumbs(); },
    (dir, id) => { editImgs = moveInArray(editImgs, dir, id); renderEditThumbs(); });
}
document.getElementById('editImgBtn').onclick = () => document.getElementById('editImgInput').click();
document.getElementById('editImgInput').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !editOrig) return;
  const holder = { images: [] };
  const n = await attachImages(holder, files);
  editImgs = editImgs.concat(holder.images);
  document.getElementById('editImgMsg').textContent = n ? `已添加 ${n} 张` : '没有可用的图片';
  renderEditThumbs();
};
document.getElementById('editDrop').addEventListener('click', () => document.getElementById('editImgInput').click());
bindDropzone(document.getElementById('editDrop'), async files => {
  if (!editOrig) return;
  const holder = { images: [] };
  const n = await attachImages(holder, files);
  editImgs = editImgs.concat(holder.images);
  document.getElementById('editImgMsg').textContent = n ? `已添加 ${n} 张` : '没有可用的图片';
  renderEditThumbs();
});

function openEdit(it) {
  editingId = it.id;
  editOrig = new Set(it.images || []);
  editImgs = (it.images || []).slice();
  const d = DEF[active];
  document.getElementById('editTitle').textContent = active === 'q'
    ? `编辑错题（${SUBJECT_SHORT[it.subject] || ''}）`
    : `编辑知识点（${SUBJECT_SHORT[it.subject] || ''}）`;
  document.getElementById('editForm').innerHTML = Object.entries(d.fieldLabels).map(([key, label]) => `
    <label class="f-label">${esc(label)}</label>
    <textarea id="ef_${key}" rows="4"></textarea>
  `).join('') + `
    <label class="f-label">标签（逗号分隔）</label>
    <input id="ef_tags" class="field-input" type="text" placeholder="卷积, 傅里叶变换">
    <div id="editPreset"></div>
    <label class="f-label">所属合集</label>
    <select id="ef_collection" class="field-input">${collectionOptionsHtml(active, it.collectionId)}</select>
  `;
  for (const key of Object.keys(d.fieldLabels)) document.getElementById('ef_' + key).value = it[key] || '';
  document.getElementById('ef_tags').value = it.tags.join(', ');

  // 预设标签：点击直接切换该标签在输入框中的存在与否
  const presetBox = document.getElementById('editPreset');
  presetBox.innerHTML = `<div class="preset-group">预设标签 · ${esc(SUBJECT[it.subject] || '')}</div>` + presetTagsHTML(it.subject);
  const on = t => document.getElementById('ef_tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean).includes(t);
  presetBox.querySelectorAll('.preset-tag').forEach(b => {
    b.onclick = () => {
      const t = b.dataset.tag;
      const el = document.getElementById('ef_tags');
      const list = el.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const i = list.indexOf(t);
      if (i >= 0) list.splice(i, 1); else list.push(t);
      el.value = list.join(', ');
      paintPresetState(presetBox, on);
    };
  });
  paintPresetState(presetBox, on);

  const colSel = document.getElementById('ef_collection');
  colSel.onchange = () => {
    if (colSel.value !== '__new__') return;
    const name = prompt('新建合集名称：');
    const id = name == null ? null : addCollectionQuick(active, null, name);
    colSel.innerHTML = collectionOptionsHtml(active, id != null ? id : it.collectionId);
  };

  document.getElementById('editImgMsg').textContent = '';
  renderEditThumbs();
  editModal.classList.add('open');
}
function finishEdit() {
  editImgs = []; editOrig = null; editingId = null;
  editModal.classList.remove('open');
}
function cancelEdit() {
  if (editOrig) editImgs.filter(id => !editOrig.has(id)).forEach(dropImage);
  finishEdit();
}
document.getElementById('editCancel').onclick = cancelEdit;
editModal.onclick = e => { if (e.target === editModal) cancelEdit(); };
document.getElementById('editSave').onclick = () => {
  const it = curItems().find(x => x.id === editingId);
  if (!it) return;
  for (const key of Object.keys(DEF[active].fieldLabels)) it[key] = document.getElementById('ef_' + key).value.trim();
  it.tags = document.getElementById('ef_tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const colVal = document.getElementById('ef_collection').value;
  it.collectionId = (colVal && colVal !== '__new__') ? colVal : null;
  it.updatedAt = Date.now();
  if (editOrig) [...editOrig].filter(id => !editImgs.includes(id)).forEach(dropImage);
  it.images = editImgs.slice();
  saveActive();
  refreshTagPicker();
  render();
  finishEdit();
};

/* ---------- 随机复习 ---------- */
const randomModal = document.getElementById('randomModal');
randomBtn.onclick = () => {
  const pool = currentFiltered();
  if (!pool.length) return alert('当前筛选下没有内容。');
  const it = pool[Math.floor(Math.random() * pool.length)];
  const d = DEF[active];
  document.getElementById('randomTitle').textContent = d.overviewTitle;
  const secs = visibleSections(it);
  document.getElementById('randomBody').innerHTML = `
    ${d.main(it)}
    ${imgStrip(it)}
    <div class="meta">
      <span class="duechip${isDue(it) ? ' due' : ''}">🕒 ${dueLabel(it)}</span>
      ${it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
      <span class="spacer"></span>
      <span class="status ${it.status}">● ${STATUS[it.status]}</span>
    </div>
    ${secs.map(x => `<details><summary>${x.label}</summary><div class="body">${sectionHTML(x, it.images)}</div></details>`).join('')}
  `;
  hydrateImages(document.getElementById('randomBody'));
  randomModal.classList.add('open');
};
document.getElementById('randomClose').onclick = () => randomModal.classList.remove('open');
document.getElementById('randomNext').onclick = () => randomBtn.click();
randomModal.onclick = e => { if (e.target === randomModal) randomModal.classList.remove('open'); };

/* ---------- 导出 / 导入（两库一起） ---------- */
function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
const FILE_BASE = '信号与系统DSP复习本';

// 体积小的纯文字备份（不含配图）
document.getElementById('exportBtn').onclick = () => {
  const payload = {
    version: 3, app: 'ss-dsp-review-book',
    questions: stores.q.items, knowledge: stores.k.items,
    collections: { q: colStores.q, k: colStores.k },
  };
  downloadBlob(`${FILE_BASE}-${dateStamp()}.json`,
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  setBackupMeta(Object.assign(getBackupMeta(), { json: Date.now() }));
  updateBackupBar();
};

// 完整备份：把配图以 base64 一并写入，换设备后可完整还原
document.getElementById('exportFullBtn').onclick = async () => {
  settingsDrawer.classList.remove('open');
  const payload = { version: 4, app: 'ss-dsp-review-book', questions: stores.q.items, knowledge: stores.k.items, collections: { q: colStores.q, k: colStores.k }, images: {} };
  try {
    for (const id of referencedImageIds()) {
      const rec = await idbGet(id);
      if (rec && rec.blob) payload.images[id] = { type: rec.type || 'image/jpeg', data: await blobToB64(rec.blob) };
    }
  } catch (e) { /* 图片读取失败时仍导出文字部分 */ }
  downloadBlob(`${FILE_BASE}-完整备份-${dateStamp()}.json`,
    new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  setBackupMeta(Object.assign(getBackupMeta(), { json: Date.now() }));
  updateBackupBar();
};

document.getElementById('gcBtn').onclick = async () => {
  const n = await gcImages();
  alert(n ? `已清理 ${n} 张无用图片。` : '没有发现无用图片。');
};

document.getElementById('importBtn2').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (err) { alert('文件不是合法的 JSON。'); return; }

    let qs = null, ks = null, imgs = null, cols = null;
    if (Array.isArray(data)) {
      qs = data;
    } else if (data && typeof data === 'object') {
      if (Array.isArray(data.questions)) qs = data.questions;
      if (Array.isArray(data.knowledge)) ks = data.knowledge;
      if (data.images && typeof data.images === 'object') imgs = data.images;
      if (data.collections && typeof data.collections === 'object') cols = data.collections;
    }
    if (qs === null && ks === null) { alert('文件结构不符合要求，未做任何修改。'); return; }
    if (qs && !qs.every(x => x && typeof x === 'object')) { alert('questions 结构非法，未做任何修改。'); return; }
    if (ks && !ks.every(x => x && typeof x === 'object')) { alert('knowledge 结构非法，未做任何修改。'); return; }

    const mode = confirm('点「确定」= 替换现有全部数据；点「取消」= 追加到现有数据之后。');
    if (!mode) {
      const dupQ = qs ? countDups('q', qs) : 0;
      const dupK = ks ? countDups('k', ks) : 0;
      if (dupQ + dupK) {
        const parts = [];
        if (dupQ) parts.push(`错题 ${dupQ} 道`);
        if (dupK) parts.push(`知识点 ${dupK} 个`);
        if (!confirm(`追加模式：检测到 ${parts.join('、')}与已有内容高度相似。仍要继续吗？`)) return;
      }
    }
    if (qs) { const inc = qs.map(normalizeQuestion); stores.q.items = mode ? inc : stores.q.items.concat(inc); saveStore(K_Q, stores.q.items); }
    if (ks) { const inc = ks.map(normalizeKp); stores.k.items = mode ? inc : stores.k.items.concat(inc); saveStore(K_K, stores.k.items); }

    // 合集树：替换模式整体替换（文件不含合集则清空）；追加模式并入现有树，再修正非法引用
    for (const kind of ['q', 'k']) {
      const incoming = (cols && Array.isArray(cols[kind])) ? cols[kind] : null;
      if (incoming) colStores[kind] = settleCollections(mode ? incoming : colStores[kind].concat(incoming));
      else if (mode) colStores[kind] = [];
      saveCols(kind);
      if (sanitizeItemCollections(stores[kind].items, colStores[kind])) saveStore(stores[kind].key, stores[kind].items);
    }

    let restored = 0;
    if (imgs) {
      for (const [id, rec] of Object.entries(imgs)) {
        if (!rec || typeof rec.data !== 'string') continue;
        try {
          const blob = b64ToBlob(rec.data, rec.type);
          await idbPut({ id, blob, type: rec.type || 'image/jpeg', size: blob.size || 0, addedAt: Date.now() });
          restored++;
        } catch (e) { /* 单张失败忽略 */ }
      }
    }
    if (mode) await gcImages();

    refreshTagPicker();
    applyFilters();
    alert(`导入完成：错题 ${stores.q.items.length} 道，知识点 ${stores.k.items.length} 个。` +
      (restored ? `\n已还原配图 ${restored} 张。` : ''));
  };
  reader.readAsText(file);
};

/* ---------- 统计 ---------- */
const statsModal = document.getElementById('statsModal');
document.getElementById('statsClose').onclick = () => statsModal.classList.remove('open');
statsModal.onclick = e => { if (e.target === statsModal) statsModal.classList.remove('open'); };
document.getElementById('openStats').onclick = () => {
  settingsDrawer.classList.remove('open');
  renderStats();
  statsModal.classList.add('open');
};

function statRow(label, value, total, cls) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return `<div class="stat-line"><span>${label}</span><b>${value}</b></div>
    <div class="stat-bar ${cls || ''}"><i style="width:${pct}%"></i></div>`;
}

function renderStats() {
  const week = Date.now() - 7 * 86400000;
  const sum = (list, st) => list.filter(i => i.status === st).length;
  const starN = list => list.filter(i => i.star).length;
  const imgN = list => list.reduce((n, i) => n + (i.images ? i.images.length : 0), 0);
  const weekN = list => list.filter(i => (i.createdAt || 0) >= week).length;

  const q = stores.q.items, k = stores.k.items;
  const freq = new Map();
  [...q, ...k].forEach(i => i.tags.forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
  const topTags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const subLine = sub => {
    const qn = q.filter(i => i.subject === sub).length;
    const kn = k.filter(i => i.subject === sub).length;
    return `<div class="stat-line"><span>${SUBJECT[sub]}（${SUBJECT_SHORT[sub]}）</span><b>${qn + kn}</b></div>`;
  };

  document.getElementById('statsBody').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <h3>错题</h3>
        ${statRow('总计', q.length, q.length)}
        ${statRow('未复习', sum(q, 'new'), q.length)}
        ${statRow('复习中', sum(q, 'reviewing'), q.length, 'warn')}
        ${statRow('已掌握', sum(q, 'mastered'), q.length, 'ok')}
        <div class="stat-line"><span>⭐ 收藏</span><b>${starN(q)}</b></div>
        <div class="stat-line"><span>近 7 天新增</span><b>${weekN(q)}</b></div>
      </div>
      <div class="stat-card">
        <h3>知识点</h3>
        ${statRow('总计', k.length, k.length)}
        ${statRow('未复习', sum(k, 'new'), k.length)}
        ${statRow('复习中', sum(k, 'reviewing'), k.length, 'warn')}
        ${statRow('已掌握', sum(k, 'mastered'), k.length, 'ok')}
        <div class="stat-line"><span>⭐ 收藏</span><b>${starN(k)}</b></div>
        <div class="stat-line"><span>近 7 天新增</span><b>${weekN(k)}</b></div>
      </div>
    </div>
    <div class="stat-card" style="margin-top:12px">
      <h3>科目分布</h3>
      ${subLine('ss')}
      ${subLine('dsp')}
    </div>
    <div class="stat-card" style="margin-top:12px">
      <h3>其他</h3>
      <div class="stat-line"><span>配图数量</span><b>${imgN(q) + imgN(k)}</b></div>
      <div class="stat-line"><span>标签数量</span><b>${freq.size}</b></div>
      <div class="stat-line"><span>回收站</span><b>${trash.length}</b></div>
      <div style="margin-top:8px">
        <span class="section-label">常用标签</span>
        <div class="tagfreq">${topTags.length
          ? topTags.map(([t, n]) => `<span class="chip">${esc(t)} · ${n}</span>`).join('')
          : '<span class="section-label">暂无标签</span>'}</div>
      </div>
    </div>
  `;
}

/* ---------- 导出 Markdown ---------- */
function toMarkdown() {
  const isQ = active === 'q';
  const items = curItems().filter(i => i.subject === settings.subject).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const out = [
    `# ${FILE_BASE} · ${curSubjectName()} · ${isQ ? '错题' : '知识点'}`, '',
    `> 导出时间：${new Date().toLocaleString('zh-CN')} · 共 ${items.length} 项`, '',
  ];
  items.forEach((it, idx) => {
    const tags = it.tags.join('、') || '—';
    out.push(`## ${idx + 1}. ${STATUS[it.status]}${it.star ? ' ★' : ''}`);
    out.push('');
    out.push(`标签：${tags}`);
    out.push('');
    if (isQ) {
      out.push('**题目**');
      out.push('');
      out.push(it.stem || '（无题目）');
      if (it.myAnswer) { out.push(''); out.push('**我的错误答案**'); out.push(''); out.push(it.myAnswer); }
      if (it.analysis) { out.push(''); out.push('**解析**'); out.push(''); out.push(it.analysis); }
      if (it.knowledge) { out.push(''); out.push('**知识点**'); out.push(''); out.push(it.knowledge); }
    } else {
      out.push(`**${it.title || '（无名称）'}**`);
      if (it.content) { out.push(''); out.push(it.content); }
    }
    if (it.images && it.images.length) { out.push(''); out.push(`> 含配图 ${it.images.length} 张（图片未包含在 Markdown 中）`); }
    out.push('');
    out.push('---');
    out.push('');
  });
  return out.join('\n');
}

document.getElementById('exportMdBtn').onclick = () => {
  settingsDrawer.classList.remove('open');
  const isQ = active === 'q';
  const items = curItems().filter(i => i.subject === settings.subject);
  if (!items.length) { alert(`当前科目下的${isQ ? '错题' : '知识点'}库是空的。`); return; }
  const blob = new Blob([toMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${FILE_BASE}-${curSubjectShort()}-${isQ ? '错题' : '知识点'}-${dateStamp()}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ---------- 打印（当前视图 + 当前科目） ---------- */
document.getElementById('printBtn').onclick = () => {
  settingsDrawer.classList.remove('open');
  const isQ = active === 'q';
  const items = curItems().filter(i => i.subject === settings.subject).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  if (!items.length) { alert(`当前科目下的${isQ ? '错题' : '知识点'}库是空的。`); return; }
  const area = document.getElementById('printArea');
  const head = `<h1>${FILE_BASE} · ${curSubjectName()} · ${isQ ? '错题' : '知识点'}</h1>
    <p class="print-meta">共 ${items.length} 项 · ${new Date().toLocaleDateString('zh-CN')}</p>`;
  const body = items.map((it, i) => {
    const tags = it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const main = isQ ? renderMath(it.stem, it.images) : `<b>${renderMath(it.title, it.images)}</b>`;
    const secs = isQ
      ? [['我的错误答案', it.myAnswer], ['解析', it.analysis], ['知识点', it.knowledge]]
      : [['讲解', it.content]];
    const secHtml = secs.filter(s => s[1]).map(s =>
      `<div class="print-sec"><div class="print-label">${s[0]}</div><div>${renderMath(s[1], it.images)}</div></div>`).join('');
    return `<div class="print-item">
      <div class="print-num">第 ${i + 1} 题${isQ ? '' : '（知识点）'} · ${STATUS[it.status]}${it.star ? ' ★' : ''}</div>
      <div class="print-head">${main}</div>
      ${tags ? `<div class="print-tags">${tags}</div>` : ''}
      ${imgStrip(it)}
      ${secHtml}
    </div>`;
  }).join('');
  area.innerHTML = head + body;
  hydrateImages(area);
  setTimeout(() => window.print(), 350);
};

/* ---------- 备份提醒 ---------- */
const BACKUP_DAYS = 14;
const SNOOZE_DAYS = 7;
function getBackupMeta() {
  try { return JSON.parse(localStorage.getItem(K_LASTEXPORT)) || {}; } catch (e) { return {}; }
}
function setBackupMeta(o) {
  try { localStorage.setItem(K_LASTEXPORT, JSON.stringify(o)); } catch (e) {}
}
function updateBackupBar() {
  const bar = document.getElementById('backupBar');
  if (!bar) return;
  const total = stores.q.items.length + stores.k.items.length;
  const meta = getBackupMeta();
  if (!total || (meta.snooze && Date.now() - meta.snooze < SNOOZE_DAYS * 86400000)) {
    bar.style.display = 'none';
    return;
  }
  let txt;
  if (!meta.json) {
    txt = '你还没导出过备份，建议现在导出一份 JSON，避免数据丢失。';
  } else {
    const days = Math.floor((Date.now() - meta.json) / 86400000);
    if (days < BACKUP_DAYS) { bar.style.display = 'none'; return; }
    txt = `距上次备份已 ${days} 天，建议再导出一份 JSON 备份。`;
  }
  document.getElementById('backupText').textContent = txt;
  bar.style.display = 'flex';
}
document.getElementById('backupNow').onclick = () => document.getElementById('exportBtn').click();
document.getElementById('backupLater').onclick = () => {
  setBackupMeta(Object.assign(getBackupMeta(), { snooze: Date.now() }));
  updateBackupBar();
};

/* ---------- 返回顶部 ---------- */
const toTopEl = document.getElementById('toTop');
function updateToTop() {
  toTopEl.classList.toggle('show', window.scrollY > 400 && !cram.open);
}
window.addEventListener('scroll', updateToTop, { passive: true });
toTopEl.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

/* ---------- 背题模式 ---------- */
const cramEl = document.getElementById('cram');
const cramStage = document.getElementById('cramStage');
const cram = { open: false, pool: [], idx: 0, shown: {} };

function cramGo(delta) {
  cram.idx = Math.max(0, Math.min(cram.pool.length - 1, cram.idx + delta));
  cram.shown = {};
  renderCram();
}

function revealNext() {
  const it = cram.pool[cram.idx];
  if (!it) return;
  const next = visibleSections(it).filter(x => x.text).find(x => !cram.shown[x.label]);
  if (next) { cram.shown[next.label] = true; renderCram(); }
}

function renderCram() {
  const d = DEF[active];
  const it = cram.pool[cram.idx];
  if (!it) { closeCram(); return; }
  document.getElementById('cramProg').textContent = `${cram.idx + 1} / ${cram.pool.length} · ${curSubjectShort()}`;
  document.getElementById('cramPrev').disabled = cram.idx === 0;
  document.getElementById('cramNext').disabled = cram.idx === cram.pool.length - 1;

  const secs = visibleSections(it).filter(x => x.text);
  const secHtml = secs.map(x => cram.shown[x.label]
    ? `<div class="cram-sec"><span class="section-label">${esc(x.label.replace('查看', ''))}</span><div class="cram-body">${sectionHTML(x, it.images)}</div></div>`
    : `<button class="cram-reveal" data-reveal="${esc(x.label)}">👁 ${esc(x.label.replace('查看', '看'))}</button>`
  ).join('');

  cramStage.innerHTML = `
    <div class="cram-card">
      <div class="cram-meta">
        <button class="star ${it.star ? 'on' : ''}" data-cram-star title="收藏">${it.star ? '★' : '☆'}</button>
        ${it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        <span class="spacer"></span>
        <span class="status ${it.status}" data-cram-status>● ${STATUS[it.status]}</span>
      </div>
      ${d.main(it)}
      ${imgStrip(it)}
      ${secHtml}
      <p class="cram-hint">${secs.length ? '左右滑动 / 点下方按钮翻页 · 空格键揭示下一段' : '（这一项没有解析或讲解内容）'}</p>
    </div>
  `;
  hydrateImages(cramStage);

  cramStage.querySelector('[data-cram-status]').onclick = () => {
    applyStatus(it, STATUS_NEXT[it.status]);
    renderCram();
  };
  cramStage.querySelector('[data-cram-star]').onclick = () => {
    it.star = !it.star;
    saveActive();
    renderCram();
  };
  cramStage.querySelectorAll('[data-reveal]').forEach(b => {
    b.onclick = () => { cram.shown[b.dataset.reveal] = true; renderCram(); };
  });
  cramStage.scrollTop = 0;
}

function openCram() {
  const pool = currentFiltered();
  if (!pool.length) { alert('当前筛选下没有内容。'); return; }
  cram.open = true;
  cram.pool = pool;
  cram.idx = 0;
  cram.shown = {};
  cramEl.classList.add('open');
  document.body.style.overflow = 'hidden';
  updateToTop();
  renderCram();
}
function closeCram() {
  cram.open = false;
  cramEl.classList.remove('open');
  document.body.style.overflow = '';
  updateToTop();
}
document.getElementById('cramBtn').onclick = openCram;
document.getElementById('cramExit').onclick = closeCram;
document.getElementById('cramPrev').onclick = () => cramGo(-1);
document.getElementById('cramNext').onclick = () => cramGo(1);

let cramSX = 0, cramSY = 0;
cramStage.addEventListener('touchstart', e => {
  cramSX = e.touches[0].clientX; cramSY = e.touches[0].clientY;
}, { passive: true });
cramStage.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - cramSX;
  const dy = e.changedTouches[0].clientY - cramSY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) cramGo(dx < 0 ? 1 : -1);
}, { passive: true });

/* 统一键盘处理：图片查看 > 背题模式 > 设置抽屉 */
document.addEventListener('keydown', e => {
  if (lightbox.classList.contains('open')) {
    if (e.key === 'ArrowRight') lbGo(1);
    else if (e.key === 'ArrowLeft') lbGo(-1);
    else if (e.key === 'Escape') lbClose();
    else if (e.key === '+' || e.key === '=') lbZoom(1.25);
    else if (e.key === '-' || e.key === '_') lbZoom(0.8);
    else if (e.key === 'r' || e.key === 'R') { lb.rot = (lb.rot + 90) % 360; lbApply(); }
    return;
  }
  if (cram.open) {
    if (e.key === 'ArrowRight') cramGo(1);
    else if (e.key === 'ArrowLeft') cramGo(-1);
    else if (e.key === 'Escape') closeCram();
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); revealNext(); }
    return;
  }
  if (e.key === 'Escape') {
    if (settingsDrawer.classList.contains('open')) settingsDrawer.classList.remove('open');
    else if (refDrawer.classList.contains('open')) refDrawer.classList.remove('open');
    else if (plotDrawer.classList.contains('open')) closePlotDrawer();
    else if (genDrawer.classList.contains('open')) closeGenDrawer();
  }
});

/* ---------- 设置抽屉 ---------- */
const settingsDrawer = document.getElementById('settingsDrawer');
document.getElementById('settingsBtn').onclick = () => settingsDrawer.classList.add('open');
document.getElementById('settingsClose').onclick = () => settingsDrawer.classList.remove('open');
settingsDrawer.onclick = e => { if (e.target === settingsDrawer) settingsDrawer.classList.remove('open'); };
settingsDrawer.querySelectorAll('.seg button').forEach(btn => {
  btn.onclick = () => {
    const key = btn.closest('.seg').id.slice(3).toLowerCase(); // setCols→cols / setImgSize→imgsize
    settings[key] = btn.dataset[key];
    saveSettings();
    applySettings();
  };
});

window.addEventListener('resize', debounce(applySettings, 120));
if (mqDark.addEventListener) mqDark.addEventListener('change', applySettings);
if (mqMotion.addEventListener) mqMotion.addEventListener('change', applySettings);

/* ===================== 速查表（变换对 / 性质 / 连续↔离散） ===================== */
const refDrawer = document.getElementById('refDrawer');
const refList = document.getElementById('refList');
const refMsg = document.getElementById('refMsg');
const refSearchEl = document.getElementById('refSearch');
const refTabsEl = document.getElementById('refTabs');
let refTab = 'pairs';

const REF_GROUP_LABEL = {
  ctft: '连续时间傅里叶变换（CTFT）',
  laplace: '拉普拉斯变换',
  z: 'Z 变换',
  dft: '离散傅里叶变换（DFT / DTFT）',
};
const PROP_ROWS = [['ctft', '连续 FT'], ['laplace', '拉普拉斯'], ['z', 'Z 变换']];

function katexInline(latex) {
  try { return katex.renderToString(latex, { throwOnError: false }); }
  catch (e) { return esc(latex); }
}

function renderRef() {
  const res = MQT.searchTransforms
    ? MQT.searchTransforms(refSearchEl.value)
    : { pairs: [], props: [], contrasts: [] };
  const parts = [];

  if (refTab === 'pairs' || refTab === 'all') {
    parts.push(`<div class="ref-group">变换对（${res.pairs.length}）</div>`);
    if (!res.pairs.length) parts.push('<div class="ref-note">没有匹配的变换对。</div>');
    const by = new Map();
    res.pairs.forEach(p => {
      if (!by.has(p.group)) by.set(p.group, []);
      by.get(p.group).push(p);
    });
    for (const [g, arr] of by) {
      parts.push(`<div class="ref-sub">${esc(REF_GROUP_LABEL[g] || g)}</div>`);
      arr.forEach(p => parts.push(`
        <div class="ref-item">
          <div class="ref-head">${esc(p.name)}</div>
          <div class="ref-latex ref-inline">${katexInline(p.time)}<span class="ref-arrow">↔</span>${katexInline(p.transform)}</div>
          ${p.note ? `<div class="ref-note">${esc(p.note)}</div>` : ''}
        </div>`));
    }
  }

  if (refTab === 'props' || refTab === 'all') {
    parts.push(`<div class="ref-group">变换性质（${res.props.length}）</div>`);
    if (!res.props.length) parts.push('<div class="ref-note">没有匹配的性质。</div>');
    res.props.forEach(p => {
      const rows = PROP_ROWS.filter(([k]) => p[k]);
      parts.push(`
        <div class="ref-item">
          <div class="ref-head">${esc(p.name)}</div>
          ${rows.map(([k, l]) => `<div class="ref-sub">${l}</div><div class="ref-latex">${katexInline(p[k])}</div>`).join('')}
          ${p.note ? `<div class="ref-note">${esc(p.note)}</div>` : ''}
        </div>`);
    });
  }

  if (refTab === 'contrast' || refTab === 'all') {
    parts.push(`<div class="ref-group">连续 ↔ 离散 对照（${res.contrasts.length}）</div>`);
    if (!res.contrasts.length) parts.push('<div class="ref-note">没有匹配的对照项。</div>');
    res.contrasts.forEach(c => parts.push(`
      <div class="ref-item">
        <div class="ref-head">${esc(c.concept)}</div>
        <div class="ref-sub">连续时间</div>
        <div class="ref-latex">${katexInline(c.cont)}</div>
        <div class="ref-sub">离散时间</div>
        <div class="ref-latex">${katexInline(c.disc)}</div>
        ${c.note ? `<div class="ref-note">${esc(c.note)}</div>` : ''}
      </div>`));
  }

  const total = res.pairs.length + res.props.length + res.contrasts.length;
  refMsg.textContent = refSearchEl.value.trim()
    ? `匹配到 ${total} 条 · 变换对 ${res.pairs.length} · 性质 ${res.props.length} · 对照 ${res.contrasts.length}`
    : `共 ${total} 条 · 变换对 ${res.pairs.length} · 性质 ${res.props.length} · 对照 ${res.contrasts.length}`;
  refList.innerHTML = parts.join('') || '<div class="ref-note">没有内容。</div>';
}

document.getElementById('refBtn').onclick = () => { renderRef(); refDrawer.classList.add('open'); };
document.getElementById('refClose').onclick = () => refDrawer.classList.remove('open');
refDrawer.onclick = e => { if (e.target === refDrawer) refDrawer.classList.remove('open'); };
refSearchEl.oninput = debounce(renderRef, 150);
refTabsEl.querySelectorAll('button').forEach(b => {
  b.onclick = () => {
    refTab = b.dataset.ref;
    refTabsEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderRef();
  };
});

/* ===================== 绘图（波形 / 频谱 / 波特图 / 零极图 / 卷积图解） ===================== */
const plotDrawer = document.getElementById('plotDrawer');
const plotKindEl = document.getElementById('plotKind');
const plotFieldsEl = document.getElementById('plotFields');
const plotCanvas = document.getElementById('plotCanvas');
const plotNoteEl = document.getElementById('plotNote');
const plotConvCtl = document.getElementById('plotConvCtl');
const convShiftEl = document.getElementById('convShift');
const convShiftVal = document.getElementById('convShiftVal');

let plotKind = 'ct';
let plotTarget = null;      // null | 'add' | 'edit'：绘图后「存为配图」的目标
let convCtl = null;
let convPlaying = false;
let convRafId = 0;
let convMode = 'continuous';
const plotSampleIdx = {};
const plotCache = {};       // 记录各图型上次填写的参数，重新打开时不至于回到默认值

const PLOT_FIELDS = {
  ct: [
    { id: 'expr', label: '表达式 x(t)', val: 'sin(2*pi*t)*u(t)', wide: true },
    { id: 'tMin', label: 't 下限', val: '-2' },
    { id: 'tMax', label: 't 上限', val: '5' },
    { id: 'samples', label: '采样点数', val: '800' },
    { id: 'label', label: '图注（可选）', val: '', wide: true },
  ],
  dt: [
    { id: 'expr', label: '表达式 x[n]', val: '0.8^n*u(n)', wide: true },
    { id: 'nMin', label: 'n 下限', val: '-2' },
    { id: 'nMax', label: 'n 上限', val: '15' },
    { id: 'label', label: '图注（可选）', val: '', wide: true },
  ],
  spectrum: [
    { id: 'from', label: '来源', val: 'time', type: 'select',
      opts: [['time', '由序列 x[n] 做 DFT'], ['expr', '直接给频谱表达式（变量 w）']] },
    { id: 'mode', label: '绘制', val: 'mag', type: 'select',
      opts: [['mag', '幅度谱'], ['phase', '相位谱'], ['both', '幅相两图（仅表达式）']] },
    { id: 'expr', label: '表达式', val: '0.8^n', wide: true },
    { id: 'nMin', label: '(序列) n 下限', val: '0' },
    { id: 'nMax', label: '(序列) n 上限', val: '7' },
    { id: 'kMax', label: 'DFT 点数 kMax', val: '7' },
    { id: 'wMin', label: '(表达式) ω 下限', val: '0' },
    { id: 'wMax', label: '(表达式) ω 上限', val: '10' },
    { id: 'label', label: '图注（可选）', val: '', wide: true },
  ],
  bode: [
    { id: 'num', label: '分子系数（高次→常数）', val: '[1]', wide: true },
    { id: 'den', label: '分母系数', val: '[1, 1]', wide: true },
    { id: 'domain', label: '域', val: 's', type: 'select',
      opts: [['s', 's 域（连续，ω∈[0,∞)）'], ['z', 'z 域（离散，ω∈[0,π]）']] },
    { id: 'wMin', label: 'ω 下限', val: '0.01' },
    { id: 'wMax', label: 'ω 上限', val: '100' },
    { id: 'samples', label: '采样点数', val: '400' },
    { id: 'label', label: '图注（可选）', val: '', wide: true },
  ],
  polezero: [
    { id: 'num', label: '分子系数', val: '[1, -0.2]', wide: true },
    { id: 'den', label: '分母系数', val: '[1, -0.9]', wide: true },
    { id: 'domain', label: '域', val: 'z', type: 'select',
      opts: [['s', 's 域（左半平面 → 稳定）'], ['z', 'z 域（单位圆内 → 稳定）']] },
    { id: 'label', label: '图注（可选）', val: '', wide: true },
  ],
  conv: [
    { id: 'mode', label: '类型', val: 'continuous', type: 'select',
      opts: [['continuous', '连续卷积 y(t)=x*h'], ['discrete', '离散卷积和 y[n]=x*h']] },
    { id: 'exprA', label: '信号 A', val: 'u(t)-u(t-1)', wide: true },
    { id: 'exprB', label: '信号 B', val: 'rect(t)', wide: true },
    { id: 'varMin', label: '变量下限', val: '-1' },
    { id: 'varMax', label: '变量上限', val: '3' },
    { id: 'samples', label: '采样点数（连续）', val: '400' },
  ],
  sampling: [
    { id: 'from', label: '基带来源', val: 'expr', type: 'select',
      opts: [['expr', '基带频谱表达式（变量 w）'], ['tf', '系统函数系数 |H(jω)|']] },
    { id: 'expr', label: '基带频谱表达式', val: 'rect(w/6)', wide: true },
    { id: 'num', label: '分子系数（tf 模式）', val: '[1]', wide: true },
    { id: 'den', label: '分母系数（tf 模式）', val: '[1, 1]', wide: true },
    { id: 'domain', label: '域（tf 模式）', val: 's', type: 'select',
      opts: [['s', 's 域（连续）'], ['z', 'z 域（离散）']] },
    { id: 'ws', label: '抽样角频率 ω_s（留空=不画复制）', val: '12' },
    { id: 'wMax', label: 'ω 上限', val: '18' },
    { id: 'samples', label: '采样点数', val: '600' },
    { id: 'label', label: '图注（可选）', val: '', wide: true },
  ],
  window: [
    { id: 'n', label: '窗长 N', val: '21' },
    { id: 'types', label: '窗类型（逗号分隔）', val: 'rect,hann,hamming,blackman', wide: true },
    { id: 'wMax', label: 'ω 上限', val: '3.1416' },
    { id: 'label', label: '图注（可选）', val: '', wide: true },
  ],
  groupdelay: [
    { id: 'num', label: '分子系数（高次→常数）', val: '[1]', wide: true },
    { id: 'den', label: '分母系数', val: '[1, 1]', wide: true },
    { id: 'domain', label: '域', val: 's', type: 'select',
      opts: [['s', 's 域（群延迟单位：秒）'], ['z', 'z 域（群延迟单位：样本）']] },
    { id: 'wMin', label: 'ω 下限', val: '0.01' },
    { id: 'wMax', label: 'ω 上限', val: '10' },
    { id: 'samples', label: '采样点数', val: '400' },
    { id: 'label', label: '图注（可选）', val: '', wide: true },
  ],
};

const CONV_SAMPLES = [
  { mode: 'continuous', exprA: 'u(t)-u(t-1)', exprB: 't', varMin: 0, varMax: 2.5, samples: 400 },
  { mode: 'discrete', exprA: 'u(n)-u(n-3)', exprB: '0.8^n*u(n)', varMin: -1, varMax: 8, samples: 40 },
];

const getFieldVal = id => {
  const el = document.getElementById('pf_' + id);
  return el ? el.value.trim() : '';
};
function parseCoeffs(s) {
  const body = String(s || '').trim().replace(/^[\[\(]/, '').replace(/[\]\)]$/, '');
  return body.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n));
}
function buildPlotFields() {
  const defs = PLOT_FIELDS[plotKind] || [];
  plotFieldsEl.innerHTML = defs.map(f => {
    const cached = plotCache[plotKind + ':' + f.id];
    const val = cached != null ? cached : f.val;
    if (f.type === 'select') {
      return `<label class="pf"><span>${esc(f.label)}</span>
        <select id="pf_${f.id}" class="field-input">${f.opts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select>
      </label>`;
    }
    return `<label class="pf${f.wide ? ' wide' : ''}"><span>${esc(f.label)}</span>
      <input id="pf_${f.id}" class="field-input" autocomplete="off" spellcheck="false" value="${esc(val)}">
    </label>`;
  }).join('');
  defs.forEach(f => {
    const el = document.getElementById('pf_' + f.id);
    if (!el) return;
    if (f.type === 'select') el.value = plotCache[plotKind + ':' + f.id] != null ? plotCache[plotKind + ':' + f.id] : f.val;
    el.addEventListener(f.type === 'select' ? 'change' : 'input', debounce(renderPlot, 250));
  });
  plotConvCtl.style.display = plotKind === 'conv' ? 'flex' : 'none';
}
function snapshotPlotFields() {
  (PLOT_FIELDS[plotKind] || []).forEach(f => {
    const el = document.getElementById('pf_' + f.id);
    if (el) plotCache[plotKind + ':' + f.id] = el.value;
  });
}
function readPlotSpec() {
  const dark = effectiveTheme() === 'dark';
  const n = id => Number(getFieldVal(id));
  if (plotKind === 'ct') return { kind: 'ct', expr: getFieldVal('expr'), tMin: n('tMin'), tMax: n('tMax'), samples: n('samples'), label: getFieldVal('label'), dark };
  if (plotKind === 'dt') return { kind: 'dt', expr: getFieldVal('expr'), nMin: n('nMin'), nMax: n('nMax'), label: getFieldVal('label'), dark };
  if (plotKind === 'spectrum') {
    const from = getFieldVal('from') === 'expr' ? 'expr' : 'time';
    return {
      kind: 'spectrum', from, mode: getFieldVal('mode'),
      expr: getFieldVal('expr'), var: from === 'time' ? 'n' : 'w',
      nMin: n('nMin'), nMax: n('nMax'), kMax: n('kMax'),
      wMin: n('wMin'), wMax: n('wMax'), samples: 400, label: getFieldVal('label'), dark,
    };
  }
  if (plotKind === 'bode') return { kind: 'bode', num: parseCoeffs(getFieldVal('num')), den: parseCoeffs(getFieldVal('den')), domain: getFieldVal('domain'), wMin: n('wMin'), wMax: n('wMax'), samples: n('samples'), label: getFieldVal('label'), dark };
  if (plotKind === 'polezero') return { kind: 'polezero', num: parseCoeffs(getFieldVal('num')), den: parseCoeffs(getFieldVal('den')), domain: getFieldVal('domain'), label: getFieldVal('label'), dark };
  if (plotKind === 'conv') return { kind: 'conv', mode: getFieldVal('mode') === 'discrete' ? 'discrete' : 'continuous', exprA: getFieldVal('exprA'), exprB: getFieldVal('exprB'), varMin: n('varMin'), varMax: n('varMax'), samples: n('samples'), dark };
  if (plotKind === 'sampling') return {
    kind: 'sampling', from: getFieldVal('from') === 'tf' ? 'tf' : 'expr',
    expr: getFieldVal('expr'), num: parseCoeffs(getFieldVal('num')), den: parseCoeffs(getFieldVal('den')),
    domain: getFieldVal('domain'), ws: getFieldVal('ws') === '' ? NaN : n('ws'),
    wMax: n('wMax'), samples: n('samples'), label: getFieldVal('label'), dark,
  };
  if (plotKind === 'window') return { kind: 'window', n: n('n'), types: getFieldVal('types'), wMax: n('wMax'), label: getFieldVal('label'), dark };
  if (plotKind === 'groupdelay') return { kind: 'groupdelay', num: parseCoeffs(getFieldVal('num')), den: parseCoeffs(getFieldVal('den')), domain: getFieldVal('domain'), wMin: n('wMin'), wMax: n('wMax'), samples: n('samples'), label: getFieldVal('label'), dark };
  return { kind: plotKind, dark };
}

function clearCanvas() {
  try {
    const ctx = plotCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, plotCanvas.width, plotCanvas.height);
  } catch (e) {}
}
function convShiftLabel(v) {
  return (convMode === 'discrete' ? 'n = ' : 'τ = ') + (Math.round(v * 1000) / 1000);
}
function destroyConv() {
  stopConvSync();
  if (convCtl) { try { convCtl.destroy(); } catch (e) {} convCtl = null; }
}
function renderPlot() {
  const spec = readPlotSpec();
  snapshotPlotFields();
  if (plotKind === 'conv') { renderConv(spec); return; }
  destroyConv();
  if (!MQP.drawPlot) { plotNoteEl.textContent = '绘图模块（plot.js）未加载'; return; }
  const r = MQP.drawPlot(plotCanvas, spec);
  plotNoteEl.textContent = r === null ? '无法绘制（缺少 canvas 上下文）' : '';
}
function renderConv(spec) {
  destroyConv();
  if (!MQV.createConvController || !MQV.parseConvSpec) { plotNoteEl.textContent = '卷积模块（conv.js）未加载'; return; }
  const parsed = MQV.parseConvSpec(spec);
  convMode = parsed.mode || 'continuous';
  if (parsed.error) { plotNoteEl.textContent = parsed.error; clearCanvas(); return; }
  plotNoteEl.textContent = '';
  convCtl = MQV.createConvController(plotCanvas, parsed);
  convShiftEl.min = String(parsed.varMin);
  convShiftEl.max = String(parsed.varMax);
  convShiftEl.step = String(convMode === 'discrete' ? 1 : ((parsed.varMax - parsed.varMin) / 200 || 0.01));
  convShiftEl.value = String(parsed.varMin);
  convShiftVal.textContent = convShiftLabel(parsed.varMin);
}
function setConvPlayLabel() {
  document.getElementById('convPlay').textContent = convPlaying ? '⏸ 暂停' : '▶ 播放';
}
function startConvSync() {
  const step = () => {
    if (!convPlaying || !convCtl) return;
    const v = convCtl.getShift();
    convShiftEl.value = String(v);
    convShiftVal.textContent = convShiftLabel(v);
    convRafId = requestAnimationFrame(step);
  };
  convRafId = requestAnimationFrame(step);
}
function stopConvSync() {
  convPlaying = false;
  if (convRafId) { cancelAnimationFrame(convRafId); convRafId = 0; }
  setConvPlayLabel();
}
function openPlotDrawer(target) {
  plotTarget = target || null;
  plotDrawer.classList.add('open');
  buildPlotFields();
  renderPlot();
}
function closePlotDrawer() {
  destroyConv();
  plotDrawer.classList.remove('open');
  plotTarget = null;
}
function plotSamples() {
  if (plotKind === 'conv') return CONV_SAMPLES;
  return (MQP.PREVIEW && MQP.PREVIEW[plotKind]) || [];
}
function applyPlotValues(o) {
  (PLOT_FIELDS[plotKind] || []).forEach(f => {
    if (!(f.id in o)) return;
    let v = o[f.id];
    if (Array.isArray(v)) v = '[' + v.join(', ') + ']';
    const el = document.getElementById('pf_' + f.id);
    if (el) el.value = String(v);
    plotCache[plotKind + ':' + f.id] = String(v);
  });
}
function canvasToBlob(canvas) {
  return new Promise(res => {
    if (!canvas || !canvas.toBlob) { res(null); return; }
    try { canvas.toBlob(b => res(b), 'image/png'); } catch (e) { res(null); }
  });
}
async function savePlotAsImage() {
  const blob = await canvasToBlob(plotCanvas);
  if (!blob) { plotNoteEl.textContent = '导出图片失败'; return; }
  if (plotTarget === 'edit' || plotTarget === 'add') {
    const id = 'img_' + uid();
    await idbPut({ id, blob, type: 'image/png', size: blob.size || 0, addedAt: Date.now() });
    if (plotTarget === 'edit') {
      editImgs = editImgs.concat(id);
      renderEditThumbs();
      document.getElementById('editImgMsg').textContent = '已把绘制的图存为配图';
    } else {
      pendingImgs = pendingImgs.concat(id);
      addImgRow.style.display = 'block';
      renderPendingThumbs();
      document.getElementById('addImgMsg').textContent = '已把绘制的图存为配图';
    }
    closePlotDrawer();
  } else {
    downloadBlob('plot-' + dateStamp() + '.png', blob);
    plotNoteEl.textContent = '已下载 PNG';
  }
}

plotKindEl.querySelectorAll('button').forEach(b => {
  b.onclick = () => {
    plotKind = b.dataset.kind;
    plotKindEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    destroyConv();
    buildPlotFields();
    renderPlot();
  };
});
document.getElementById('plotRender').onclick = renderPlot;
document.getElementById('plotSample').onclick = () => {
  const list = plotSamples();
  if (!list.length) { plotNoteEl.textContent = '该图型没有内置示例'; return; }
  const i = (plotSampleIdx[plotKind] || 0) % list.length;
  plotSampleIdx[plotKind] = i + 1;
  applyPlotValues(list[i]);
  renderPlot();
  plotNoteEl.textContent = '已载入示例 ' + (i + 1) + '/' + list.length;
};
document.getElementById('plotSaveImg').onclick = savePlotAsImage;
document.getElementById('plotClose').onclick = closePlotDrawer;
document.getElementById('plotBtn').onclick = () => openPlotDrawer(null);
document.getElementById('addPlotBtn').onclick = () => openPlotDrawer('add');
document.getElementById('editPlotBtn').onclick = () => openPlotDrawer('edit');
plotDrawer.onclick = e => { if (e.target === plotDrawer) closePlotDrawer(); };
convShiftEl.oninput = () => {
  if (!convCtl) return;
  let v = Number(convShiftEl.value);
  if (convMode === 'discrete') v = Math.round(v);
  convCtl.setShift(v);
  convShiftVal.textContent = convShiftLabel(v);
};
document.getElementById('convPlay').onclick = () => {
  if (!convCtl) return;
  if (convPlaying) { convCtl.pause(); stopConvSync(); return; }
  convCtl.play();
  if (convCtl.isPlaying()) { convPlaying = true; setConvPlayLabel(); startConvSync(); }
  else { plotNoteEl.textContent = '当前环境不支持动画播放'; }
};

/* ===================== 一键生成（标签驱动 · 纯本地，不使用任何 API） =====================
   入口 MQG.plan(subject, item)：先按题目标签匹配「该生成哪些图 / 表」，
   再从题面文本确定性抽取表达式与系数，最后由 plot.js / transforms.js 的纯函数算出结果。
   本区只负责渲染与交互，全程不联网、不读取任何 Key。 */
const genDrawer = document.getElementById('genDrawer');
const genSubEl = document.getElementById('genSub');
const genParamsEl = document.getElementById('genParams');
const genListEl = document.getElementById('genList');

const GEN_NEED_NAME = {
  ct: '连续信号', dt: '离散序列', tf: '系统函数', diff: '差分方程',
  samp: '抽样参数', pair: '两路信号', signal: '任一信号',
};

// 该条目是否有任一标签能驱动生成（决定卡片是否显示「⚡ 生成」）
function hasGenPlan(it) {
  if (!MQG.tagRule) return false;
  const subject = it.subject || settings.subject;
  return (it.tags || []).some(t => {
    const r = MQG.tagRule(subject, t);
    return r && (r.plots.length || r.tables.length);
  });
}

function genTitleText(it) {
  const s = String((it && (it.stem || it.title)) || '').replace(/\$/g, '').replace(/\s+/g, ' ').trim();
  return s.length > 64 ? s.slice(0, 64) + '…' : s;
}

// 题面里自动识别到的参数，做成小圆片；识别不到的给一条提示
function genParamChips(params) {
  const chips = [];
  (params.ct || []).forEach(s => chips.push({ t: '连续信号 ' + s.name, hit: true }));
  (params.dt || []).forEach(s => chips.push({ t: '离散序列 ' + s.name, hit: true }));
  if (params.tf) chips.push({ t: '系统函数 ' + params.tf.name + '(' + params.tf.domain + ')', hit: true });
  if (params.diff) chips.push({ t: '差分方程（阶 ' + params.diff.order + '）', hit: true });
  if (params.samp) {
    const parts = [];
    if (params.samp.fs != null) parts.push('f_s=' + params.samp.fs);
    if (params.samp.fm != null) parts.push('f_m=' + params.samp.fm);
    if (params.samp.f0 != null) parts.push('f₀=' + params.samp.f0);
    if (params.samp.N != null) parts.push('N=' + params.samp.N);
    if (parts.length) chips.push({ t: '抽样参数 ' + parts.join(' '), hit: true });
  }
  (params.notes || []).forEach(n => chips.push({ t: n, hit: true }));
  if (!chips.length) {
    chips.push({ t: '未从题面识别到可解析的表达式，可把题目写成 x(t)=… / H(s)=… / y[n]=… 的形式', hit: false });
  }
  return chips;
}

// 表格数据 → HTML（tex:true 的单元格走 KaTeX）
function genTableHTML(data) {
  if (!data) return '';
  const cell = c => (data.tex ? renderMath(String(c)) : esc(c));
  return `<div class="gen-table">
      <p class="setnote" style="font-weight:600; margin:4px 0 2px">${esc(data.title || '')}</p>
      <table>
        <thead><tr>${data.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${data.rows.map(r => `<tr>${r.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>${data.note ? `<p class="setnote">${esc(data.note)}</p>` : ''}`;
}

function buildGenList(plan) {
  if (!plan.items.length) {
    genListEl.innerHTML = '<p class="gen-empty">这条内容的标签暂不驱动任何图表。可给它加上带 ⚡ 的预设标签（如「卷积」「系统函数」「抽样定理」「DFT」）后再点「⚡ 生成」。</p>';
    return;
  }
  genListEl.innerHTML = plan.items.map((it, i) => {
    const icon = it.type === 'plot' ? '📈' : '▦';
    let ctrl;
    if (it.ready) {
      ctrl = it.type === 'plot'
        ? `<button class="primary gen-go" data-i="${i}">绘制</button>`
        : `<button class="gen-tbl" data-i="${i}">展开</button>`;
    } else {
      ctrl = `<span class="badge-note">缺少 ${esc(it.missing.map(m => GEN_NEED_NAME[m] || m).join('、'))}</span>`;
    }
    return `<div class="gen-item" data-i="${i}">
      <div class="gen-item-head">
        <span class="gi-icon">${icon}</span>
        <span class="gi-label">${esc(it.label)}</span>
        <span class="gi-from">来自标签：<b>${esc(it.from.join(' / '))}</b></span>
        <span class="spacer"></span>${ctrl}
      </div>
      ${it.ready ? '' : `<div class="gen-hint">需要：${esc(it.hint || '')}</div>`}
      <div class="gen-body"></div>
    </div>`;
  }).join('');

  genListEl.querySelectorAll('.gen-go').forEach(b => {
    b.onclick = () => {
      const it = plan.items[+b.dataset.i];
      openPlotFromGen(it.kind, it.fields);
    };
  });
  genListEl.querySelectorAll('.gen-tbl').forEach(b => {
    b.onclick = () => {
      const it = plan.items[+b.dataset.i];
      const box = b.closest('.gen-item').querySelector('.gen-body');
      if (box.dataset.open === '1') { box.innerHTML = ''; box.dataset.open = '0'; b.textContent = '展开'; return; }
      box.innerHTML = genTableHTML(it.data);
      box.dataset.open = '1';
      b.textContent = '收起';
    };
  });
}

function openGenDrawer(it) {
  const subject = it.subject || settings.subject;
  genDrawer.classList.add('open');
  if (!MQG.plan) {
    genSubEl.textContent = '生成模块（gen.js）未加载';
    genParamsEl.innerHTML = '';
    genListEl.innerHTML = '';
    return;
  }
  const plan = MQG.plan(subject, it);
  const title = genTitleText(it);
  genSubEl.innerHTML = `【${esc(SUBJECT[subject] || '')}】${esc(title || '（无标题）')} · 标签 ${plan.tags.length} 个 → 命中 ${plan.items.length} 项生成`;
  genParamsEl.innerHTML = `<div class="gen-chips">${genParamChips(plan.params)
    .map(c => `<span class="gen-chip${c.hit ? ' hit' : ''}">${esc(c.t)}</span>`).join('')}</div>`;
  buildGenList(plan);
}
function closeGenDrawer() { genDrawer.classList.remove('open'); }

// 设定绘图类型（同步顶部图型分段按钮的高亮）
function setPlotKind(kind) {
  plotKind = kind;
  plotKindEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.kind === kind));
}
// 从生成面板跳到绘图面板：自动切换图型、预填字段并立即出图
function openPlotFromGen(kind, fields) {
  closeGenDrawer();
  setPlotKind(kind);
  openPlotDrawer(null);
  if (fields) { applyPlotValues(fields); renderPlot(); }
}

document.getElementById('genClose').onclick = closeGenDrawer;
genDrawer.onclick = e => { if (e.target === genDrawer) closeGenDrawer(); };

/* ===================== AI 识题（可选功能，仅此功能需要联网） =====================
   上传题目图片 → 调用你所选服务商的视觉模型 → 按固定格式返回 → 你核对后导入。
   API Key 仅存本机 localStorage（键 sd_ai）：不写入导出备份，也不进仓库。
   支持三种协议：OpenAI 兼容 / Google Gemini / Anthropic Claude。 */
const AI_PRESETS = [
  { id: 'gemini', name: 'Google Gemini', protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openai', name: 'OpenAI', protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic Claude', protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest',
    keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'ark', name: '火山方舟（豆包）', protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-pro-260215',
    keyUrl: 'https://console.volcengine.com/ark' },
  { id: 'qwen', name: '阿里百炼（通义千问）', protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max',
    keyUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'zhipu', name: '智谱 GLM', protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash',
    keyUrl: 'https://open.bigmodel.cn/' },
  { id: 'kimi', name: 'Kimi（月之暗面）', protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k-vision-preview',
    keyUrl: 'https://platform.moonshot.cn/' },
  { id: 'openrouter', name: 'OpenRouter（聚合多模型）', protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash',
    keyUrl: 'https://openrouter.ai/keys' },
  { id: 'custom', name: '自定义（任意 OpenAI 兼容接口）', protocol: 'openai',
    baseUrl: '', model: '', keyUrl: '' },
];

let aiCfg = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(K_AI));
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
})();
function saveAiCfg() { try { localStorage.setItem(K_AI, JSON.stringify(aiCfg)); } catch (e) {} }

const aiEl = id => document.getElementById(id);
const aiReady = () => !!(aiCfg.baseUrl && aiCfg.model && aiCfg.key);
const aiPreset = id => AI_PRESETS.find(p => p.id === id) || AI_PRESETS[AI_PRESETS.length - 1];
let aiAbort = null;

aiEl('aiPreset').innerHTML = AI_PRESETS
  .map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');

function updateAiHint() {
  const p = aiPreset(aiEl('aiPreset').value);
  aiEl('aiKeyHint').innerHTML = p.keyUrl
    ? `申请 API Key：<a href="${esc(p.keyUrl)}" target="_blank" rel="noreferrer">${esc(p.keyUrl)}</a>`
    : '';
}
function fillAiForm() {
  const id = aiCfg.preset || 'gemini';
  aiEl('aiPreset').value = AI_PRESETS.some(p => p.id === id) ? id : 'gemini';
  aiEl('aiProtocol').value = aiCfg.protocol || 'gemini';
  aiEl('aiBase').value = aiCfg.baseUrl || '';
  aiEl('aiModel').value = aiCfg.model || '';
  aiEl('aiKey').value = aiCfg.key || '';
  updateAiHint();
}
function readAiForm() {
  aiCfg = {
    preset: aiEl('aiPreset').value,
    protocol: aiEl('aiProtocol').value,
    baseUrl: aiEl('aiBase').value.trim().replace(/\/+$/, ''),
    model: aiEl('aiModel').value.trim(),
    key: aiEl('aiKey').value.trim(),
  };
  saveAiCfg();
}
function applyAiPreset() {
  const p = aiPreset(aiEl('aiPreset').value);
  if (p.id !== 'custom') {
    aiEl('aiProtocol').value = p.protocol;
    aiEl('aiBase').value = p.baseUrl;
    aiEl('aiModel').value = p.model;
  }
  readAiForm();
  updateAiHint();
  aiEl('aiMsg').textContent = '';
}
aiEl('aiPreset').onchange = applyAiPreset;
aiEl('aiApplyPreset').onclick = applyAiPreset;
['aiProtocol', 'aiBase', 'aiModel', 'aiKey'].forEach(id => {
  aiEl(id).onchange = () => { readAiForm(); aiEl('aiMsg').textContent = ''; };
});

/* ---------- 图片 → base64 ---------- */
function blobToB64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
// 测试连接用的极小图片（现场生成，避免硬编码二进制）
function aiTinyImage() {
  return new Promise(res => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 16, 16);
    cv.toBlob(b => blobToB64(b).then(res), 'image/jpeg', 0.8);
  });
}

/* ---------- 提示词：分两步（先只转录原文，再解题整理） ---------- */
const aiNoun = () => active === 'q' ? '题目' : '知识点';

// 第一步：只做识别/转录，不解答、不给答案
function aiOcrPrompt() {
  const n = aiNoun();
  return [
    `你是《信号与系统 / 数字信号处理》的${n}识别助手。用户会给你一张图片（拍照或截图）。`,
    `请只把图中的${n}**原文**准确转录出来，不要解答，也不要添加任何解析、答案或说明。`,
    '要求：',
    '1. 只输出原文本身，不要输出【】这类标记，不要标题，不要任何解释；',
    '2. 公式一律使用 LaTeX 且必须带定界符：行内公式用 $...$，独立公式用 $$...$$；',
    '   注意：矩阵、方程组、分段函数、多行推导等会跨行的公式必须用 $$...$$ 包裹，$...$ 不能跨行；',
    '   绝不允许输出没有任何 $ 包裹的裸公式：例如 X(j\\omega) = \\frac{1}{2+j\\omega} 这种写法是错的，必须写成 $$X(j\\omega)=\\frac{1}{2+j\\omega}$$；',
    '   只要出现 \\frac、\\sqrt、\\int、\\sum、^、_ 这类数学写法，它就是一个公式，必须加 $...$ 或 $$...$$；',
    '3. 符号按课程惯例书写：连续时间用 $t$、$x(t)$、$X(j\\omega)$、$\\mathrm{u}(t)$、$\\delta(t)$；',
    '   离散时间用 $n$、$x[n]$、$X(e^{j\\omega})$、$H(z)$、$u[n]$、$\\delta[n]$；',
    `4. 图中若有多道${n}，它们之间用单独一行 === 分隔；`,
    '5. 若图中没有可识别的内容，就只回答：未识别到内容。',
  ].join('\n');
}

/* 「一键生成」完全由标签 + 题面里的定义式在本地驱动：
   标签名与课程标准标签不同名、定义式写成分段或换行，都会导致抽不出图与表。
   这里把这两条硬约束写进提示词，并把当前科目的标准标签注入，
   避免 AI 自造同义词（如「卷积定理」「Z 变换收敛域」）导致命中率低。 */
function aiTagVocab() {
  const groups = PRESET_TAGS[settings.subject] || {};
  return Object.keys(groups).map(g => `· ${g}：${groups[g].join(' / ')}`).join('\n');
}
function aiGenTips() {
  const tips = [
    '',
    '补充要求（本复习本的图 / 表由标签和定义式在本地自动生成，不联网，下面两条必须遵守）：',
    '· 【标签】只能从下面「本课程标准标签」里挑，必须完全同名、用逗号分隔，例如要写「卷积」「傅里叶变换」「Z变换」「系统函数」「抽样定理」，不要写「卷积定理」「Z 变换收敛域」这类自造写法；确实没有合适的就留空。标签决定本应用能自动画出哪些图、列出哪些表。',
  ];
  const vocab = aiTagVocab();
  if (vocab) tips.push('本课程标准标签：', vocab);
  tips.push('· 信号、序列、系统函数的定义式必须各自用单个 $...$ 写成完整的一行，例如 $x(t)=\\mathrm{u}(t)-\\mathrm{u}(t-2)$、$x[n]=0.8^{n}\\mathrm{u}[n]$、$H(z)=\\frac{1}{1-0.9z^{-1}}$、$H(s)=\\frac{1}{s^{2}+3s+2}$；不要用 \\begin{cases} 写分段信号、不要把定义式拆成多行、也不要把等号两边分开写进 $$...$$，否则本应用无法自动识别并画图。');
  return tips;
}

/* 两条主提示词（内置调用 / 复制给免费 AI）共用同一份「输出要求」，
   避免两处各写一份、以后改一处忘一处。 */
function aiOutputRules() {
  const base = [
    '1. 只输出固定格式的内容，不要输出任何解释、寒暄或标题；',
    '2. 不要用 ``` 代码块把整体包裹起来；',
    '3. 公式一律使用 LaTeX 且必须带定界符：行内公式用 $...$，独立公式用 $$...$$；矩阵、方程组、分段函数、多行推导等会跨行的公式必须用 $$...$$ 包裹（$...$ 不能跨行）；矩阵换行用 \\\\，列用 &，例如 $$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$$；',
    '   · 最常犯的错：直接输出没有任何 $ 包裹的裸公式。像 X(j\\omega) = \\frac{1}{2+j\\omega} 这样写是错的，必须写成 $$X(j\\omega)=\\frac{1}{2+j\\omega}$$；',
    '   · 判断标准：只要一段文字里出现 \\frac、\\sqrt、\\int、\\sum、\\lim、^、_、{ 这类数学写法，它就是公式，必须加 $...$ 或 $$...$$，一个都不能漏；',
    '   · 所有公式都要逐个检查一遍：凡是出现在【题目】【解析】【知识点】【讲解】里的公式，都必须被 $ 或 $$ 包住。',
    '4. 不要使用 Markdown 语法：不要 **加粗**、不要 # 标题、不要 - 或 * 列表、不要 | 表格；需要分步就用行首「第 1 步：」这类前缀，每一步单独成行；',
  ];
  const steps = active === 'q' ? [
    '5. 【解析】必须逐步详解，不要一步抛出答案：',
    '   · 每一步都写清三件事：这一步在做什么、依据是什么（用到的定理/性质名称，如卷积定理、时移与频移性质、Z 变换收敛域，公式写成 LaTeX）、这一步得到的结果；',
    '   · 不要跳步：代入与化简、换元时积分上下限的改写（如 $\\tau=t-n$）、部分分式展开、长除法、求和上下限的调整等中间步骤都要写出来，必要时用 $$...$$ 展示推导；',
    '   · 连续系统注明所用的变换与收敛域；离散系统注明 ROC 与稳定性判定（因果系统极点须全在单位圆内）；',
    '   · 每一步单独成行，行首用「第 1 步：」「第 2 步：」这样的前缀；',
    '6. 【知识点】写清「定义 + 物理含义 + 典型用法 + 易错点」，公式用 LaTeX，必要时用 $$...$$ 展示推导；',
    '7. 上面的原文里若含多项（以 === 分隔），输出的每一项与之一一对应；',
    '8. 不要改动原文的题目内容，只在其基础上补充解答与整理；',
    '9. 【我的错误答案】是留给用户自己填的，请保持为空、不要输出该段内容。',
  ] : [
    '5. 【讲解】必须逐步讲透，不要只给结论：',
    '   · 先给定义（写成 LaTeX），再说明物理含义（从信号或系统层面怎么理解）；',
    '   · 再给典型用法与一个示范，示范同样逐步写清在做什么、依据是什么、得到什么，必要时注明 ROC 与稳定性；',
    '   · 最后写易错点；每一步单独成行，行首用「第 1 步：」「第 2 步：」这样的前缀；',
    '6. 上面的原文里若含多项（以 === 分隔），输出的每一项与之一一对应；',
    '7. 不要改动原文的内容，只在其基础上补充讲解与整理。',
  ];
  return base.concat(steps, aiGenTips());
}

// 第二步：基于用户已核对/修正过的原文，解题并整理成导入格式
function aiSolvePrompt(stem) {
  const d = DEF[active];
  return [
    `下面是用户已经核对确认过的《${curSubjectName()}》${aiNoun()}原文，请据此完成整理。`,
    '',
    '原文：',
    stem,
    '',
    '要求：',
  ].concat(aiOutputRules(), ['', '格式示例：', d.importExample]).join('\n');
}

// 「复制给我用的提示词」：让用户拿去任意对话式 AI 里预处理，再把结果粘回本应用
function aiPromptText() {
  const d = DEF[active];
  const what = active === 'q'
    ? `一道《${curSubjectName()}》题目`
    : `一个《${curSubjectName()}》知识点（含讲解）`;
  return [
    `请扮演《信号与系统 / 数字信号处理》课程的助教。下面我会把${what}发给你（可以直接发图片），`,
    '请你把它整理成可直接导入我复习本的固定格式。',
    '',
    '输出要求：',
  ].concat(aiOutputRules(), [
    '',
    '固定格式如下（这就是我需要的输出格式；注意示例里每一处公式都被 $ 或 $$ 包住，请照此输出）：',
    d.importExample,
    '',
    '特别提醒：不要把公式写成没有 $ 的裸写法，例如 X(j\\omega) = \\frac{1}{2+j\\omega} 是错的，正确写法是 $$X(j\\omega)=\\frac{1}{2+j\\omega}$$。',
    '',
    '现在请等我发送内容。',
  ]).join('\n');
}
aiEl('aiPromptBtn').onclick = async () => {
  const ok = await copyText(aiPromptText());
  aiEl('aiMsg').textContent = ok ? '提示词已复制，去任意 AI 粘贴即可' : '复制失败，请手动复制';
};

function aiHttpErr(status, data) {
  let m = '';
  if (data) {
    if (typeof data.error === 'string') m = data.error;
    else if (data.error && data.error.message) m = data.error.message;
    else if (typeof data.message === 'string') m = data.message;
  }
  return `请求失败（HTTP ${status}）${m ? '：' + m : ''}`;
}

/* ---------- 发起请求（system=角色设定；ask=本次指令；可选带图） ---------- */
async function aiCall({ system, ask, b64, mime }) {
  readAiForm();
  if (!aiReady()) throw new Error('AI 配置不完整（需要 Base URL、模型名、API Key）。');
  const cfg = aiCfg;
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const hasImg = !!(b64 && mime);
  const ctrl = new AbortController();
  aiAbort = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    if (cfg.protocol === 'gemini') {
      const url = base + '/v1beta/models/' + encodeURIComponent(cfg.model) +
        ':generateContent?key=' + encodeURIComponent(cfg.key);
      const gParts = [{ text: system }, { text: ask }];
      if (hasImg) gParts.push({ inline_data: { mime_type: mime, data: b64 } });
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: gParts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(aiHttpErr(r.status, data));
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      return parts.map(p => p.text || '').join('').trim();
    }

    if (cfg.protocol === 'anthropic') {
      const aContent = [{ type: 'text', text: ask }];
      if (hasImg) aContent.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
      const r = await fetch(base + '/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: aContent }],
        }),
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(aiHttpErr(r.status, data));
      return (data.content || []).map(c => c.text || '').join('').trim();
    }

    // OpenAI 兼容（多数国内外服务商，包含方舟/百炼/智谱/Kimi/OpenRouter 等）
    const oContent = [{ type: 'text', text: ask }];
    if (hasImg) oContent.push({ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } });
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: oContent },
        ],
      }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(aiHttpErr(r.status, data));
    const msg = ((data.choices || [])[0] || {}).message || {};
    return (Array.isArray(msg.content)
      ? msg.content.map(c => c.text || '').join('')
      : (msg.content || '')).trim();
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    const m = (err && err.message) || '';
    // 浏览器的 fetch 在网络/CORS 失败时只会抛 TypeError（Failed to fetch），对用户没有信息量
    if (err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(m)) {
      throw new Error('无法连接到该接口地址。常见原因：网络不通；该服务商不允许浏览器直接调用（CORS 限制）；Base URL 填写有误。');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    aiAbort = null;
  }
}

/* ---------- 识题主流程 ---------- */
function showAiBusy(text) {
  aiEl('aiBusyText').textContent = text || '正在识别…';
  aiEl('aiBusy').classList.add('open');
}
function hideAiBusy() { aiEl('aiBusy').classList.remove('open'); }
aiEl('aiCancel').onclick = () => { if (aiAbort) aiAbort.abort(); };

/* 第一步：只识别原文，弹出核对框；第二步：用户确认后才解题 */
const aiCheckModal = aiEl('aiCheckModal');
let aiSourceBlob = null, aiSourceUrl = null;

function closeAiCheck() {
  aiCheckModal.classList.remove('open');
  if (aiSourceUrl) { URL.revokeObjectURL(aiSourceUrl); aiSourceUrl = null; }
}
aiEl('aiCheckCancel').onclick = closeAiCheck;
aiEl('aiRePick').onclick = () => { closeAiCheck(); aiEl('aiImgInput').click(); };
aiCheckModal.onclick = e => { if (e.target === aiCheckModal) closeAiCheck(); };

async function aiExtractFromFile(file) {
  if (!aiReady()) {
    settingsDrawer.classList.add('open');
    alert('还没有配置 AI。\n请在「设置 → AI 识题」里选择服务商，填入 API Key 与模型名后再试。');
    return;
  }
  showAiBusy('正在压缩图片…');
  try {
    const blob = await compressImage(file, 1280, 0.8) || file;
    const mime = blob.type || 'image/jpeg';
    const b64 = await blobToB64(blob);
    if (!b64) throw new Error('图片读取失败。');
    aiSourceBlob = blob;

    showAiBusy(`正在识别${aiNoun()}，请稍候…`);
    const text = await aiCall({
      system: aiOcrPrompt(),
      ask: '请把这张图片里的内容按上述要求转录出来，不要解答。',
      b64, mime,
    });
    hideAiBusy();
    if (!text) throw new Error('模型没有返回任何内容。');

    // 弹出核对框，让用户先确认/修正原文
    aiEl('aiCheckTitle').textContent = `第 1 步 · 核对识别出的${aiNoun()}`;
    aiEl('aiCheckHint').innerHTML =
      `下面是 AI 从图片里识别出的${aiNoun()}原文。<b>请核对并直接修正</b>（公式、正负号、上下标最容易出错），` +
      `确认无误后点「${active === 'q' ? '开始解题' : '开始整理'}」，AI 才会继续作答。`;
    aiEl('aiCheckText').value = text;
    aiEl('aiCheckMsg').textContent = '';
    if (aiSourceUrl) URL.revokeObjectURL(aiSourceUrl);
    aiSourceUrl = URL.createObjectURL(blob);
    aiEl('aiCheckImg').src = aiSourceUrl;
    aiEl('aiCheckImgBox').style.display = 'block';
    aiCheckModal.classList.add('open');
    aiEl('aiCheckText').focus();
  } catch (e) {
    hideAiBusy();
    if (e && e.name === 'AbortError') { alert('已取消。'); return; }
    alert('识别失败：' + ((e && e.message) || e) +
      '\n\n常见原因：\n· Base URL / 模型名 / API Key 填写有误\n· 该服务商不允许浏览器直接调用（CORS 限制）\n· 网络不通或请求超时');
  }
}

async function aiSolve() {
  const stem = aiEl('aiCheckText').value.trim();
  if (!stem) { aiEl('aiCheckMsg').textContent = '内容为空，请先填写，或点「重选图片」。'; return; }
  aiEl('aiCheckGo').disabled = true;
  showAiBusy(active === 'q' ? 'AI 正在解题，请稍候…' : 'AI 正在整理，请稍候…');
  try {
    const text = await aiCall({
      system: aiSolvePrompt(stem),
      ask: '请按上述格式输出整理结果。',
    });
    if (!text) throw new Error('模型没有返回任何内容。');

    hideAiBusy();
    closeAiCheck();

    // 打开「新增 / 导入」面板并预填整理结果
    document.getElementById('addBtn').click();
    document.getElementById('addTitle').textContent =
      active === 'q' ? 'AI 解题结果 · 请核对后导入' : 'AI 整理结果 · 请核对后导入';
    document.getElementById('addHint').innerHTML =
      `已基于你核对过的${aiNoun()}原文生成（模型：<b>${esc(aiCfg.model)}</b>）。<b>请核对</b>公式与答案后，再点「导入选中项」。`;
    document.getElementById('rawInput').value = text;
    document.getElementById('parseBtn').click();

    // 只整理出 1 项时，把原题图片自动挂为配图
    if (pending.length === 1 && aiSourceBlob) {
      const id = 'img_' + uid();
      await idbPut({ id, blob: aiSourceBlob, type: aiSourceBlob.type || 'image/jpeg', size: aiSourceBlob.size || 0, addedAt: Date.now() });
      pendingImgs = pendingImgs.concat(id);
      addImgRow.style.display = 'block';
      renderPendingThumbs();
      document.getElementById('addImgMsg').textContent = '已自动附上原题图片';
    } else if (pending.length > 1) {
      document.getElementById('parseMsg').textContent += ' 识别到多项：可先整批导入，再逐条「编辑」补配图。';
    }
  } catch (e) {
    hideAiBusy();
    if (e && e.name === 'AbortError') { aiEl('aiCheckMsg').textContent = '已取消'; return; }
    aiEl('aiCheckMsg').textContent = '失败：' + ((e && e.message) || e);
  } finally {
    aiEl('aiCheckGo').disabled = false;
  }
}
aiEl('aiCheckGo').onclick = aiSolve;

aiEl('aiBtn').onclick = () => {
  if (!aiReady()) {
    settingsDrawer.classList.add('open');
    alert('还没有配置 AI。\n请在「设置 → AI 识题」里选择服务商，填入 API Key 与模型名。');
    return;
  }
  aiEl('aiImgInput').click();
};
aiEl('aiImgInput').onchange = e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) aiExtractFromFile(f);
};

aiEl('aiTest').onclick = async () => {
  const msg = aiEl('aiMsg');
  readAiForm();
  if (!aiReady()) { msg.textContent = '请先填写 Base URL / 模型名 / API Key'; return; }
  msg.textContent = '测试中…';
  showAiBusy('正在测试连接…');
  try {
    const b64 = await aiTinyImage();
    const t = await aiCall({
      system: aiOcrPrompt(),
      ask: '请把这张图片里的内容按上述要求转录出来，不要解答。',
      b64, mime: 'image/jpeg',
    });
    hideAiBusy();
    msg.textContent = t ? '连接成功 ✓' : '连上了，但模型没有返回内容';
  } catch (e) {
    hideAiBusy();
    msg.textContent = (e && e.name === 'AbortError') ? '已取消' : '失败：' + ((e && e.message) || e);
  }
};

/* ---------- 初始化 ---------- */
async function boot() {
  await loadInitial();
  applySettings();
  fillAiForm();
  purgeTrash();
  await gcImages(); // 清理历史遗留的孤儿图片
  updateTrashCount();
  updateBackupBar();
  refreshTagPicker();
  buildPlotFields();
  renderPlot();
  renderRef();
  render();
}
boot();
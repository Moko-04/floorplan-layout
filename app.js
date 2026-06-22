/* =========================================================================
   図面レイアウト — 簡易店内造作CAD
   PDF/画像を背景に、縮尺を合わせて実寸で造作・什器を配置する単一ページアプリ
   ========================================================================= */
"use strict";

const SVGNS = "http://www.w3.org/2000/svg";

/* ---- 什器プリセット（footprint, mm単位）----
   恵比寿造作案_72坪 を参考に、ダーツ＆ポーカーバー向けに整備 */
const FIXTURES = [
  // 席・テーブル
  { g: "席・テーブル", name: "ポーカー台",        w: 2130, h: 1060, shape: "rect" },
  { g: "席・テーブル", name: "ダーツ台 (筐体)",   w: 650,  h: 600,  shape: "rect" },
  { g: "席・テーブル", name: "丸テーブル φ650",   w: 650,  h: 650,  shape: "ellipse" },
  { g: "席・テーブル", name: "角テーブル(4人)",   w: 1200, h: 700,  shape: "rect" },
  { g: "席・テーブル", name: "角テーブル(2人)",   w: 600,  h: 700,  shape: "rect" },
  { g: "席・テーブル", name: "カウンター (1m)",   w: 1000, h: 600,  shape: "rect" },
  { g: "席・テーブル", name: "椅子",              w: 450,  h: 450,  shape: "rect" },
  { g: "席・テーブル", name: "スツール φ350",     w: 350,  h: 350,  shape: "ellipse" },
  { g: "席・テーブル", name: "ソファ(2人)",       w: 1200, h: 700,  shape: "rect" },
  { g: "席・テーブル", name: "ロッカー",          w: 900,  h: 450,  shape: "rect" },
  // 厨房・什器
  { g: "厨房・什器", name: "二層シンク",          w: 1200, h: 600,  shape: "rect" },
  { g: "厨房・什器", name: "一層シンク",          w: 600,  h: 600,  shape: "rect" },
  { g: "厨房・什器", name: "コールドテーブル",     w: 1200, h: 600,  shape: "rect" },
  { g: "厨房・什器", name: "コールドテーブル(大)", w: 1800, h: 600,  shape: "rect" },
  { g: "厨房・什器", name: "ガスコンロ&作業台",   w: 1200, h: 600,  shape: "rect" },
  { g: "厨房・什器", name: "作業台",              w: 1200, h: 600,  shape: "rect" },
  { g: "厨房・什器", name: "冷蔵ショーケース",     w: 1200, h: 600,  shape: "rect" },
  { g: "厨房・什器", name: "製氷機",              w: 600,  h: 600,  shape: "rect" },
  { g: "厨房・什器", name: "冷蔵庫",              w: 600,  h: 650,  shape: "rect" },
  { g: "厨房・什器", name: "レジ台",              w: 600,  h: 450,  shape: "rect" },
  // 設備・その他
  { g: "設備・その他", name: "WC (個室)",         w: 1650, h: 1400, shape: "rect" },
  { g: "設備・その他", name: "ドア (900)",        w: 900,  h: 900,  shape: "door" },
  { g: "設備・その他", name: "引き戸 (1800)",     w: 1800, h: 100,  shape: "rect" },
  { g: "設備・その他", name: "スクリーン",         w: 2000, h: 100,  shape: "rect" },
  { g: "設備・その他", name: "TVモニタ",          w: 1200, h: 100,  shape: "rect" },
  { g: "設備・その他", name: "カスタム寸法…",      custom: true },
];

const COLORS = ["#4f8cff", "#39c07a", "#ffb347", "#ff5d6c", "#b07cff", "#42c8d0", "#8a93a8", "#222a3a"];

/* ---- 状態 ---- */
const state = {
  pdfDoc: null,
  pageNum: 1,
  pageCount: 0,
  renderScale: 2,        // PDF描画解像度
  worldW: 1200,
  worldH: 800,
  mmPerPx: null,         // 縮尺：1ワールドpxあたり何mmか
  zoom: 1,
  panX: 0,
  panY: 0,
  tool: "select",
  shapes: [],
  selectedIds: [],
  gridMm: 100,
  nextId: 1,
};

/* ---- Undo/Redo 履歴 ---- */
const history = { stack: [], index: -1 };
/* ---- コピー&ペースト用クリップボード ---- */
let clipboard = [];
/* ---- localStorage 自動保存キー ---- */
const LS_KEY = "floorplan_autosave_v1";

/* ---- DOM ---- */
const $ = (id) => document.getElementById(id);
const viewport = $("viewport");
const scene = $("scene");
const canvas = $("pdfCanvas");
const ctx = canvas.getContext("2d");
const overlay = $("overlay");
const hint = $("hint");

/* ---- 一時状態 ---- */
let drag = null;          // {mode, ...}
let measure = null;       // 縮尺合わせ/計測 {p1, cur, forScale}
let spaceDown = false;
const activePointers = new Map(); // pointerId -> {x,y}（マルチタッチ判定用）
let pinch = null;         // ピンチ拡大/2本指パンの基準
const COARSE = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); // タッチ主体端末か

/* ======================================================================
   ユーティリティ
   ====================================================================== */
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function screenToWorld(cx, cy) {
  const r = viewport.getBoundingClientRect();
  return { x: (cx - r.left - state.panX) / state.zoom, y: (cy - r.top - state.panY) / state.zoom };
}
function snapVal(v) {
  if (state.gridMm > 0 && state.mmPerPx) {
    const g = state.gridMm / state.mmPerPx;
    return Math.round(v / g) * g;
  }
  return v;
}
function snapPt(p) { return { x: snapVal(p.x), y: snapVal(p.y) }; }
function mm(px) { return state.mmPerPx ? px * state.mmPerPx : null; }
function fmtMM(v) {
  if (v == null) return "—";
  return Math.round(v).toLocaleString("ja-JP") + "mm";
}
function getSelected() { return state.shapes.filter((s) => state.selectedIds.includes(s.id)); }
function getSel() { return state.selectedIds.length === 1 ? (state.shapes.find((s) => s.id === state.selectedIds[0]) || null) : null; }
function isSelected(id) { return state.selectedIds.includes(id); }
function selectOnly(id) { state.selectedIds = id == null ? [] : [id]; }
function toggleSel(id) { const i = state.selectedIds.indexOf(id); if (i >= 0) state.selectedIds.splice(i, 1); else state.selectedIds.push(id); }
function clearSelection() { state.selectedIds = []; }
function selectAll() { state.selectedIds = state.shapes.map((s) => s.id); render(); }
function snapshotGeoms() { const m = {}; for (const s of getSelected()) m[s.id] = cloneGeom(s); return m; }
function bbox(s) {
  if (s.type === "line") {
    return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2),
             w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
  }
  if (s.type === "text") return { x: s.x, y: s.y - 14, w: 8, h: 18 };
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}
function center(s) { const b = bbox(s); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }

function toast(msg, warn) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (warn ? " warn" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), 2200);
}

/* ======================================================================
   ビュー変換
   ====================================================================== */
function applyTransform() {
  scene.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  $("zoomLabel").textContent = Math.round(state.zoom * 100) + "%";
}
function setSceneSize(w, h) {
  state.worldW = w; state.worldH = h;
  canvas.width = w; canvas.height = h;
  overlay.setAttribute("width", w);
  overlay.setAttribute("height", h);
  overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
}
function zoomFit() {
  const r = viewport.getBoundingClientRect();
  const pad = 40;
  const z = Math.min((r.width - pad) / state.worldW, (r.height - pad) / state.worldH);
  state.zoom = z > 0 ? z : 1;
  state.panX = (r.width - state.worldW * state.zoom) / 2;
  state.panY = (r.height - state.worldH * state.zoom) / 2;
  applyTransform();
}
function zoomAt(factor, cx, cy) {
  const before = screenToWorld(cx, cy);
  state.zoom = Math.min(8, Math.max(0.05, state.zoom * factor));
  const r = viewport.getBoundingClientRect();
  state.panX = cx - r.left - before.x * state.zoom;
  state.panY = cy - r.top - before.y * state.zoom;
  applyTransform();
}

/* ======================================================================
   PDF / 画像 読み込み
   ====================================================================== */
async function openFile(file) {
  if (!file) return;
  const name = (file.name || "").toLowerCase();
  try {
    if (file.type === "application/pdf" || name.endsWith(".pdf")) {
      if (!window.pdfjsLib) {
        toast("PDFライブラリが読み込めません。「起動.bat」から開いてください", true);
        return;
      }
      toast("PDFを読み込み中…");
      const buf = await file.arrayBuffer();
      const task = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
      state.pdfDoc = await task.promise;
      state.pageCount = state.pdfDoc.numPages;
      state.pageNum = 1;
      await renderPdfPage(1);
    } else if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/.test(name)) {
      await renderImage(file);
    } else {
      toast("PDFまたは画像ファイルを選んでください", true);
      return;
    }
    hint.style.display = "none";
    state.mmPerPx = null; // ページが変わったら縮尺は要再設定
    updateStatus();
    zoomFit();
    toast("読み込み完了。次に「縮尺合わせ」をしてください");
  } catch (err) {
    console.error("PDF/画像の読み込みに失敗:", err);
    toast("読み込みに失敗：" + (err && err.message ? err.message : err) + "（起動.batから開くと確実です）", true);
  }
}

async function renderPdfPage(num) {
  const page = await state.pdfDoc.getPage(num);
  const vp = page.getViewport({ scale: state.renderScale });
  setSceneSize(Math.round(vp.width), Math.round(vp.height));
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  state.pageNum = num;
  $("pageInfo").textContent = `${num} / ${state.pageCount}`;
  render();
}

function renderImage(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      setSceneSize(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, 0, 0);
      state.pdfDoc = null; state.pageCount = 1; state.pageNum = 1;
      $("pageInfo").textContent = "画像";
      render(); res();
    };
    img.src = URL.createObjectURL(file);
  });
}

/* 白紙キャンバス（PDFなしで作図したい場合） */
function blankCanvas() {
  setSceneSize(2400, 1700);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, state.worldW, state.worldH);
  $("pageInfo").textContent = "白紙";
  hint.style.display = "none";
}

/* ======================================================================
   描画（オーバーレイSVG再構築）
   ====================================================================== */
function render() {
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  const z = state.zoom;
  const sw = 1.6 / z, fs = 13 / z;

  /* グリッド */
  if (state.gridMm > 0 && state.mmPerPx) {
    const g = state.gridMm / state.mmPerPx;
    if (g * z > 4) { // 細かすぎる時は描かない
      const defs = svgEl("defs", {});
      const pat = svgEl("pattern", { id: "grid", width: g, height: g, patternUnits: "userSpaceOnUse" });
      pat.appendChild(svgEl("path", { d: `M ${g} 0 L 0 0 0 ${g}`, fill: "none", stroke: "rgba(80,140,255,.28)", "stroke-width": 0.7 / z }));
      defs.appendChild(pat);
      overlay.appendChild(defs);
      overlay.appendChild(svgEl("rect", { x: 0, y: 0, width: state.worldW, height: state.worldH, fill: "url(#grid)" }));
    }
  }

  for (const s of state.shapes) renderShape(s, sw, fs);

  /* 作図プレビュー */
  if (drag && drag.mode === "draw") renderPreview(sw, fs);

  /* 縮尺合わせ / 計測 */
  if (measure) renderMeasure(sw, fs);

  /* 範囲選択（マーキー） */
  if (drag && drag.mode === "marquee") renderMarquee();

  /* 選択ハンドル */
  const sellist = getSelected();
  if (sellist.length === 1) {
    renderSelection(sellist[0], z);
  } else if (sellist.length > 1) {
    for (const s of sellist) renderSelectionOutline(s, z);
    hideSelInfo();
  } else {
    hideSelInfo();
  }
}

function shapeColor(s) { return s.color || "#4f8cff"; }

function renderShape(s, sw, fs) {
  const c = shapeColor(s);
  const g = svgEl("g", {});
  const ctr = center(s);
  if (s.rot) g.setAttribute("transform", `rotate(${s.rot} ${ctr.x} ${ctr.y})`);

  if (s.type === "line") {
    g.appendChild(svgEl("line", { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
      stroke: c, "stroke-width": (s.weight || 4) / state.zoom, "stroke-linecap": "round",
      "data-id": s.id, style: "cursor:move" }));
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    addLabel(g, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, fmtMM(mm(len)), fs, c);
  } else if (s.type === "ellipse") {
    g.appendChild(svgEl("ellipse", { cx: s.x + s.w / 2, cy: s.y + s.h / 2, rx: s.w / 2, ry: s.h / 2,
      fill: c + "33", stroke: c, "stroke-width": sw, "data-id": s.id, style: "cursor:move" }));
    addFixtureLabel(g, s, fs);
  } else if (s.type === "door") {
    renderDoor(g, s, sw, c);
  } else if (s.type === "text") {
    const t = svgEl("text", { x: s.x, y: s.y, fill: c, "font-size": (s.size || 18) / state.zoom,
      "font-family": "sans-serif", "font-weight": 600, "data-id": s.id, style: "cursor:move" });
    t.textContent = s.text;
    g.appendChild(t);
  } else { // rect / fixture
    g.appendChild(svgEl("rect", { x: s.x, y: s.y, width: s.w, height: s.h, rx: 2 / state.zoom,
      fill: c + (s.type === "fixture" ? "33" : "22"), stroke: c, "stroke-width": sw,
      "data-id": s.id, style: "cursor:move" }));
    if (s.type === "fixture") addFixtureLabel(g, s, fs);
    else addRectDims(g, s, fs, c);
  }
  overlay.appendChild(g);
}

function renderDoor(g, s, sw, c) {
  const x = s.x, y = s.y, w = s.w; // 蝶番=(x,y)、開き幅=w
  g.appendChild(svgEl("path", { d: `M ${x + w} ${y} A ${w} ${w} 0 0 1 ${x} ${y + w}`,
    fill: "none", stroke: c, "stroke-width": sw, "stroke-dasharray": `${4 / state.zoom} ${4 / state.zoom}` }));
  g.appendChild(svgEl("line", { x1: x, y1: y, x2: x, y2: y + w, stroke: c, "stroke-width": sw * 2 }));
  // 当たり判定用の透明矩形
  g.appendChild(svgEl("rect", { x: x, y: y, width: w, height: w, fill: "transparent",
    "data-id": s.id, style: "cursor:move" }));
}

function addLabel(g, x, y, text, fs, c) {
  // ラベルはタッチ/クリックを横取りしない（下の図形を掴めるように）
  const bg = svgEl("rect", { x: x - 1, y: y - fs, rx: 3 / state.zoom, fill: "rgba(17,20,28,.78)", "pointer-events": "none" });
  const t = svgEl("text", { x: x, y: y - fs * 0.25, fill: "#fff", "font-size": fs,
    "font-family": "sans-serif", "text-anchor": "middle", "pointer-events": "none" });
  t.textContent = text;
  g.appendChild(bg); g.appendChild(t);
  // bg をテキスト幅に合わせる
  requestAnimationFrame(() => {
    try { const bb = t.getBBox(); bg.setAttribute("x", bb.x - 3 / state.zoom);
      bg.setAttribute("y", bb.y - 1 / state.zoom); bg.setAttribute("width", bb.width + 6 / state.zoom);
      bg.setAttribute("height", bb.height + 2 / state.zoom); } catch (e) {}
  });
}
function addRectDims(g, s, fs, c) {
  addLabel(g, s.x + s.w / 2, s.y + s.h / 2 + fs / 2, `${fmtMM(mm(s.w))} × ${fmtMM(mm(s.h))}`, fs, c);
}
function addFixtureLabel(g, s, fs) {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const t = svgEl("text", { x: cx, y: cy, fill: "#fff", "font-size": fs, "font-family": "sans-serif",
    "text-anchor": "middle", "dominant-baseline": "central", "pointer-events": "none" });
  t.textContent = s.name || "";
  g.appendChild(t);
}

function renderPreview(sw, fs) {
  const a = drag.start, b = drag.cur;
  if (state.tool === "rect") {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    overlay.appendChild(svgEl("rect", { x, y, width: w, height: h, fill: "rgba(79,140,255,.18)",
      stroke: "#4f8cff", "stroke-width": sw, "stroke-dasharray": `${5 / state.zoom} ${4 / state.zoom}` }));
    const g = svgEl("g", {}); addLabel(g, x + w / 2, y + h / 2 + fs / 2, `${fmtMM(mm(w))} × ${fmtMM(mm(h))}`, fs, "#4f8cff");
    overlay.appendChild(g);
  } else if (state.tool === "line") {
    overlay.appendChild(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#4f8cff",
      "stroke-width": 4 / state.zoom, "stroke-linecap": "round", "stroke-dasharray": `${5 / state.zoom} ${4 / state.zoom}` }));
    const g = svgEl("g", {}); addLabel(g, (a.x + b.x) / 2, (a.y + b.y) / 2, fmtMM(mm(Math.hypot(b.x - a.x, b.y - a.y))), fs, "#4f8cff");
    overlay.appendChild(g);
  }
}

function renderMeasure(sw, fs) {
  if (!measure.p1) return;
  const a = measure.p1, b = measure.cur || measure.p1;
  const col = measure.forScale ? "#ffb347" : "#39c07a";
  overlay.appendChild(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: col,
    "stroke-width": 2 / state.zoom, "stroke-dasharray": `${6 / state.zoom} ${4 / state.zoom}` }));
  for (const p of [a, b]) overlay.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: 4 / state.zoom, fill: col }));
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  const txt = measure.forScale
    ? (state.mmPerPx ? fmtMM(mm(px)) : `${Math.round(px)} px`)
    : fmtMM(mm(px));
  const g = svgEl("g", {}); addLabel(g, (a.x + b.x) / 2, (a.y + b.y) / 2, txt, fs, col); overlay.appendChild(g);
}

/* 選択枠 + ハンドル */
function renderSelection(s, z) {
  const b = bbox(s), ctr = center(s);
  const g = svgEl("g", {});
  if (s.rot) g.setAttribute("transform", `rotate(${s.rot} ${ctr.x} ${ctr.y})`);
  g.appendChild(svgEl("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "none",
    stroke: "#fff", "stroke-width": 1.2 / z, "stroke-dasharray": `${4 / z} ${3 / z}`, "pointer-events": "none" }));

  const hs = (COARSE ? 11 : 5) / z;   // タッチ端末ではハンドルを大きくして掴みやすく
  const resizable = (s.type === "rect" || s.type === "fixture" || s.type === "ellipse") && !s.rot;
  if (resizable) {
    const corners = [["nw", b.x, b.y], ["ne", b.x + b.w, b.y], ["sw", b.x, b.y + b.h], ["se", b.x + b.w, b.y + b.h]];
    for (const [name, hx, hy] of corners) {
      g.appendChild(svgEl("rect", { x: hx - hs, y: hy - hs, width: hs * 2, height: hs * 2,
        fill: "#fff", stroke: "#4f8cff", "stroke-width": 1 / z, "data-handle": name, style: "cursor:nwse-resize" }));
    }
  }
  // 回転ハンドル
  if (s.type === "rect" || s.type === "fixture" || s.type === "ellipse" || s.type === "door") {
    const hx = ctr.x, hy = b.y - 22 / z;
    g.appendChild(svgEl("line", { x1: ctr.x, y1: b.y, x2: hx, y2: hy, stroke: "#fff", "stroke-width": 1 / z, "pointer-events": "none" }));
    g.appendChild(svgEl("circle", { cx: hx, cy: hy, r: hs * 1.2, fill: "#39c07a", stroke: "#fff",
      "stroke-width": 1 / z, "data-handle": "rot", style: "cursor:grab" }));
  }
  overlay.appendChild(g);
  showSelInfo(s);
}

/* 複数選択時の枠だけ（ハンドルなし） */
function renderSelectionOutline(s, z) {
  const b = bbox(s), ctr = center(s);
  const g = svgEl("g", {});
  if (s.rot) g.setAttribute("transform", `rotate(${s.rot} ${ctr.x} ${ctr.y})`);
  g.appendChild(svgEl("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "rgba(79,140,255,.10)",
    stroke: "#4f8cff", "stroke-width": 1.2 / z, "stroke-dasharray": `${4 / z} ${3 / z}`, "pointer-events": "none" }));
  overlay.appendChild(g);
}

/* 範囲選択のラバーバンド */
function renderMarquee() {
  const a = drag.start, b = drag.cur;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  overlay.appendChild(svgEl("rect", { x, y, width: w, height: h, fill: "rgba(79,140,255,.12)",
    stroke: "#4f8cff", "stroke-width": 1 / state.zoom, "stroke-dasharray": `${4 / state.zoom} ${3 / state.zoom}`, "pointer-events": "none" }));
}

/* ======================================================================
   選択パネル
   ====================================================================== */
function showSelInfo(s) {
  const panel = $("selInfo");
  panel.style.display = "block";
  const body = $("selBody");
  let html = "";
  if (s.type === "line") {
    html += `<div class="row"><label>長さ</label><span>${fmtMM(mm(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)))}</span></div>`;
  } else if (s.type === "text") {
    html += `<div class="row"><label>文字</label><input id="iTxt" value="${(s.text || "").replace(/"/g, "&quot;")}"></div>`;
  } else {
    html += `<div class="row"><label>名称</label><input id="iName" value="${(s.name || "").replace(/"/g, "&quot;")}" placeholder="(任意)"></div>`;
    html += `<div class="row"><label>幅</label><input id="iW" type="number" inputmode="decimal" step="10" value="${Math.round(mm(s.w) || 0)}"> <span style="color:var(--muted)">mm</span></div>`;
    if (s.type !== "door")
      html += `<div class="row"><label>奥行</label><input id="iH" type="number" inputmode="decimal" step="10" value="${Math.round(mm(s.h) || 0)}"> <span style="color:var(--muted)">mm</span></div>`;
    html += `<div class="row"><label>角度</label><span>${Math.round(s.rot || 0)}°</span></div>`;
  }
  body.innerHTML = html;

  const cr = $("colorRow"); cr.innerHTML = "";
  for (const col of COLORS) {
    const sw = document.createElement("div");
    sw.className = "sw" + (shapeColor(s) === col ? " sel" : "");
    sw.style.background = col;
    sw.onclick = () => { s.color = col; render(); pushHistory(); };
    cr.appendChild(sw);
  }

  // 入力 → 反映
  const bindNum = (id, apply) => { const e = $(id); if (e) e.onchange = () => { const v = parseFloat(e.value); if (!isNaN(v) && state.mmPerPx) { apply(v / state.mmPerPx); render(); pushHistory(); } }; };
  bindNum("iW", (px) => { s.w = px; });
  bindNum("iH", (px) => { s.h = px; });
  const nm = $("iName"); if (nm) nm.onchange = () => { s.name = nm.value; render(); pushHistory(); };
  const tx = $("iTxt"); if (tx) tx.onchange = () => { s.text = tx.value; render(); pushHistory(); };
}
function hideSelInfo() { $("selInfo").style.display = "none"; }

/* ======================================================================
   作図・編集の操作
   ====================================================================== */
function addShape(s) {
  s.id = state.nextId++;
  if (!s.color) s.color = "#4f8cff";
  state.shapes.push(s);
  selectOnly(s.id);
  render(); updateStatus();
  pushHistory();
  return s;
}

function placeFixture(def, pt) {
  if (!state.mmPerPx) { toast("先に「縮尺合わせ」をしてください", true); return; }
  const w = def.w / state.mmPerPx, h = def.h / state.mmPerPx;
  const p = snapPt({ x: pt.x - w / 2, y: pt.y - h / 2 });
  addShape({ type: def.shape === "ellipse" ? "ellipse" : (def.shape === "door" ? "door" : "fixture"),
    x: p.x, y: p.y, w, h, rot: 0, name: def.shape === "door" ? "" : def.name,
    color: def.shape === "door" ? "#8a93a8" : "#39c07a" });
}

function commitDraw() {
  const a = drag.start, b = drag.cur;
  if (state.tool === "rect") {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w > 3 && h > 3) addShape({ type: "rect", x, y, w, h, rot: 0, color: "#4f8cff" });
  } else if (state.tool === "line") {
    if (Math.hypot(b.x - a.x, b.y - a.y) > 3) addShape({ type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, weight: 4, color: "#ff5d6c" });
  }
}

function cloneGeom(s) {
  if (s.type === "line") return { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 };
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}
function applyResize(s, orig, handle, pt) {
  const p = snapPt(pt);
  let x = orig.x, y = orig.y, x2 = orig.x + orig.w, y2 = orig.y + orig.h;
  if (handle.includes("w")) x = p.x;
  if (handle.includes("e")) x2 = p.x;
  if (handle.includes("n")) y = p.y;
  if (handle.includes("s")) y2 = p.y;
  s.x = Math.min(x, x2); s.y = Math.min(y, y2);
  s.w = Math.max(2, Math.abs(x2 - x)); s.h = Math.max(2, Math.abs(y2 - y));
}

/* 複数選択をまとめて移動（先頭オブジェクトを基準にグリッドスナップ） */
function moveSelected(origs, dx, dy) {
  const sel = getSelected();
  if (!sel.length) return;
  const anchor = sel[0], o0 = origs[anchor.id];
  let sdx = dx, sdy = dy;
  if (o0) {
    if (anchor.type === "line") { const p = snapPt({ x: o0.x1 + dx, y: o0.y1 + dy }); sdx = p.x - o0.x1; sdy = p.y - o0.y1; }
    else { const p = snapPt({ x: o0.x + dx, y: o0.y + dy }); sdx = p.x - o0.x; sdy = p.y - o0.y; }
  }
  for (const s of sel) {
    const o = origs[s.id]; if (!o) continue;
    if (s.type === "line") { s.x1 = o.x1 + sdx; s.y1 = o.y1 + sdy; s.x2 = o.x2 + sdx; s.y2 = o.y2 + sdy; }
    else { s.x = o.x + sdx; s.y = o.y + sdy; }
  }
}

function offsetShape(s, dx, dy) {
  if (s.type === "line") { s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy; }
  else { s.x += dx; s.y += dy; }
}

/* 選択をクリップボードへ */
function copySelection() {
  const sel = getSelected();
  if (!sel.length) return;
  clipboard = sel.map((s) => JSON.parse(JSON.stringify(s)));
  toast(`${clipboard.length}個をコピーしました`);
}

/* クリップボードを少しずらして貼り付け（新しい選択にする） */
function pasteClipboard() {
  if (!clipboard.length) return;
  const off = (state.gridMm > 0 && state.mmPerPx) ? state.gridMm / state.mmPerPx : 12;
  const newIds = [];
  for (const c of clipboard) {
    const s = JSON.parse(JSON.stringify(c));
    s.id = state.nextId++;
    offsetShape(s, off, off);
    state.shapes.push(s); newIds.push(s.id);
  }
  state.selectedIds = newIds;
  render(); updateStatus(); pushHistory();
  toast(`${newIds.length}個を貼り付けました`);
}

/* 選択を即複製（Ctrl+D） */
function duplicateSelection() {
  const sel = getSelected();
  if (!sel.length) return;
  const off = (state.gridMm > 0 && state.mmPerPx) ? state.gridMm / state.mmPerPx : 12;
  const newIds = [];
  for (const src of sel) {
    const s = JSON.parse(JSON.stringify(src));
    s.id = state.nextId++;
    offsetShape(s, off, off);
    state.shapes.push(s); newIds.push(s.id);
  }
  state.selectedIds = newIds;
  render(); updateStatus(); pushHistory();
}

/* ======================================================================
   Undo / Redo 履歴 ＋ localStorage 自動保存
   ====================================================================== */
function snapshot() {
  return JSON.stringify({ shapes: state.shapes, selectedIds: state.selectedIds });
}
function pushHistory() {
  // やり直し分を切り捨ててから追加
  if (history.index < history.stack.length - 1) history.stack = history.stack.slice(0, history.index + 1);
  history.stack.push(snapshot());
  if (history.stack.length > 120) history.stack.shift();
  history.index = history.stack.length - 1;
  scheduleAutosave();
  updateUndoButtons();
}
let _histTimer = null;
function scheduleHistory() { clearTimeout(_histTimer); _histTimer = setTimeout(pushHistory, 450); }
function restoreSnapshot(snap) {
  const d = JSON.parse(snap);
  state.shapes = d.shapes || [];
  state.selectedIds = (d.selectedIds || []).filter((id) => state.shapes.some((s) => s.id === id));
  state.nextId = state.shapes.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
  if (!getSel()) hideSelInfo();
  render(); updateStatus(); updateUndoButtons(); scheduleAutosave();
}
function undo() {
  if (history.index <= 0) { toast("これ以上戻せません", true); return; }
  history.index--;
  restoreSnapshot(history.stack[history.index]);
}
function redo() {
  if (history.index >= history.stack.length - 1) { toast("これ以上やり直せません", true); return; }
  history.index++;
  restoreSnapshot(history.stack[history.index]);
}
function updateUndoButtons() {
  const u = $("undoBtn"), r = $("redoBtn");
  if (u) u.disabled = history.index <= 0;
  if (r) r.disabled = history.index >= history.stack.length - 1;
}

let _saveTimer = null;
function scheduleAutosave() { clearTimeout(_saveTimer); _saveTimer = setTimeout(autosave, 400); }
function autosave() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      version: 1, mmPerPx: state.mmPerPx, gridMm: state.gridMm,
      worldW: state.worldW, worldH: state.worldH, shapes: state.shapes,
    }));
  } catch (e) { /* 容量超過などは無視 */ }
}
function restoreAutosave() {
  try {
    const txt = localStorage.getItem(LS_KEY);
    if (!txt) return false;
    const d = JSON.parse(txt);
    if (!d.shapes || !d.shapes.length) return false;
    state.shapes = d.shapes;
    state.mmPerPx = d.mmPerPx || null;
    state.gridMm = d.gridMm ?? state.gridMm;
    $("gridSel").value = String(state.gridMm);
    setSceneSize(d.worldW || 2400, d.worldH || 1700);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, state.worldW, state.worldH);
    state.nextId = state.shapes.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
    $("pageInfo").textContent = "白紙";
    hint.style.display = "none";
    return true;
  } catch (e) { return false; }
}

/* ======================================================================
   縮尺合わせ
   ====================================================================== */
function startMeasure(forScale) {
  setTool("select");
  measure = { p1: null, cur: null, forScale };
  viewport.classList.remove("select");
  viewport.style.cursor = "crosshair";
  $(forScale ? "calibrate" : "measure").classList.add("active");
  toast(forScale ? "図面上の既知の長さをドラッグで線引き" : "計測：2点間をドラッグ");
}

/* ドラッグで引いた線を確定 → 縮尺なら寸法入力ダイアログ、計測なら結果表示 */
function finishMeasure() {
  if (!measure || !measure.p1 || !measure.cur) { measure = null; return; }
  const px = Math.hypot(measure.cur.x - measure.p1.x, measure.cur.y - measure.p1.y);
  if (px < 3) { measure = null; render(); toast("線が短すぎます。もう一度ドラッグしてください", true); return; }
  if (measure.forScale) {
    measure.px = px;      // 線は表示したままダイアログを出す
    render();
    showDimDialog(px);
  } else {
    toast(`計測：${fmtMM(mm(px))}`);
    measure = null; render(); setTool("select");
  }
}

/* 寸法入力ダイアログ */
function showDimDialog(px) {
  $("dimSub").textContent = `図面上の長さ：約 ${Math.round(px)} px`;
  $("dimDialog").classList.add("show");
  const inp = $("dimValue");
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}
function closeDimDialog() { $("dimDialog").classList.remove("show"); }
function isDimOpen() { return $("dimDialog").classList.contains("show"); }
function confirmDim() {
  const v = parseFloat($("dimValue").value);
  if (isNaN(v) || v <= 0) { toast("正しい寸法(mm)を入力してください", true); return; }
  if (!measure || !measure.px) { closeDimDialog(); return; }
  state.mmPerPx = v / measure.px;
  closeDimDialog();
  measure = null;
  updateStatus(); render(); scheduleAutosave(); setTool("select");
  toast(`縮尺を設定しました（1m ≒ ${Math.round(1000 / state.mmPerPx)}px）`);
}
function cancelDim() {
  closeDimDialog();
  measure = null;
  render(); setTool("select");
}

/* ======================================================================
   ポインタ操作
   ====================================================================== */
function onDown(e) {
  if (e.button === 2) return;
  if (isDimOpen()) return;   // 寸法入力ダイアログ表示中はキャンバス操作を無効化
  // 右上の選択パネル（入力欄・ボタン）上の操作はキャンバス処理の対象外にする
  if (e.target.closest && e.target.closest("#selInfo")) return;
  // 新しい1本目のタッチが来たら、取りこぼした古いポインタを掃除（誤ピンチ防止）
  if (e.pointerType === "touch" && e.isPrimary) { activePointers.clear(); pinch = null; }
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  // 指が2本になったらピンチ（拡大縮小＋2本指パン）に切替。進行中の操作は中断
  if (activePointers.size >= 2) {
    drag = null; pinch = null;
    viewport.classList.remove("panning");
    pinchUpdate();
    return;
  }
  const panMode = e.button === 1 || spaceDown || state.tool === "pan";
  const raw = screenToWorld(e.clientX, e.clientY);

  if (panMode) {
    drag = { mode: "pan", sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY };
    viewport.classList.add("panning");
    e.preventDefault(); return;
  }

  // 縮尺合わせ / 計測：ドラッグで線を引く
  if (measure) {
    measure.p1 = raw; measure.cur = raw;
    drag = { mode: "measureDraw" };
    render();
    e.preventDefault();
    return;
  }

  const handle = e.target.getAttribute && e.target.getAttribute("data-handle");
  const sel = getSel();
  if (handle && sel) {
    if (handle === "rot") {
      drag = { mode: "rotate", ctr: center(sel), origRot: sel.rot || 0 };
    } else {
      drag = { mode: "resize", handle, orig: cloneGeom(sel) };
    }
    return;
  }

  if (state.tool === "select") {
    const idAttr = e.target.getAttribute && e.target.getAttribute("data-id");
    if (idAttr) {
      const id = parseInt(idAttr, 10);
      if (e.shiftKey) {
        toggleSel(id);
        render();
        if (isSelected(id)) drag = { mode: "move", start: raw, origs: snapshotGeoms() };
      } else {
        if (!isSelected(id)) selectOnly(id);
        drag = { mode: "move", start: raw, origs: snapshotGeoms() };
        render();
      }
    } else if (COARSE && !e.shiftKey) {
      // タッチ端末：何もない所の1本指ドラッグは画面移動（パン）。選択は維持。
      // 動かさずに離した場合（タップ）は選択解除する
      drag = { mode: "pan", sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY, selectTap: true };
      viewport.classList.add("panning");
    } else {
      // マウス等：空白ドラッグは範囲選択（マーキー）
      drag = { mode: "marquee", start: raw, cur: raw, add: e.shiftKey };
      if (!e.shiftKey) { clearSelection(); hideSelInfo(); }
      render();
    }
    return;
  }

  if (state.tool === "rect" || state.tool === "line") {
    const p = snapPt(raw);
    drag = { mode: "draw", start: p, cur: p };
    return;
  }

  if (state.tool === "text") {
    const t = prompt("テキストを入力");
    if (t) addShape({ type: "text", x: raw.x, y: raw.y, text: t, size: 18, color: "#ffb347" });
    setTool("select");
    return;
  }

  if (state.tool === "fixture" && state._pendingFixture) {
    placeFixture(state._pendingFixture, raw);
    return; // ツール維持（連続配置）
  }
}

function onMove(e) {
  if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) { pinchUpdate(); return; }
  const raw = screenToWorld(e.clientX, e.clientY);
  // ステータスのカーソル座標
  if (state.mmPerPx) $("cursorStat").textContent = `X ${fmtMM(mm(raw.x))} , Y ${fmtMM(mm(raw.y))}`;
  else $("cursorStat").textContent = `${Math.round(raw.x)} , ${Math.round(raw.y)} px`;

  if (!drag) return;

  if (drag.mode === "measureDraw") { measure.cur = raw; render(); return; }
  if (drag.mode === "pan") {
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    state.panX = drag.px + dx;
    state.panY = drag.py + dy;
    applyTransform(); return;
  }
  if (drag.mode === "draw") { drag.cur = snapPt(raw); render(); return; }
  if (drag.mode === "marquee") { drag.cur = raw; render(); return; }
  if (drag.mode === "move") {
    moveSelected(drag.origs, raw.x - drag.start.x, raw.y - drag.start.y);
    drag.moved = true; render(); return;
  }
  if (drag.mode === "resize") {
    const s = getSel(); if (!s) return;
    applyResize(s, drag.orig, drag.handle, raw); drag.moved = true; render(); return;
  }
  if (drag.mode === "rotate") {
    const s = getSel(); if (!s) return;
    let ang = Math.atan2(raw.y - drag.ctr.y, raw.x - drag.ctr.x) * 180 / Math.PI + 90;
    if (e.shiftKey) ang = Math.round(ang / 15) * 15; else ang = Math.round(ang);
    s.rot = ((ang % 360) + 360) % 360;
    drag.moved = true; render(); return;
  }
}

function onUp(e) {
  if (e && activePointers.has(e.pointerId)) activePointers.delete(e.pointerId);
  // まだ指が残っている（ピンチ→1本指へ移行中など）なら通常処理はせず基準を取り直す
  if (activePointers.size >= 1) {
    pinch = null; drag = null;
    viewport.classList.remove("panning");
    return;
  }
  pinch = null;
  if (drag && drag.mode === "measureDraw") {
    drag = null; viewport.classList.remove("panning");
    finishMeasure(); updateStatus(); return;
  }
  if (drag) {
    if (drag.mode === "draw") { commitDraw(); setTool("select"); }
    else if (drag.mode === "marquee") { finishMarquee(); }
    else if (drag.mode === "pan" && drag.selectTap && !drag.moved) { clearSelection(); hideSelInfo(); render(); }
    else if (drag.moved && (drag.mode === "move" || drag.mode === "resize" || drag.mode === "rotate")) { pushHistory(); }
  }
  viewport.classList.remove("panning");
  drag = null;
  updateStatus();
}

/* 2本指ピンチ：拡大縮小＋同時パン。最初の呼び出しで基準を記録する */
function pinchUpdate() {
  const pts = [...activePointers.values()];
  if (pts.length < 2) return;
  const a = pts[0], b = pts[1];
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
  if (!pinch) { pinch = { dist: dist || 1, midX, midY, zoom: state.zoom, panX: state.panX, panY: state.panY }; return; }
  const r = viewport.getBoundingClientRect();
  const factor = dist / pinch.dist;
  const newZoom = Math.min(8, Math.max(0.05, pinch.zoom * factor));
  // ピンチ開始時の中点の下にあるワールド座標を、現在の中点に保ち続ける
  const wx = (pinch.midX - r.left - pinch.panX) / pinch.zoom;
  const wy = (pinch.midY - r.top - pinch.panY) / pinch.zoom;
  state.zoom = newZoom;
  state.panX = midX - r.left - wx * newZoom;
  state.panY = midY - r.top - wy * newZoom;
  applyTransform();
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function finishMarquee() {
  const a = drag.start, b = drag.cur;
  const rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y), rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
  if (rw < 3 && rh < 3) { render(); return; } // ほぼ動かなければ単なる空クリック扱い
  const box = { x: rx, y: ry, w: rw, h: rh };
  const hit = state.shapes.filter((s) => rectsIntersect(box, bbox(s))).map((s) => s.id);
  if (drag.add) { for (const id of hit) if (!isSelected(id)) state.selectedIds.push(id); }
  else state.selectedIds = hit;
  render();
}

/* ======================================================================
   ツール切替・UI
   ====================================================================== */
const TOOL_BTN = { select: "tSelect", rect: "tRect", line: "tLine", text: "tText", pan: "tPan" };
function setTool(t) {
  state.tool = t;
  measure = null;
  for (const k in TOOL_BTN) $(TOOL_BTN[k]).classList.toggle("active", k === t);
  $("calibrate").classList.remove("active");
  $("measure").classList.remove("active");
  if (t !== "fixture") { $("fixtureSel").value = ""; state._pendingFixture = null; }
  viewport.className = (t === "pan") ? "pan" : (t === "select" ? "select" : "");
  viewport.style.cursor = "";
}

function updateStatus() {
  const st = $("scaleStat");
  if (state.mmPerPx) {
    st.className = "scaleOk";
    const perM = (1000 / state.mmPerPx); // 1m = ? px
    st.textContent = `縮尺：1px = ${state.mmPerPx.toFixed(2)}mm（1m ≒ ${Math.round(perM)}px）`;
  } else {
    st.className = "scaleNo";
    st.textContent = "縮尺：未設定（「縮尺合わせ」で設定）";
  }
  $("countStat").textContent = `オブジェクト：${state.shapes.length}`;
}

/* ======================================================================
   保存 / 読込 / 書き出し
   ====================================================================== */
function saveLayout() {
  const data = {
    version: 1, mmPerPx: state.mmPerPx, gridMm: state.gridMm,
    worldW: state.worldW, worldH: state.worldH, shapes: state.shapes,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "layout.json";
  a.click();
  toast("保存しました（layout.json）");
}
async function loadLayout(file) {
  const txt = await file.text();
  try {
    const d = JSON.parse(txt);
    state.shapes = d.shapes || [];
    state.mmPerPx = d.mmPerPx || null;
    state.gridMm = d.gridMm ?? state.gridMm;
    $("gridSel").value = String(state.gridMm);
    state.nextId = state.shapes.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
    clearSelection(); hideSelInfo();
    updateStatus(); render(); pushHistory();
    toast("読み込みました（※同じPDFを開いておくと位置が合います）");
  } catch (e) { toast("JSONの読込に失敗しました", true); }
}

function exportPNG() {
  const out = document.createElement("canvas");
  out.width = state.worldW; out.height = state.worldH;
  const octx = out.getContext("2d");
  octx.fillStyle = "#fff"; octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(canvas, 0, 0);

  // オーバーレイをクローンして選択ハンドルを除いた状態で書き出す
  const clone = overlay.cloneNode(true);
  clone.setAttribute("xmlns", SVGNS);
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    octx.drawImage(img, 0, 0, out.width, out.height);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = "layout.png";
    a.click();
    toast("PNGを書き出しました");
  };
  img.onerror = () => toast("画像化に失敗しました", true);
  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
}

/* ======================================================================
   イベント結線
   ====================================================================== */
function wire() {
  // 什器セレクト
  const fsel = $("fixtureSel");
  let curGroup = null, gEl = null;
  FIXTURES.forEach((f, i) => {
    if (f.g && f.g !== curGroup) {
      curGroup = f.g;
      gEl = document.createElement("optgroup");
      gEl.label = f.g;
      fsel.appendChild(gEl);
    }
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = f.custom ? f.name : `${f.name}　(${f.w}×${f.h})`;
    (f.g ? gEl : fsel).appendChild(o);
  });
  fsel.onchange = () => {
    const v = fsel.value;
    if (v === "") { setTool("select"); return; }
    const def = FIXTURES[parseInt(v, 10)];
    if (def.custom) {
      const wi = prompt("幅 (mm)", "600"); if (wi === null) { fsel.value = ""; return; }
      const hi = prompt("奥行 (mm)", "600"); if (hi === null) { fsel.value = ""; return; }
      const nm = prompt("名称（任意）", "什器") || "";
      const w = parseFloat(wi), h = parseFloat(hi);
      if (isNaN(w) || isNaN(h)) { fsel.value = ""; return; }
      state._pendingFixture = { name: nm, w, h, shape: "rect" };
    } else {
      state._pendingFixture = def;
    }
    setTool("fixture");
    fsel.value = v;
    toast(`「${state._pendingFixture.name || def.name}」を配置：図面上をクリック`);
  };

  // ファイル
  $("pdfInput").onchange = (e) => openFile(e.target.files[0]);
  $("loadInput").onchange = (e) => { if (e.target.files[0]) loadLayout(e.target.files[0]); };

  // ページ
  $("prevPage").onclick = () => { if (state.pdfDoc && state.pageNum > 1) { state.mmPerPx = null; renderPdfPage(state.pageNum - 1).then(() => { updateStatus(); zoomFit(); }); } };
  $("nextPage").onclick = () => { if (state.pdfDoc && state.pageNum < state.pageCount) { state.mmPerPx = null; renderPdfPage(state.pageNum + 1).then(() => { updateStatus(); zoomFit(); }); } };

  // ズーム
  $("zoomIn").onclick = () => { const r = viewport.getBoundingClientRect(); zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2); };
  $("zoomOut").onclick = () => { const r = viewport.getBoundingClientRect(); zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2); };
  $("zoomFit").onclick = zoomFit;

  // ツール
  $("tSelect").onclick = () => setTool("select");
  $("tRect").onclick = () => setTool("rect");
  $("tLine").onclick = () => setTool("line");
  $("tText").onclick = () => setTool("text");
  $("tPan").onclick = () => setTool("pan");
  $("calibrate").onclick = () => startMeasure(true);
  $("measure").onclick = () => startMeasure(false);

  // 寸法入力ダイアログ
  $("dimOk").onclick = confirmDim;
  $("dimCancel").onclick = cancelDim;
  $("dimValue").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); confirmDim(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelDim(); }
  });
  $("dimDialog").addEventListener("pointerdown", (e) => { if (e.target.id === "dimDialog") cancelDim(); });
  const chips = $("dimChips");
  [["ドア900", 900], ["1m", 1000], ["1間1820", 1820], ["2m", 2000], ["2間3640", 3640]].forEach(([label, val]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => { const inp = $("dimValue"); inp.value = val; inp.focus(); };
    chips.appendChild(b);
  });

  // グリッド
  $("gridSel").onchange = (e) => { state.gridMm = parseInt(e.target.value, 10); render(); scheduleAutosave(); };

  // 白紙で開始
  $("blankBtn").onclick = () => {
    blankCanvas();
    state.mmPerPx = null;
    updateStatus(); render(); zoomFit();
    toast("白紙を作成しました。「縮尺合わせ」で寸法を設定してください");
  };

  // Undo / Redo
  $("undoBtn").onclick = undo;
  $("redoBtn").onclick = redo;

  // 保存系
  $("saveBtn").onclick = saveLayout;
  $("exportBtn").onclick = exportPNG;

  // 削除系
  $("deleteBtn").onclick = deleteSelected;
  $("clearBtn").onclick = () => { if (confirm("作図したオブジェクトをすべて消去します。よろしいですか？")) { state.shapes = []; clearSelection(); hideSelInfo(); render(); updateStatus(); pushHistory(); } };

  // 回転ボタン
  $("rotL").onclick = () => rotateSel(-15);
  $("rotR").onclick = () => rotateSel(15);

  // ポインタ
  viewport.addEventListener("pointerdown", onDown);
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
  viewport.addEventListener("dblclick", onDblClick);
  viewport.addEventListener("contextmenu", (e) => e.preventDefault());

  // ホイールズーム
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
  }, { passive: false });

  // キーボード
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });
}

function deleteSelected() {
  if (!state.selectedIds.length) return;
  state.shapes = state.shapes.filter((s) => !isSelected(s.id));
  clearSelection(); hideSelInfo(); render(); updateStatus(); pushHistory();
}
function onDblClick(e) {
  const idAttr = e.target.getAttribute && e.target.getAttribute("data-id");
  if (!idAttr) return;
  const s = state.shapes.find((x) => x.id === parseInt(idAttr, 10));
  if (!s) return;
  if (s.type === "text") {
    const t = prompt("テキストを編集", s.text || "");
    if (t !== null) { s.text = t; selectOnly(s.id); render(); pushHistory(); }
  } else if (s.type === "fixture" || s.type === "rect" || s.type === "ellipse") {
    const nm = prompt("名称を編集", s.name || "");
    if (nm !== null) { s.name = nm; selectOnly(s.id); render(); pushHistory(); }
  }
}
function rotateSel(delta) {
  const sel = getSelected(); if (!sel.length) return;
  for (const s of sel) s.rot = (((s.rot || 0) + delta) % 360 + 360) % 360;
  render(); pushHistory();
}
function nudge(dx, dy) {
  const sel = getSelected(); if (!sel.length) return;
  const step = (state.gridMm > 0 && state.mmPerPx) ? state.gridMm / state.mmPerPx : 5;
  for (const s of sel) {
    if (s.type === "line") { s.x1 += dx * step; s.x2 += dx * step; s.y1 += dy * step; s.y2 += dy * step; }
    else { s.x += dx * step; s.y += dy * step; }
  }
  render(); scheduleHistory();
}
function onKey(e) {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;

  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (k === "y") { e.preventDefault(); redo(); return; }
    if (k === "c") { copySelection(); return; }
    if (k === "v") { e.preventDefault(); pasteClipboard(); return; }
    if (k === "d") { e.preventDefault(); duplicateSelection(); return; }
    if (k === "a") { e.preventDefault(); selectAll(); return; }
    if (k === "s") { e.preventDefault(); saveLayout(); return; }
  }

  if (e.code === "Space") { spaceDown = true; viewport.classList.add("pan"); e.preventDefault(); return; }
  switch (e.key) {
    case "Delete": case "Backspace": deleteSelected(); e.preventDefault(); break;
    case "Escape": setTool("select"); measure = null; clearSelection(); hideSelInfo(); render(); break;
    case "v": case "V": setTool("select"); break;
    case "r": if (getSel()) rotateSel(e.shiftKey ? -15 : 15); else setTool("rect"); break;
    case "R": rotateSel(-15); break;
    case "l": case "L": setTool("line"); break;
    case "t": case "T": setTool("text"); break;
    case "ArrowLeft": nudge(-1, 0); e.preventDefault(); break;
    case "ArrowRight": nudge(1, 0); e.preventDefault(); break;
    case "ArrowUp": nudge(0, -1); e.preventDefault(); break;
    case "ArrowDown": nudge(0, 1); e.preventDefault(); break;
  }
}

/* ---- init ---- */
window.addEventListener("DOMContentLoaded", () => {
  wire();
  setSceneSize(1200, 800);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 1200, 800);
  applyTransform();

  // 前回の自動保存があれば復元
  const restored = restoreAutosave();
  if (restored) toast("前回の作図を復元しました（PDF/画像は再度開いてください）");

  updateStatus();
  render();
  zoomFit();
  pushHistory(); // 履歴のベースライン
});

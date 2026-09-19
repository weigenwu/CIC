import {
  LABELS,
  COLORS,
  ARROW_COLORS,
  arrowColor,
  arrowCounts,
  clamp,
  screenToImage,
  bounds,
  center,
  nearestSpot,
  geometryToGeoJSON,
  validGeometry,
  toCSV,
  validateProject,
  mergeProjects,
} from "./core.js?v=20260919-arrows";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const now = () => new Date().toISOString(),
  num = (n) =>
    Number.isFinite(n)
      ? n.toLocaleString("en-US", { maximumFractionDigits: 3 })
      : "NA",
  storageKey =
    "cic-atlas-project-v1" +
    (new URLSearchParams(location.search).get("qa") === "1" ? "-qa" : "");
let manifest,
  project,
  section,
  image,
  thumb,
  spots = [],
  selected = null,
  selectedSpot = null,
  tool = "pan",
  markerColor = "red",
  drawRole = "new",
  draft = null,
  showMarks = true,
  space = false,
  drag = null,
  ready = false;
let view = { x: 0, y: 0, scale: 1 },
  undoStack = [],
  redoStack = [],
  loadToken = 0,
  frame = 0,
  rankIndex = -1,
  tileIndex = -1,
  currentURL = null,
  storageBlocked = false,
  multiTabConflict = false;
let stageSize = { width: 0, height: 0 }, focusBeforeFullscreen = false;
const canvas = $("#canvas"),
  ctx = canvas.getContext("2d"),
  stage = $("#stage"),
  mini = $("#minimap"),
  mc = mini.getContext("2d");
const metric = () => $("#metric").value,
  overlay = () => $("#overlay-toggle").checked,
  annotations = () =>
    project.annotations.filter((a) => a.section === section?.id),
  current = () => project.annotations.find((a) => a.id === selected);
function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("visible"), 4500);
}
async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`无法载入 ${url}`);
  return r.json();
}
function save() {
  if (multiTabConflict) {
    toast("另一窗口修改了项目；请先导出此窗口 JSON，然后刷新合并。");
    return;
  }
  try {
    project.updatedAt = now();
    localStorage.setItem(storageKey, JSON.stringify(project));
    storageBlocked = false;
    $("#save-status").textContent = "已保存到此浏览器";
    $("#save-status").classList.remove("red");
  } catch {
    storageBlocked = true;
    $("#save-status").textContent = "保存失败，请导出 JSON";
    $("#save-status").classList.add("red");
    toast("浏览器存储不可用或已满，请导出 JSON 备份。");
  }
}
function history() {
  undoStack.push(
    JSON.stringify({
      annotations: project.annotations,
      reviewed: project.reviewed,
    }),
  );
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
}
function commit(fn) {
  if (multiTabConflict) {
    toast("其他窗口已更新，请导出备份后刷新。");
    return;
  }
  history();
  fn();
  save();
  renderPanels();
  draw();
  reviewProgress();
}
function undo(redo = false) {
  if (multiTabConflict) return;
  const from = redo ? redoStack : undoStack,
    to = redo ? undoStack : redoStack;
  if (!from.length) return;
  to.push(
    JSON.stringify({
      annotations: project.annotations,
      reviewed: project.reviewed,
    }),
  );
  Object.assign(project, JSON.parse(from.pop()));
  selected = null;
  draft = null;
  drawRole = "new";
  save();
  renderPanels();
  draw();
  reviewProgress();
}
function expose() {
  if (!section || !spots.length) return;
  const e = project.exposures[section.id] || { firstSeen: now(), metrics: [] };
  if (!e.metrics.includes(metric())) {
    e.metrics.push(metric());
    project.exposures[section.id] = e;
    save();
  }
  renderMode();
}
function renderMode() {
  const exposed = !!project.exposures[section.id];
  $("#review-mode").textContent = overlay()
    ? "表达导航 · 已接触表达信息"
    : exposed
      ? "形态阅片 · 此片已看过表达"
      : "形态阅片 · 表达未显示";
  $("#review-mode").classList.toggle("exposed", exposed);
  $("#focus-overlay").setAttribute("aria-pressed", String(overlay()));
  $("#focus-overlay").textContent = overlay() ? "隐藏表达" : "表达叠层";
}
function requestDraw() {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
}
function resize() {
  const r = stage.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  if (stageSize.width && stageSize.height) {
    view.x += (r.width - stageSize.width) / 2;
    view.y += (r.height - stageSize.height) / 2;
  }
  stageSize = { width: r.width, height: r.height };
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  requestDraw();
}
function setFocusView(enabled) {
  document.body.classList.toggle("focus-view", enabled);
  $("#focus-view").textContent = enabled ? "退出专注" : "专注阅片";
  $("#focus-view").setAttribute("aria-pressed", String(enabled));
  stage.focus({ preventScroll: true });
}
async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  focusBeforeFullscreen = document.body.classList.contains("focus-view");
  setFocusView(true);
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    toast("此浏览器未进入系统全屏，已打开铺满网页的专注阅片。");
  }
}
function chooseArrowColor(color) {
  markerColor = color;
  document.querySelectorAll("[data-marker-color]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.markerColor === color)));
  setTool("point");
}
function fit() {
  if (!section) return;
  view.scale =
    Math.min(
      stage.clientWidth / section.width,
      stage.clientHeight / section.height,
    ) * 0.94;
  view.x = (stage.clientWidth - section.width * view.scale) / 2;
  view.y = (stage.clientHeight - section.height * view.scale) / 2;
  draw();
}
function jump(x, y, scale = 1.4) {
  if (!ready) return;
  view.scale = clamp(scale, 0.02, 12);
  view.x = stage.clientWidth / 2 - x * view.scale;
  view.y = stage.clientHeight / 2 - y * view.scale;
  draw();
}
function zoom(factor, p = [stage.clientWidth / 2, stage.clientHeight / 2]) {
  if (!ready) return;
  const q = screenToImage(p, view);
  view.scale = clamp(view.scale * factor, 0.02, 12);
  view.x = p[0] - q[0] * view.scale;
  view.y = p[1] - q[1] * view.scale;
  draw();
}
function screen(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
function pixel(e) {
  const p = screenToImage(screen(e), view);
  return [clamp(p[0], 0, section.width), clamp(p[1], 0, section.height)];
}
function inside(e) {
  const p = screenToImage(screen(e), view);
  return (
    p[0] >= 0 && p[1] >= 0 && p[0] <= section.width && p[1] <= section.height
  );
}
function range() {
  const v = spots.map((s) => s.values[metric()]).filter(Number.isFinite);
  return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0];
}
function color(v, min, max) {
  if (v === null || !Number.isFinite(v)) return "#bbb";
  const t = max > min ? clamp((v - min) / (max - min), 0, 1) : 0;
  return `rgb(${Math.round(221 - 200 * t)},${Math.round(233 - 172 * t)},${Math.round(186 - 122 * t)})`;
}
function path(g) {
  ctx.beginPath();
  if (g.type === "point") ctx.arc(g.x, g.y, 7 / view.scale, 0, Math.PI * 2);
  if (g.type === "ellipse")
    ctx.ellipse(g.x, g.y, g.rx, g.ry, 0, 0, Math.PI * 2);
  if (g.type === "polygon") {
    g.points.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    ctx.closePath();
  }
}
function paintGeometry(g, color, dashed = false) {
  path(g);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / view.scale;
  ctx.setLineDash(dashed ? [5 / view.scale, 3 / view.scale] : []);
  ctx.stroke();
  ctx.fillStyle = color + "15";
  ctx.fill();
  ctx.setLineDash([]);
}
function paintArrow(g, color, selected) {
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.scale(1 / view.scale, 1 / view.scale);
  ctx.beginPath();
  ctx.moveTo(-30, -30);
  ctx.lineTo(-6, -6);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-4, -15);
  ctx.lineTo(-15, -4);
  ctx.closePath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  if (selected) {
    ctx.beginPath();
    ctx.arc(-30, -30, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}
function draw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  if (!image || !ready) return;
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  // ponytail: retain only the current 92 MP original; use tiny thumbnails for navigation.
  ctx.imageSmoothingEnabled = view.scale < 1;
  ctx.drawImage(image, 0, 0);
  if (overlay()) {
    const [min, max] = range();
    ctx.globalAlpha = Number($("#opacity").value) / 100;
    for (const s of spots) {
      const x = view.x + s.x * view.scale,
        y = view.y + s.y * view.scale;
      if (
        x < -30 ||
        y < -30 ||
        x > stage.clientWidth + 30 ||
        y > stage.clientHeight + 30
      )
        continue;
      ctx.beginPath();
      ctx.arc(
        s.x,
        s.y,
        clamp(52 * view.scale, 4, 16) / view.scale,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = color(s.values[metric()], min, max);
      ctx.fill();
      ctx.lineWidth = 0.8 / view.scale;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (selectedSpot && overlay()) {
    const s = spots.find((s) => s.id === selectedSpot);
    if (s) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 22 / view.scale, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3 / view.scale;
      ctx.stroke();
      ctx.strokeStyle = "#28694f";
      ctx.lineWidth = 1.5 / view.scale;
      ctx.stroke();
    }
  }
  if (showMarks)
    for (const a of annotations()) {
      const isArrow = a.geometry.type === "point";
      if (isArrow) paintArrow(a.geometry, ARROW_COLORS[arrowColor(a)], a.id === selected);
      else paintGeometry(a.geometry, COLORS[a.label]);
      if (a.outer) paintGeometry(a.outer, "#52bfe0", true);
      a.inner.forEach((g) => paintGeometry(g, "#e592ca", true));
      if (isArrow) continue;
      const b = bounds(a.geometry);
      ctx.font = `${11 / view.scale}px sans-serif`;
      const tx = b.x,
        ty = b.y - 10 / view.scale;
      ctx.fillStyle = a.id === selected ? "#174435dd" : "#ffffffdd";
      ctx.fillRect(
        tx - 2 / view.scale,
        ty - 12 / view.scale,
        53 / view.scale,
        17 / view.scale,
      );
      ctx.fillStyle = a.id === selected ? "#fff" : "#3e5944";
      ctx.fillText(a.id.slice(-6), tx + 2 / view.scale, ty);
      if (a.id === selected) {
        ctx.strokeStyle = "#163f32";
        ctx.lineWidth = 1 / view.scale;
        ctx.setLineDash([3 / view.scale, 3 / view.scale]);
        ctx.strokeRect(
          b.x - 6 / view.scale,
          b.y - 6 / view.scale,
          b.width + 12 / view.scale,
          b.height + 12 / view.scale,
        );
        ctx.setLineDash([]);
      }
    }
  if (draft) {
    if (draft.type === "polygon") {
      ctx.strokeStyle = "#225b47";
      ctx.lineWidth = 2 / view.scale;
      ctx.setLineDash([5 / view.scale, 3 / view.scale]);
      ctx.beginPath();
      draft.points.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
      ctx.stroke();
      for (const p of draft.points) {
        ctx.beginPath();
        ctx.arc(...p, 3 / view.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#225b47";
        ctx.fill();
      }
    } else paintGeometry(draft, "#225b47", true);
    ctx.setLineDash([]);
  }
  ctx.restore();
  $("#zoom-label").textContent = Math.round(view.scale * 100) + "%";
  drawMini();
}
function drawMini() {
  mc.clearRect(0, 0, mini.width, mini.height);
  if (!thumb || !section) return;
  const s = Math.min(mini.width / section.width, mini.height / section.height),
    x = (mini.width - section.width * s) / 2,
    y = (mini.height - section.height * s) / 2;
  mc.drawImage(thumb, x, y, section.width * s, section.height * s);
  mc.fillStyle = "#bad3a62b";
  mc.fillRect(
    x - (view.x / view.scale) * s,
    y - (view.y / view.scale) * s,
    (stage.clientWidth / view.scale) * s,
    (stage.clientHeight / view.scale) * s,
  );
  mc.strokeStyle = "#477146";
  mc.lineWidth = 1.5;
  mc.strokeRect(
    x - (view.x / view.scale) * s,
    y - (view.y / view.scale) * s,
    (stage.clientWidth / view.scale) * s,
    (stage.clientHeight / view.scale) * s,
  );
}
function renderSections() {
  const all = [
    ...manifest.sections,
    ...project.sections.filter((s) => s.id.startsWith("local_")),
  ];
  $("#focus-section").innerHTML = all.map((s) =>
    `<option value="${esc(s.id)}">${esc(s.name || s.id)}</option>`).join("");
  $("#focus-section").value = section?.id || "";
  $("#section-list").innerHTML = all
    .map(
      (s) =>
        `<button class="section-card ${s.id === section?.id ? "active" : ""}" data-section="${esc(s.id)}">${s.thumbnail ? `<img src="${esc(s.thumbnail)}" alt="${esc(s.id)} 切片">` : '<span class="brandmark">▧</span>'}<span><strong>${esc(s.name || s.id)}</strong><small>${s.patient ? "患者 " + esc(s.patient) + " · " : ""}${s.spotCount || 0} spots</small></span><span class="section-n">${project.annotations.filter((a) => a.section === s.id).length}</span></button>`,
    )
    .join("");
  $("#section-list")
    .querySelectorAll("button")
    .forEach((b) => (b.onclick = () => loadSection(b.dataset.section)));
}
function renderPanels() {
  renderSections();
  if (!section) return;
  renderMode();
  const list = annotations(),
    a = current();
  $("#total-badge").textContent = project.annotations.length;
  const counts = arrowCounts(list);
  $("#red-count").textContent = counts.red;
  $("#blue-count").textContent = counts.blue;
  $("#arrow-count").textContent = counts.total;
  $("#focus-counts").innerHTML = `<span class="red-text">↘ 红 ${counts.red}</span><span class="blue-text">↘ 蓝 ${counts.blue}</span><strong>合计 ${counts.total}</strong>`;
  $("#delete-selected").disabled = !a;
  $("#undo").disabled = !undoStack.length;
  $("#redo").disabled = !redoStack.length;
  const filtered = list.filter(
    (a) =>
      $("#annotation-filter").value === "all" ||
      a.label === $("#annotation-filter").value ||
      (a.geometry.type === "point" && arrowColor(a) === $("#annotation-filter").value),
  );
  $("#annotation-list").innerHTML = filtered.length
    ? filtered
        .map(
          (a) =>
            `<button class="annotation-item ${a.id === selected ? "active" : ""}" data-id="${esc(a.id)}"><span><i class="dot" style="background:${a.geometry.type === "point" ? ARROW_COLORS[arrowColor(a)] : COLORS[a.label]}"></i>${esc(a.id.slice(-6))}<small>${center(
              a.geometry,
            )
              .map((n) => Math.round(n))
              .join(
                ", ",
              )} px</small></span><span>${LABELS[a.label]}</span></button>`,
        )
        .join("")
    : '<p class="micro">此切片暂无符合条件的标注</p>';
  $("#annotation-list")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          selected = b.dataset.id;
          drawRole = "new";
          jump(...center(current().geometry), Math.max(view.scale, 1.5));
          renderPanels();
        }),
    );
  if (!a) {
    $("#selection-panel").innerHTML =
      '<div class="empty-note"><span>↘</span><strong>一个箭头，一处结构</strong><p>按 R 选红色，B 选蓝色，<br>单击放置箭头，每个计 1。</p></div>';
    renderSpotDetail();
    return;
  }
  $("#selection-panel").innerHTML =
    `<div class="detail-title"><strong>${esc(a.id.slice(-6))}</strong><button id="delete-mark" class="small red">删除</button></div><div class="status-buttons">${Object.entries(
      LABELS,
    )
      .map(
        ([k, l]) =>
          `<button data-label="${k}" class="${a.label === k ? "active" : ""}">${l}</button>`,
      )
      .join(
        "",
      )}</div><div class="property-row"><label>置信度<select id="confidence"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label>内细胞数量<input id="inner-count" type="number" min="0" max="100" value="${a.innerCount}"></label></div><p class="micro">${center(
      a.geometry,
    )
      .map((n) => num(n))
      .join(
        " / ",
      )} px · ${esc(a.annotator || "未填写标注者")}</p><div class="inner-tools"><button data-role="structure">重画范围</button><button data-role="outer">外细胞轮廓${a.outer ? " ✓" : ""}</button><button data-role="inner">＋ 内细胞 (${a.inner.length})</button></div>${a.inner.length || a.outer ? '<button id="clear-contours" class="small">移除内外轮廓</button>' : ""}<p class="micro">选定后用椭圆或多边形绘制。青色 = 外细胞，粉色 = 内细胞。</p><label class="field-label" for="notes">形态依据 / 备注</label><textarea id="notes" maxlength="10000" placeholder="完整包裹、独立细胞核、无法排除的重叠…">${esc(a.notes)}</textarea><p class="micro">${project.exposures[a.section] ? "此切片已接触表达信息" : "本工具中此切片尚未显示表达信息"}</p>`;
  if (a.geometry.type === "point") {
    $("#selection-panel").insertAdjacentHTML("afterbegin", '<label class="field-label" for="marker-color">所选箭头颜色（计数 1）</label><select id="marker-color"><option value="red">红色</option><option value="blue">蓝色</option></select>');
    $("#marker-color").value = arrowColor(a);
    $("#marker-color").onchange = (e) => update({ markerColor: e.target.value });
  }
  $("#confidence").value = a.confidence;
  $("#confidence").onchange = (e) => update({ confidence: e.target.value });
  $("#inner-count").onchange = (e) =>
    update({
      innerCount: Math.round(clamp(Number(e.target.value) || 0, 0, 100)),
    });
  $("#notes").onfocus = () => {
    if (!multiTabConflict) history();
  };
  $("#notes").oninput = (e) => {
    if (multiTabConflict) return;
    a.notes = e.target.value;
    a.updatedAt = now();
    save();
    $("#undo").disabled = false;
  };
  $("#delete-mark").onclick = deleteSelected;
  $("#selection-panel")
    .querySelectorAll("[data-label]")
    .forEach((b) => (b.onclick = () => update({ label: b.dataset.label })));
  $("#selection-panel")
    .querySelectorAll("[data-role]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          drawRole = b.dataset.role;
          setTool("ellipse", true);
          toast("请在原图上绘制" + b.textContent);
          b.classList.add("active");
        }),
    );
  if ($("#clear-contours"))
    $("#clear-contours").onclick = () => update({ inner: [], outer: null });
  renderSpotDetail();
}
function update(values) {
  if (!current()) return;
  commit(() =>
    Object.assign(current(), values, {
      updatedAt: now(),
      annotator: $("#annotator").value.trim() || current().annotator,
    }),
  );
}
function deleteSelected() {
  if (!current()) return;
  commit(() => {
    project.annotations = project.annotations.filter((a) => a.id !== selected);
    selected = null;
    drawRole = "new";
  });
  toast("标注已删除，可撤销");
}
function setTool(next, keepRole = false) {
  tool = next;
  draft = null;
  if (!keepRole) drawRole = "new";
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tool === next));
  canvas.style.cursor = tool === "pan" ? "grab" : "crosshair";
  $("#canvas-hint").textContent =
    next === "polygon"
      ? "逐点勾画 · Enter 完成 · Esc 取消"
      : next === "point"
        ? `单击添加${markerColor === "red" ? "红" : "蓝"}箭头 · 每个计 1 · 空格拖动`
        : next === "ellipse"
          ? "拖动圈选结构 · 空格拖动"
          : "滚轮缩放 · 空格拖动 · R 红箭头 / B 蓝箭头 · Tab 专注阅片";
  draw();
}
function addGeometry(g) {
  if (!validGeometry(g, section)) {
    toast("轮廓过小、无效或超出原图，请重新绘制");
    draft = null;
    draw();
    return;
  }
  commit(() => {
    const a = current();
    if (a && drawRole !== "new") {
      if (drawRole === "outer") a.outer = g;
      else if (drawRole === "inner") a.inner.push(g);
      else a.geometry = g;
      a.updatedAt = now();
    } else {
      const id = section.id + "_" + crypto.randomUUID().slice(0, 8);
      project.annotations.push({
        id,
        section: section.id,
        label: "probable_CIC",
        confidence: "medium",
        innerCount: 1,
        geometry: g,
        ...(g.type === "point" ? { markerColor } : {}),
        outer: null,
        inner: [],
        notes: "",
        annotator: $("#annotator").value.trim(),
        createdAt: now(),
        updatedAt: now(),
        createdBlinded: !project.exposures[section.id],
      });
      selected = id;
    }
  });
  draft = null;
  drawRole = "new";
  draw();
}
function hitAnnotation(p) {
  for (const a of [...annotations()].reverse()) {
    if (a.geometry.type === "point") {
      const dx = (p[0] - a.geometry.x) * view.scale,
        dy = (p[1] - a.geometry.y) * view.scale,
        t = clamp(-(dx + dy) / 60, 0, 1);
      if (Math.hypot(dx + 30 * t, dy + 30 * t) <= 9) return a;
      continue;
    }
    const b = bounds(a.geometry),
      pad = 10 / view.scale;
    if (
      p[0] >= b.x - pad &&
      p[0] <= b.x + b.width + pad &&
      p[1] >= b.y - pad &&
      p[1] <= b.y + b.height + pad
    )
      return a;
  }
  return null;
}
canvas.addEventListener("pointerdown", (e) => {
  if (!ready || ![0, 1].includes(e.button)) return;
  stage.focus();
  canvas.setPointerCapture(e.pointerId);
  if (space || tool === "pan" || e.button === 1) {
    drag = {
      type: "pan",
      start: screen(e),
      view: { ...view },
      moved: false,
      select: !space && e.button === 0,
    };
    canvas.style.cursor = "grabbing";
    return;
  }
  if (!inside(e)) {
    toast("请在原图范围内标注");
    return;
  }
  const p = pixel(e);
  if (tool === "point") addGeometry({ type: "point", x: p[0], y: p[1] });
  if (tool === "ellipse") drag = { type: "ellipse", start: p };
  if (tool === "polygon") {
    if (!draft) draft = { type: "polygon", points: [] };
    draft.points.push(p);
    draw();
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!ready) return;
  const p = pixel(e);
  $("#cursor-position").textContent =
    `X ${Math.round(p[0])}　Y ${Math.round(p[1])}`;
  if (drag?.type === "pan") {
    const q = screen(e),
      dx = q[0] - drag.start[0],
      dy = q[1] - drag.start[1];
    view.x = drag.view.x + dx;
    view.y = drag.view.y + dy;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    requestDraw();
  }
  if (drag?.type === "ellipse") {
    draft = {
      type: "ellipse",
      x: (p[0] + drag.start[0]) / 2,
      y: (p[1] + drag.start[1]) / 2,
      rx: Math.abs(p[0] - drag.start[0]) / 2,
      ry: Math.abs(p[1] - drag.start[1]) / 2,
    };
    requestDraw();
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (drag?.type === "ellipse" && draft) {
    if (draft.rx * view.scale > 3 && draft.ry * view.scale > 3)
      addGeometry(draft);
    else {
      draft = null;
      toast("拖动至少 6 像素，或用 P 单击标记");
    }
  }
  if (drag?.type === "pan" && !drag.moved && drag.select) {
    const a = showMarks && hitAnnotation(pixel(e));
    selected = a ? a.id : null;
    drawRole = "new";
    if (!a && overlay()) {
      const near = nearestSpot(
        { type: "point", x: pixel(e)[0], y: pixel(e)[1] },
        spots,
      );
      if (near && near.distance * view.scale < 25) selectedSpot = near.spot.id;
    }
    renderPanels();
  }
  drag = null;
  canvas.style.cursor = tool === "pan" ? "grab" : "crosshair";
  draw();
});
canvas.addEventListener("pointercancel", () => {
  drag = null;
  draft = null;
  draw();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * 0.0015), screen(e));
  },
  { passive: false },
);
canvas.addEventListener("dblclick", (e) => {
  if (tool === "pan") zoom(2, screen(e));
});
mini.addEventListener("click", (e) => {
  if (!ready) return;
  const r = mini.getBoundingClientRect(),
    s = Math.min(mini.width / section.width, mini.height / section.height),
    x = ((e.clientX - r.left) / r.width) * mini.width,
    y = ((e.clientY - r.top) / r.height) * mini.height;
  jump(
    clamp((x - (mini.width - section.width * s) / 2) / s, 0, section.width),
    clamp((y - (mini.height - section.height * s) / 2) / s, 0, section.height),
    view.scale,
  );
});
function sortedSpots() {
  const p = $("#pathology-filter").value,
    m = metric(),
    sign = $("#rank-order").value === "asc" ? 1 : -1;
  return spots
    .filter(
      (s) => (p === "all" || s.pathology === p) && Number.isFinite(s.values[m]),
    )
    .sort(
      (a, b) => sign * (a.values[m] - b.values[m]) || a.id.localeCompare(b.id),
    );
}
function renderSpatial() {
  const meta = manifest.metrics.find((m) => m.key === metric());
  $("#metric-unit").textContent = meta?.unit || "";
  const on = overlay() && spots.length > 0;
  $("#rank-order").disabled = !on;
  $("#pathology-filter").disabled = !on;
  $("#next-spot").disabled = !on;
  $("#opacity").disabled = !on;
  $("#legend").hidden = !on;
  if (!on) {
    $("#spot-list").innerHTML =
      '<p class="micro">打开叠加后显示表达排序与位置导航。</p>';
    renderMode();
    renderSpotDetail();
    draw();
    return;
  }
  expose();
  const [min, max] = range();
  $("#legend-min").textContent = num(min);
  $("#legend-max").textContent = num(max);
  $("#spot-list").innerHTML = sortedSpots()
    .map(
      (s, i) =>
        `<button class="spot-row ${s.id === selectedSpot ? "active" : ""}" data-spot="${esc(s.id)}"><span>${String(i + 1).padStart(2, "0")} · ${esc(s.id)}</span><span>${num(s.values[metric()])}</span></button>`,
    )
    .join("");
  $("#spot-list")
    .querySelectorAll("button")
    .forEach((b) => (b.onclick = () => jumpSpot(b.dataset.spot)));
  renderSpotDetail();
  draw();
}
function jumpSpot(id) {
  if (!ready || !overlay()) return;
  const s = spots.find((s) => s.id === id);
  if (!s) return;
  selectedSpot = id;
  rankIndex = sortedSpots().findIndex((s) => s.id === id);
  expose();
  jump(s.x, s.y, 1.5);
  renderSpatial();
}
function renderSpotDetail() {
  if (!overlay()) {
    $("#spot-detail").innerHTML = "";
    return;
  }
  const a = current(),
    nearest = a ? nearestSpot(a.geometry, spots) : null,
    s = nearest?.spot || spots.find((s) => s.id === selectedSpot);
  if (!s) {
    $("#spot-detail").innerHTML = "";
    return;
  }
  $("#spot-detail").innerHTML =
    `<strong>${nearest ? "所选标注的最近 spot" : "当前 spot"} · ${esc(s.id)}</strong><br><span class="micro">${esc(s.pathology)}${nearest ? " · 中心距离 " + num(nearest.distance) + " px" : ""}</span><dl>${manifest.metrics
      .slice(0, 4)
      .map((m) => `<dt>${esc(m.label)}</dt><dd>${num(s.values[m.key])}</dd>`)
      .join(
        "",
      )}</dl><span class="micro">最近中心 ≠ 被捕获；未赋予细胞基因归属。</span>`;
  const e = project.exposures[section.id];
  if (e) {
    const extra = manifest.metrics
      .slice(0, 4)
      .map((m) => m.key)
      .filter((k) => !e.metrics.includes(k));
    if (extra.length) {
      e.metrics.push(...extra);
      save();
    }
  }
}
async function imageStore(action, key, value) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("cic-atlas-images", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("images");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(
          "images",
          action === "get" ? "readonly" : "readwrite",
        ),
        s = t.objectStore("images"),
        r = action === "get" ? s.get(key) : s.put(value, key);
      let result;
      r.onsuccess = () => (result = r.result);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
async function loadSection(id) {
  const next =
    manifest.sections.find((s) => s.id === id) ||
    project.sections.find((s) => s.id === id);
  if (!next) return;
  const token = ++loadToken;
  ready = false;
  section = next;
  image = null;
  thumb = null;
  spots = [];
  selected = null;
  selectedSpot = null;
  rankIndex = -1;
  tileIndex = -1;
  draft = null;
  drag = null;
  drawRole = "new";
  $("#overlay-toggle").checked = false;
  if (currentURL) {
    URL.revokeObjectURL(currentURL);
    currentURL = null;
  }
  $("#loading").hidden = false;
  $("#loading").textContent = "正在载入原图…";
  $("#section-title").textContent = next.name || next.id;
  $("#image-meta").textContent =
    `${next.width.toLocaleString()} × ${next.height.toLocaleString()} px · 原图`;
  renderPanels();
  draw();
  renderSpatial();
  try {
    let url = next.image;
    if (id.startsWith("local_")) {
      const blob = await imageStore("get", next.sha256);
      if (!blob)
        throw new Error(
          "本地图片未在此浏览器保存，请点“打开本地图片”重新选择同一原图。",
        );
      url = URL.createObjectURL(blob);
      if (token !== loadToken) {
        URL.revokeObjectURL(url);
        return;
      }
      currentURL = url;
    }
    const im = new Image();
    im.src = url;
    const sp = next.spots ? json(next.spots) : Promise.resolve([]);
    await im.decode();
    const values = await sp;
    if (token !== loadToken) return;
    if (im.naturalWidth !== next.width || im.naturalHeight !== next.height)
      throw new Error("原图尺寸不一致，已停止标注以保护坐标。");
    image = im;
    spots = values;
    if (next.thumbnail) {
      const tm = new Image();
      tm.src = next.thumbnail;
      await tm.decode();
      if (token !== loadToken) return;
      thumb = tm;
    } else {
      thumb = document.createElement("canvas");
      thumb.width = 160;
      thumb.height = Math.round((160 * next.height) / next.width);
      thumb.getContext("2d").drawImage(im, 0, 0, thumb.width, thumb.height);
    }
    ready = true;
    $("#loading").hidden = true;
    $("#pathology-filter").innerHTML =
      '<option value="all">全部组织</option>' +
      [...new Set(spots.map((s) => s.pathology))]
        .sort()
        .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`)
        .join("");
    $("#overlay-toggle").disabled = !spots.length;
    renderBookmarks();
    renderSpatial();
    fit();
    project.activeSection = id;
    save();
    renderPanels();
  } catch (e) {
    if (token !== loadToken) return;
    $("#loading").textContent = e.message;
    toast(e.message);
  }
}
function renderBookmarks() {
  const rs = section.rois || [],
    bs = section.bookmarks || [];
  $("#bookmarks").innerHTML =
    [
      ...bs.map(
        (b, i) =>
          `<button class="bookmark" data-focus="${i}">◇ ${esc(b.id)} · 待复核</button>`,
      ),
      ...rs.map(
        (r, i) =>
          `<button class="bookmark" data-roi="${i}">${esc(r.id)} · 原有视野</button>`,
      ),
    ].join("") +
    '<p class="micro">原有书签不计入 CIC 标注。</p><div class="review-controls"><button id="previous-tile">← 视野</button><button id="next-tile">视野 →</button></div><button id="review-tile" class="wide">标记当前视野已阅</button><p id="review-progress" class="micro"></p>';
  $("#bookmarks")
    .querySelectorAll("[data-focus]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const f = bs[Number(b.dataset.focus)];
          jump(f.x, f.y, 2);
          toast(f.note);
        }),
    );
  $("#bookmarks")
    .querySelectorAll("[data-roi]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const r = rs[Number(b.dataset.roi)];
          jump(
            r.x + r.width / 2,
            r.y + r.height / 2,
            Math.min(
              stage.clientWidth / r.width,
              stage.clientHeight / r.height,
            ) * 0.9,
          );
        }),
    );
  $("#previous-tile").onclick = () => visitTile(-1);
  $("#next-tile").onclick = () => visitTile(1);
  $("#review-tile").onclick = () => {
    if (!ready) return;
    const x = clamp(-view.x / view.scale, 0, section.width),
      y = clamp(-view.y / view.scale, 0, section.height),
      width =
        clamp((stage.clientWidth - view.x) / view.scale, 0, section.width) - x,
      height =
        clamp((stage.clientHeight - view.y) / view.scale, 0, section.height) -
        y;
    if (width <= 0 || height <= 0) return;
    commit(() => {
      (project.reviewed[section.id] ??= []).push({
        id: crypto.randomUUID(),
        x,
        y,
        width,
        height,
        reviewedAt: now(),
        annotator: $("#annotator").value.trim(),
        expressionExposed: !!project.exposures[section.id],
      });
    });
    toast("已记录这个视野；不等同于此区域没有 CIC");
  };
  reviewProgress();
}
function reviewProgress() {
  if ($("#review-progress") && section)
    $("#review-progress").textContent =
      `已记录 ${project.reviewed[section.id]?.length || 0} 个阅片视野（可能重叠）`;
}
function visitTile(delta) {
  const cols = Math.ceil(section.width / 1024),
    rows = Math.ceil(section.height / 1024);
  tileIndex = clamp(tileIndex + delta, 0, cols * rows - 1);
  const y = Math.floor(tileIndex / cols),
    x = y % 2 ? cols - 1 - (tileIndex % cols) : tileIndex % cols;
  jump(
    clamp(x * 1024 + 512, 0, section.width),
    clamp(y * 1024 + 512, 0, section.height),
    (Math.min(stage.clientWidth, stage.clientHeight) / 1024) * 0.94,
  );
  toast(`顺序视野 ${tileIndex + 1} / ${cols * rows} · 包含空白区域`);
}
function exportProject() {
  return {
    ...structuredClone(project),
    exportedAt: now(),
    coordinateSystem: manifest.coordinateSystem,
    selectionNote: "五张为分子关联与覆盖优选的探索集，非独立随机验证集",
    source: manifest.source,
    metrics: manifest.metrics,
  };
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.textContent = `保存 ${name} (${num(blob.size / 1024)} KB)`;
  a.className = 'download-link';
  let container = document.querySelector('#download-links');
  if (!container) {
    container = document.createElement('div');
    container.id = 'download-links';
    document.querySelector('#export-dialog').append(container);
  }
  container.append(a);
  a.click();
  // Keep a normal visible link for browsers that block automatic downloads.
  if (container.children.length > 6) {
    const old = container.firstElementChild;
    URL.revokeObjectURL(old.href);
    old.remove();
  }
}
async function exportCSV() {
  try {
    const allSpots = new Map();
    for (const s of manifest.sections) allSpots.set(s.id, await json(s.spots));
    const cols = [
      "patient",
      "section",
      "object_id",
      "label",
      "confidence",
      "x_px",
      "y_px",
      "x_min",
      "x_max",
      "y_min",
      "y_max",
      "annotator",
      "blinded_to_spatial_scores",
      "created_blinded",
      "expression_metrics_seen",
      "inner_cell_count",
      "notes",
      "source_width",
      "source_height",
      "source_sha256",
      "geometry_json",
      "marker_color",
      "arrow_count",
      "outer_cell_json",
      "inner_cells_json",
      "nearest_spot_id",
      "nearest_spot_distance_px",
      "cell_gene_assignment",
      ...manifest.metrics.map((m) => "nearest_spot_" + m.key),
      "created_at",
      "updated_at",
    ];
    const rows = project.annotations.map((a) => {
      const s = project.sections.find((s) => s.id === a.section),
        b = bounds(a.geometry),
        p = center(a.geometry),
        n = nearestSpot(a.geometry, allSpots.get(a.section) || []);
      return {
        patient: s.patient || "",
        section: a.section,
        object_id: a.id,
        label: a.label,
        confidence: a.confidence,
        x_px: p[0],
        y_px: p[1],
        x_min: b.x,
        x_max: b.x + b.width,
        y_min: b.y,
        y_max: b.y + b.height,
        annotator: a.annotator,
        blinded_to_spatial_scores: !project.exposures[a.section],
        created_blinded: a.createdBlinded,
        expression_metrics_seen: (
          project.exposures[a.section]?.metrics || []
        ).join(";"),
        inner_cell_count: a.innerCount,
        notes: a.notes,
        source_width: s.width,
        source_height: s.height,
        source_sha256: s.sha256,
        geometry_json: JSON.stringify(a.geometry),
        marker_color: a.geometry.type === "point" ? arrowColor(a) : "",
        arrow_count: a.geometry.type === "point" ? 1 : 0,
        outer_cell_json: JSON.stringify(a.outer),
        inner_cells_json: JSON.stringify(a.inner),
        nearest_spot_id: n?.spot.id || "",
        nearest_spot_distance_px: n?.distance ?? "",
        cell_gene_assignment: "NOT_ASSIGNED",
        ...Object.fromEntries(
          manifest.metrics.map((m) => [
            "nearest_spot_" + m.key,
            n?.spot.values[m.key] ?? "",
          ]),
        ),
        created_at: a.createdAt,
        updated_at: a.updatedAt,
      };
    });
    download(
      new Blob([toCSV(rows, cols)], { type: "text/csv;charset=utf-8" }),
      "CIC_annotations_" + now().slice(0, 10) + ".csv",
    );
    toast("已导出全部切片 CSV；最近 spot 为背景信息");
  } catch (e) {
    toast("CSV 导出失败：" + e.message);
  }
}
function exportGeoJSON() {
  const features = [];
  for (const a of project.annotations) {
    const s = project.sections.find((s) => s.id === a.section),
      props = {
        object_id: a.id,
        section: a.section,
        patient: s.patient,
        label: a.label,
        confidence: a.confidence,
        annotator: a.annotator,
        notes: a.notes,
        blinded_to_spatial_scores: !project.exposures[a.section],
        source_sha256: s.sha256,
        source_width: s.width,
        source_height: s.height,
        classification: { name: LABELS[a.label] },
      };
    features.push({
      type: "Feature",
      geometry: geometryToGeoJSON(a.geometry),
      properties: { ...props, role: "structure", marker_color: a.geometry.type === "point" ? arrowColor(a) : null, arrow_count: a.geometry.type === "point" ? 1 : 0 },
    });
    if (a.outer)
      features.push({
        type: "Feature",
        geometry: geometryToGeoJSON(a.outer),
        properties: { ...props, role: "outer_cell" },
      });
    a.inner.forEach((g, i) =>
      features.push({
        type: "Feature",
        geometry: geometryToGeoJSON(g),
        properties: { ...props, role: "inner_cell", inner_index: i + 1 },
      }),
    );
  }
  download(
    new Blob(
      [
        JSON.stringify(
          {
            type: "FeatureCollection",
            coordinateSystem: manifest.coordinateSystem,
            features,
          },
          null,
          2,
        ),
      ],
      { type: "application/geo+json" },
    ),
    "CIC_pixel_annotations.geojson",
  );
  toast("GeoJSON 已导出；包含 section 字段，请按切片使用");
}
document
  .querySelectorAll("[data-tool]")
  .forEach(
    (b) =>
      (b.onclick = () =>
        setTool(
          b.dataset.tool,
          drawRole !== "new" && ["ellipse", "polygon"].includes(b.dataset.tool),
        )),
  );
$("#undo").onclick = () => undo();
document.querySelectorAll("[data-marker-color]").forEach((b) =>
  b.onclick = () => chooseArrowColor(b.dataset.markerColor));
$("#delete-selected").onclick = deleteSelected;
$("#focus-section").onchange = (e) => loadSection(e.target.value);
$("#focus-overlay").onclick = () => {
  $("#overlay-toggle").checked = !overlay();
  renderSpatial();
};
$("#focus-view").onclick = async () => {
  if (document.fullscreenElement) {
    focusBeforeFullscreen = false;
    await document.exitFullscreen();
  } else setFocusView(!document.body.classList.contains("focus-view"));
};
$("#fullscreen").onclick = toggleFullscreen;
document.addEventListener("fullscreenchange", () => {
  const full = !!document.fullscreenElement;
  $("#fullscreen").textContent = full ? "⛶ 退出全屏" : "⛶ 全屏";
  if (!full) setFocusView(focusBeforeFullscreen);
});
$("#redo").onclick = () => undo(true);
$("#fit").onclick = fit;
$("#native").onclick = () =>
  jump(
    ...screenToImage([stage.clientWidth / 2, stage.clientHeight / 2], view),
    1,
  );
$("#zoom-label").onclick = () => $("#native").click();
$("#zoom-in").onclick = () => zoom(1.4);
$("#zoom-out").onclick = () => zoom(1 / 1.4);
$("#toggle-marks").onclick = () => {
  showMarks = !showMarks;
  $("#toggle-marks").textContent = showMarks ? "隐藏标注" : "显示标注";
  draw();
};
$("#overlay-toggle").onchange = renderSpatial;
$("#metric").onchange = () => {
  rankIndex = -1;
  renderSpatial();
};
$("#opacity").oninput = requestDraw;
$("#rank-order").onchange = () => {
  rankIndex = -1;
  renderSpatial();
};
$("#pathology-filter").onchange = () => {
  rankIndex = -1;
  renderSpatial();
};
$("#next-spot").onclick = () => {
  const ss = sortedSpots();
  if (ss.length) jumpSpot(ss[(rankIndex + 1) % ss.length].id);
};
$("#annotation-filter").onchange = renderPanels;
$("#annotator").oninput = () => {
  if (multiTabConflict) return;
  project.annotator = $("#annotator").value.trim();
  if (current()) {
    current().annotator = project.annotator;
    current().updatedAt = now();
  }
  save();
};
$("#help-button").onclick = () => $("#help-dialog").showModal();
$("#export-button").onclick = () => $("#export-dialog").showModal();
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
$("#export-json").onclick = () => {
  download(
    new Blob([JSON.stringify(exportProject(), null, 2)], {
      type: "application/json",
    }),
    "CIC_Atlas_" + now().slice(0, 10) + ".json",
  );
  toast("完整标注项目已导出");
};
$("#export-csv").onclick = exportCSV;
$("#export-geojson").onclick = exportGeoJSON;
$("#import-button").onclick = () => $("#import-file").click();
$("#import-file").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    if (multiTabConflict)
      throw new Error("其他窗口已更新，请先导出当前窗口并刷新");
    if (f.size > 25000000) throw new Error("项目文件超过 25 MB");
    const incoming = validateProject(
        JSON.parse(await f.text()),
        project.sections,
      ),
      merged = mergeProjects(exportProject(), incoming);
    project = merged;
    undoStack = [];
    redoStack = [];
    save();
    await loadSection(project.activeSection || "H1");
    toast("已合并项目，现有记录保留；本地图片需在此浏览器打开");
  } catch (e) {
    toast("导入失败：" + e.message);
  } finally {
    $("#import-file").value = "";
  }
};
$("#local-image-button").onclick = () => $("#image-file").click();
$("#image-file").onchange = async (e) => {
  let last = null;
  for (const f of e.target.files) {
    try {
      if (multiTabConflict) throw new Error("其他窗口已更新，请刷新");
      if (f.size > 100000000) throw new Error("单张图片最大 100 MB");
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", await f.arrayBuffer()),
        ),
      ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      const known = project.sections.find((s) => s.sha256 === hash);
      if (known) {
        if (known.id.startsWith("local_")) await imageStore("put", hash, f);
        last = known.id;
        continue;
      }
      const url = URL.createObjectURL(f);
      let im;
      try {
        im = new Image();
        im.src = url;
        await im.decode();
      } finally {
        URL.revokeObjectURL(url);
      }
      if (im.naturalWidth * im.naturalHeight > 160000000 || !im.naturalWidth)
        throw new Error("图片超过 1.6 亿像素或无法解码");
      await imageStore("put", hash, f);
      const s = {
        id: "local_" + hash.slice(0, 16),
        name: f.name,
        width: im.naturalWidth,
        height: im.naturalHeight,
        sha256: hash,
        patient: "",
        spotCount: 0,
      };
      project.sections.push(s);
      last = s.id;
      save();
    } catch (err) {
      toast(f.name + "：" + err.message);
    }
  }
  if (last) await loadSection(last);
  $("#image-file").value = "";
};
$("#snapshot").onclick = () => {
  if (!ready) return;
  canvas.toBlob((blob) => {
    if (blob) {
      download(blob, section.id + "_viewport.png");
      const topLeft = screenToImage([0, 0], view);
      download(
        new Blob(
          [
            JSON.stringify(
              {
                section: section.id,
                source_sha256: section.sha256,
                viewport: {
                  x: topLeft[0],
                  y: topLeft[1],
                  width: stage.clientWidth / view.scale,
                  height: stage.clientHeight / view.scale,
                },
                pixel_scale: view.scale,
                device_pixel_ratio: devicePixelRatio,
                expression_overlay: overlay(),
                metric: overlay() ? metric() : null,
                display_only: true,
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
        section.id + "_viewport_coordinates.json",
      );
      toast("视野及坐标说明已导出；不是原图分辨率裁剪");
    }
  });
};
document.addEventListener("keydown", (e) => {
  if (
    e.target.matches("input,textarea,select") ||
    document.querySelector("dialog[open]")
  )
    return;
  if (e.code === "Space") {
    space = true;
    e.preventDefault();
    canvas.style.cursor = "grab";
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo(e.shiftKey);
    return;
  }
  if (e.key === "Escape") {
    if (!draft && !drag && !document.fullscreenElement) setFocusView(false);
    draft = null;
    drag = null;
    setTool("pan");
    return;
  }
  if (!ready) return;
  if (e.key === "Enter" && draft?.type === "polygon") {
    e.preventDefault();
    addGeometry(draft);
    return;
  }
  const key = e.key.toLowerCase(),
    next = { v: "pan", p: "point", e: "ellipse", g: "polygon" }[key];
  if (next)
    setTool(next, drawRole !== "new" && ["ellipse", "polygon"].includes(next));
  if (key === "f") fit();
  if (key === "r" || key === "b") chooseArrowColor(key === "r" ? "red" : "blue");
  if (e.key === "Tab" && e.target === stage && !e.shiftKey) {
    e.preventDefault();
    $("#focus-view").click();
  }
  if (key === "h") $("#toggle-marks").click();
  if (key === "?") $("#help-dialog").showModal();
  if (["1", "2", "3"].includes(key) && current())
    update({ label: Object.keys(LABELS)[Number(key) - 1] });
  if (e.key === "Delete" && current()) deleteSelected();
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    space = false;
    canvas.style.cursor = tool === "pan" ? "grab" : "crosshair";
  }
});
window.addEventListener("blur", () => {
  space = false;
  drag = null;
});
window.addEventListener("storage", (e) => {
  if (e.key === storageKey && e.newValue) {
    multiTabConflict = true;
    $("#save-status").textContent = "其他窗口已更新，请导出后刷新";
    $("#save-status").classList.add("red");
    toast("另一窗口修改了标注。此窗口已暂停写入，请导出备份后刷新。");
  }
});
window.addEventListener("beforeunload", (e) => {
  if (storageBlocked || multiTabConflict) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function registerTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
  const definitions = [
    {
      name: "read_cic_project",
      description:
        "Read counts and current section from the CIC workspace. Does not expose hidden expression values.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({
        section: section.id,
        annotations: project.annotations.length,
        arrows: arrowCounts(annotations()),
        labels: Object.fromEntries(
          Object.keys(LABELS).map((l) => [
            l,
            annotations().filter((a) => a.label === l).length,
          ]),
        ),
        expressionExposed: !!project.exposures[section.id],
      }),
    },
    {
      name: "navigate_cic_section",
      description:
        "Open one of the five HER2ST sections without showing expression values.",
      inputSchema: {
        type: "object",
        properties: {
          section: { type: "string", enum: manifest.sections.map((s) => s.id) },
        },
        required: ["section"],
        additionalProperties: false,
      },
      execute: async (input) => {
        if (!manifest.sections.some((s) => s.id === input?.section))
          throw new Error("Invalid section");
        await loadSection(input.section);
        if (!ready) throw new Error("Image failed to load");
        return { section: section.id, ready };
      },
    },
  ];
  for (const tool of definitions) {
    try {
      await context.registerTool(tool, { signal: lifecycle.signal });
    } catch (e) {
      console.warn("Optional WebMCP registration unavailable", e.message);
    }
  }
}
async function start() {
  manifest = await json("data/manifest.json");
  $("#metric").innerHTML = manifest.metrics
    .map((m) => `<option value="${m.key}">${esc(m.label)}</option>`)
    .join("");
  const empty = {
    schemaVersion: 1,
    app: "CIC Atlas",
    annotations: [],
    sections: manifest.sections.map(
      ({ id, patient, width, height, sha256 }) => ({
        id,
        patient,
        width,
        height,
        sha256,
      }),
    ),
    exposures: {},
    reviewed: {},
    annotator: "",
    activeSection: "H1",
  };
  try {
    const raw = localStorage.getItem(storageKey);
    project = raw ? validateProject(JSON.parse(raw), manifest.sections) : empty;
  } catch (e) {
    storageBlocked = true;
    throw new Error(
      "本机项目无法读取。为避免覆盖，已暂停。请保留浏览器数据，用导出的 JSON 在另一浏览器继续。 " +
        e.message,
    );
  }
  $("#annotator").value = project.annotator || "";
  new ResizeObserver(resize).observe(stage);
  resize();
  await loadSection(project.activeSection || "H1");
  setTool("pan");
  registerTools();
}
start().catch((e) => {
  $("#loading").hidden = false;
  $("#loading").textContent = e.message;
  console.error(e);
});

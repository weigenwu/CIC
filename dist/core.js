export const LABELS = {
  definite_CIC: "确认 CIC",
  probable_CIC: "疑似 CIC",
  not_CIC: "排除",
};
export const COLORS = {
  definite_CIC: "#36b082",
  probable_CIC: "#e7a734",
  not_CIC: "#a4aab4",
};
export const ARROW_COLORS = { red: "#e03535", blue: "#1875e5" };
// A point stores the arrow tip in source pixels; its display size is independent of zoom.
export const arrowColor = (a) => a.markerColor || "red";
export function arrowCounts(annotations) {
  const counts = { red: 0, blue: 0, total: 0 };
  for (const a of annotations) {
    if (a.geometry.type !== "point") continue;
    counts[arrowColor(a)]++;
    counts.total++;
  }
  return counts;
}
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const screenToImage = (p, v) => [
  (p[0] - v.x) / v.scale,
  (p[1] - v.y) / v.scale,
];
export const imageToScreen = (p, v) => [
  p[0] * v.scale + v.x,
  p[1] * v.scale + v.y,
];
export function bounds(g) {
  if (g.type === "point") return { x: g.x, y: g.y, width: 0, height: 0 };
  if (g.type === "ellipse")
    return { x: g.x - g.rx, y: g.y - g.ry, width: g.rx * 2, height: g.ry * 2 };
  const xs = g.points.map((p) => p[0]),
    ys = g.points.map((p) => p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
export const center = (g) => {
  const b = bounds(g);
  return [b.x + b.width / 2, b.y + b.height / 2];
};
export function nearestSpot(g, spots) {
  const [x, y] = center(g);
  let best = null;
  for (const s of spots) {
    const d = Math.hypot(x - s.x, y - s.y);
    if (!best || d < best.distance) best = { spot: s, distance: d };
  }
  return best;
}
export function geometryToGeoJSON(g) {
  if (g.type === "point") return { type: "Point", coordinates: [g.x, g.y] };
  const ps =
    g.type === "polygon"
      ? g.points
      : Array.from({ length: 64 }, (_, i) => [
          g.x + g.rx * Math.cos((i * Math.PI) / 32),
          g.y + g.ry * Math.sin((i * Math.PI) / 32),
        ]);
  return { type: "Polygon", coordinates: [[...ps, ps[0]]] };
}
export function validGeometry(g, s) {
  if (!g || !["point", "ellipse", "polygon"].includes(g.type)) return false;
  const f = (n) => typeof n === "number" && Number.isFinite(n);
  if (g.type === "polygon") {
    if (
      !Array.isArray(g.points) ||
      g.points.length < 3 ||
      g.points.length > 10000 ||
      !g.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(f))
    )
      return false;
    const area =
      Math.abs(
        g.points.reduce((a, p, i) => {
          const q = g.points[(i + 1) % g.points.length];
          return a + p[0] * q[1] - q[0] * p[1];
        }, 0),
      ) / 2;
    if (area < 1) return false;
  } else if (
    !f(g.x) ||
    !f(g.y) ||
    (g.type === "ellipse" && (!f(g.rx) || !f(g.ry) || g.rx <= 0 || g.ry <= 0))
  )
    return false;
  const b = bounds(g);
  return (
    b.x >= 0 &&
    b.y >= 0 &&
    b.x + b.width <= s.width + 0.001 &&
    b.y + b.height <= s.height + 0.001
  );
}
export function csvCell(value) {
  let v = value == null ? "" : String(value);
  // Protect spreadsheet users from formula injection in free-text fields.
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(v)) v = "'" + v;
  return '"' + v.replaceAll('"', '""') + '"';
}
export function toCSV(rows, columns) {
  return (
    "\ufeff" +
    [
      columns.map(csvCell).join(","),
      ...rows.map((r) => columns.map((k) => csvCell(r[k])).join(",")),
    ].join("\r\n")
  );
}
export function validateProject(data, knownSections) {
  const fail = (message) => {
    throw new Error(message);
  };
  if (
    !data ||
    data.schemaVersion !== 1 ||
    data.app !== "CIC Atlas" ||
    !Array.isArray(data.annotations) ||
    !Array.isArray(data.sections)
  )
    fail("不是受支持的 CIC Atlas 项目");
  if (data.annotations.length > 50000 || data.sections.length > 200)
    fail("项目超过支持的大小");
  const sections = new Map(knownSections.map((s) => [s.id, s])),
    ids = new Set();
  for (const s of data.sections) {
    if (
      !s ||
      typeof s.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(s.id) ||
      ids.has(s.id) ||
      !Number.isInteger(s.width) ||
      !Number.isInteger(s.height) ||
      s.width < 1 ||
      s.height < 1 ||
      s.width * s.height > 160000000 ||
      typeof s.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(s.sha256)
    )
      fail("切片元数据无效");
    ids.add(s.id);
    const known = sections.get(s.id);
    if (
      known &&
      (known.width !== s.width ||
        known.height !== s.height ||
        known.sha256 !== s.sha256)
    )
      fail(`${s.id} 原图尺寸或校验和不匹配`);
    if (!known && !s.id.startsWith("local_")) fail("未知的内置切片");
    sections.set(s.id, s);
  }
  if (data.activeSection !== undefined && !ids.has(data.activeSection))
    fail("当前切片不存在");
  if (
    data.annotator !== undefined &&
    (typeof data.annotator !== "string" || data.annotator.length > 100)
  )
    fail("标注者字段无效");
  const seen = new Set();
  for (const a of data.annotations) {
    if (
      !a ||
      typeof a.id !== "string" ||
      !a.id ||
      a.id.length > 120 ||
      seen.has(a.id)
    )
      fail("标注编号重复或无效");
    seen.add(a.id);
    if (a.markerColor !== undefined && !Object.hasOwn(ARROW_COLORS, a.markerColor))
      fail("箭头颜色无效");
    const s = sections.get(a.section);
    if (
      !s ||
      !ids.has(a.section) ||
      !Object.hasOwn(LABELS, a.label) ||
      !validGeometry(a.geometry, s) ||
      !Array.isArray(a.inner) ||
      a.inner.length > 100 ||
      !a.inner.every((g) => validGeometry(g, s)) ||
      (a.outer && !validGeometry(a.outer, s))
    )
      fail("标注标签、坐标或轮廓无效");
    if (
      !["low", "medium", "high"].includes(a.confidence) ||
      !Number.isInteger(a.innerCount) ||
      a.innerCount < 0 ||
      a.innerCount > 100
    )
      fail("标注属性无效");
    if (
      typeof a.notes !== "string" ||
      a.notes.length > 10000 ||
      typeof a.annotator !== "string" ||
      a.annotator.length > 100 ||
      typeof a.createdBlinded !== "boolean" ||
      typeof a.createdAt !== "string" ||
      typeof a.updatedAt !== "string"
    )
      fail("标注记录缺少必要字段");
  }
  if (
    !data.exposures ||
    Array.isArray(data.exposures) ||
    typeof data.exposures !== "object"
  )
    fail("缺少表达阅片记录");
  for (const [id, e] of Object.entries(data.exposures))
    if (
      !sections.has(id) ||
      !e ||
      typeof e.firstSeen !== "string" ||
      !Array.isArray(e.metrics) ||
      !e.metrics.every((m) => typeof m === "string" && m.length < 100)
    )
      fail("表达阅片记录无效");
  if (
    !data.reviewed ||
    Array.isArray(data.reviewed) ||
    typeof data.reviewed !== "object"
  )
    fail("缺少已阅视野记录");
  for (const [id, rs] of Object.entries(data.reviewed)) {
    if (
      !sections.has(id) ||
      !Array.isArray(rs) ||
      rs.length > 10000 ||
      !rs.every(
        (r) =>
          r &&
          typeof r.id === "string" &&
          Number.isFinite(r.x) &&
          Number.isFinite(r.y) &&
          r.x >= 0 &&
          r.y >= 0 &&
          Number.isFinite(r.width) &&
          Number.isFinite(r.height) &&
          r.width > 0 &&
          r.height > 0 &&
          r.x + r.width <= sections.get(id).width + 0.001 &&
          r.y + r.height <= sections.get(id).height + 0.001,
      )
    )
      fail("已阅视野坐标无效");
  }
  // Imported metadata may not add resource URLs; local images must come from the user's file picker.
  data.sections = data.sections.map(
    ({ id, patient, width, height, sha256, name }) => ({
      id,
      patient: typeof patient === "string" ? patient.slice(0, 100) : "",
      width,
      height,
      sha256,
      ...(typeof name === "string" ? { name: name.slice(0, 255) } : {}),
    }),
  );
  return data;
}
export function mergeProjects(current, incoming) {
  const out = structuredClone(current),
    map = new Map(out.annotations.map((a) => [a.id, a]));
  for (const a of incoming.annotations) {
    if (map.has(a.id) && JSON.stringify(map.get(a.id)) !== JSON.stringify(a))
      throw new Error(
        "同编号标注存在不同版本，请在另一浏览器打开备份，避免覆盖当前记录",
      );
    if (!map.has(a.id)) {
      out.annotations.push(a);
      map.set(a.id, a);
    }
  }
  for (const s of incoming.sections)
    if (!out.sections.some((x) => x.id === s.id)) out.sections.push(s);
  for (const [s, e] of Object.entries(incoming.exposures)) {
    const old = out.exposures[s];
    out.exposures[s] = {
      firstSeen:
        old && old.firstSeen < e.firstSeen ? old.firstSeen : e.firstSeen,
      metrics: [...new Set([...(old?.metrics || []), ...e.metrics])],
    };
  }
  for (const [s, rs] of Object.entries(incoming.reviewed))
    out.reviewed[s] = [
      ...new Map(
        [...(out.reviewed[s] || []), ...rs].map((r) => [r.id, r]),
      ).values(),
    ];
  return out;
}

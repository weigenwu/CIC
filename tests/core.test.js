import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  screenToImage,
  imageToScreen,
  nearestSpot,
  geometryToGeoJSON,
  validGeometry,
  validateProject,
  mergeProjects,
  toCSV,
  arrowCounts,
  arrowColor,
  arrowTail,
  arrowHit,
  editArrow,
  pixelRuler,
} from "../dist/core.js";
const manifest = JSON.parse(
  fs.readFileSync(new URL("../dist/data/manifest.json", import.meta.url)),
);
const sections = manifest.sections.map(
  ({ id, patient, width, height, sha256 }) => ({
    id,
    patient,
    width,
    height,
    sha256,
  }),
);
const make = () => ({
  schemaVersion: 1,
  app: "CIC Atlas",
  sections,
  annotations: [
    {
      id: "D6_test",
      section: "D6",
      label: "probable_CIC",
      confidence: "medium",
      geometry: { type: "point", x: 2604, y: 7322 },
      outer: null,
      inner: [],
      innerCount: 1,
      notes: "测试",
      annotator: "QA",
      createdAt: "2026-09-16",
      updatedAt: "2026-09-16",
      createdBlinded: true,
    },
  ],
  exposures: {},
  reviewed: {},
});
test("editable arrows preserve target, endpoints, counts and reject malformed tails", () => {
  const p = make(), g = {type: "point", x: 2604, y: 7322, tail: [2544, 7242]};
  p.annotations[0].geometry = g;
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p)), sections), p);
  assert.deepEqual(geometryToGeoJSON(g), {type: "Point", coordinates: [2604, 7322]});
  assert.deepEqual(arrowCounts(p.annotations), {red: 1, blue: 0, total: 1});
  for (const scale of [0.25, 1, 4]) {
    const view = {x: -14, y: 93, scale};
    const pointer = screenToImage(imageToScreen([2574, 7282], view), view);
    assert.equal(arrowHit(g, pointer, scale), "move");
    assert.equal(arrowHit(g, [2604, 7322], scale, true), "tip");
    assert.equal(arrowHit(g, g.tail, scale, true), "tail");
    assert.equal(arrowHit(g, [2800, 7100], scale), null);
    assert.deepEqual(arrowTail(g, scale), g.tail);
  }
  const s = sections.find((s) => s.id === "D6");
  const moved = editArrow(g, [2574, 7282], [2674, 7242], "move", s);
  assert.deepEqual(moved, {type: "point", x: 2704, y: 7282, tail: [2644, 7202]});
  assert.deepEqual(editArrow(g, [0, 0], [-99999, -99999], "move", s), {type: "point", x: 60, y: 80, tail: [0, 0]});
  assert.deepEqual(editArrow(g, [0, 0], [99999, 99999], "move", s), {type: "point", x: s.width, y: s.height, tail: [s.width - 60, s.height - 80]});
  assert.deepEqual(editArrow(g, g.tail, [2500, 7200], "tail", s), {...g, tail: [2500, 7200]});
  assert.deepEqual(editArrow(g, [g.x, g.y], [2700, 7300], "tip", s), {...g, x: 2700, y: 7300});
  assert.deepEqual(g.tail, [2544, 7242]);
  assert.deepEqual(arrowTail({type: "point", x: 100, y: 100}, 2), [85, 85]);
  for (const tail of [null, [1], [1, 2, 3], ["2", 3], [NaN, 3], [-1, 3], [s.width + 1, 3], [1, s.height + 1], [g.x, g.y]]) {
    p.annotations[0].geometry = {...g, tail};
    assert.throws(() => validateProject(p, sections));
  }
});
test("pixel ruler remains legible at every viewer zoom and labels original pixels", () => {
  for (const scale of [0.001, 0.02, 0.067, 0.25, 0.5, 1, 2, 4, 12]) {
    const ruler = pixelRuler(scale);
    assert.ok(ruler.width >= 39.9 && ruler.width <= 100.001);
    assert.ok(Math.abs(ruler.width / scale - ruler.pixels) < 1e-9);
  }
  assert.deepEqual(pixelRuler(1), {pixels: 100, width: 100});
  assert.deepEqual(pixelRuler(4), {pixels: 20, width: 80});
});
test("original-image coordinates survive pan and zoom", () => {
  for (const scale of [0.02, 0.137, 1, 2.75, 12]) {
    const p = [5724, 3188],
      view = { scale, x: -403.5, y: 57.2 };
    const q = screenToImage(imageToScreen(p, view), view);
    assert.ok(Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9);
  }
});
test("known morphology bookmarks map to the audited nearest centers", () => {
  for (const [id, x, y, spot, dist] of [
    ["D6", 2604, 7322, "10x26", 58.6],
    ["F1", 5724, 3188, "21x12", 76.9],
  ]) {
    const spots = JSON.parse(
      fs.readFileSync(
        new URL(`../dist/data/${id}_spots.json`, import.meta.url),
      ),
    );
    const n = nearestSpot({ type: "point", x, y }, spots);
    assert.equal(n.spot.id, spot);
    assert.ok(Math.abs(n.distance - dist) < 0.1);
  }
});
test("all five originals match recorded SHA256; 2647 spots with valid coordinates", () => {
  let count = 0;
  for (const s of manifest.sections) {
    const content = fs.readFileSync(
      new URL("../dist/" + s.image, import.meta.url),
    );
    assert.equal(
      crypto.createHash("sha256").update(content).digest("hex"),
      s.sha256,
    );
    const spots = JSON.parse(
      fs.readFileSync(new URL("../dist/" + s.spots, import.meta.url)),
    );
    assert.equal(spots.length, s.spotCount);
    assert.equal(new Set(spots.map((s) => s.id)).size, spots.length);
    for (const p of spots) {
      assert.ok(p.x >= 0 && p.y >= 0 && p.x <= s.width && p.y <= s.height);
      for (const m of manifest.metrics)
        assert.ok(p.values[m.key] === null || Number.isFinite(p.values[m.key]));
    }
    count += spots.length;
  }
  assert.equal(count, 2647);
});
test("invalid coordinates, unknown labels, malformed imports and mismatched images fail", () => {
  const s = sections[0];
  assert.equal(
    validGeometry({ type: "ellipse", x: 2, y: 2, rx: 20, ry: 20 }, s),
    false,
  );
  assert.equal(
    validGeometry(
      {
        type: "polygon",
        points: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      },
      s,
    ),
    false,
  );
  assert.equal(validGeometry({ type: "point", x: NaN, y: 2 }, s), false);
  for (const change of [
    (p) => (p.annotations[0].label = "confirmed"),
    (p) => (p.annotations[0].geometry.x = -1),
    (p) => p.sections[0].width++,
    (p) => p.annotations.push(p.annotations[0]),
    (p) => delete p.exposures,
  ]) {
    const p = structuredClone(make());
    change(p);
    assert.throws(() => validateProject(p, sections));
  }
  assert.equal(validateProject(make(), sections).annotations.length, 1);
});
test("roundtrip preserves inner and outer geometry; GeoJSON rings are closed", () => {
  const p = make(),
    g = { type: "ellipse", x: 2604, y: 7322, rx: 50, ry: 30 };
  p.annotations[0].outer = g;
  p.annotations[0].inner = [
    {
      type: "polygon",
      points: [
        [2600, 7310],
        [2610, 7310],
        [2605, 7320],
      ],
    },
  ];
  const copy = validateProject(JSON.parse(JSON.stringify(p)), sections);
  assert.deepEqual(copy, p);
  const geo = geometryToGeoJSON(g);
  assert.deepEqual(geo.coordinates[0][0], geo.coordinates[0].at(-1));
  assert.equal(geo.coordinates[0].length, 65);
});
test("merge retains expression exposure and rejects conflicting edits atomically", () => {
  const a = make(),
    b = make();
  b.exposures.D6 = { firstSeen: "2026-09-16", metrics: ["PIEZO1_logCPM"] };
  const merged = mergeProjects(a, b);
  assert.equal(merged.annotations.length, 1);
  assert.deepEqual(merged.exposures.D6, b.exposures.D6);
  assert.deepEqual(a.exposures, {});
  b.annotations[0].notes = "changed";
  assert.throws(() => mergeProjects(a, b));
  assert.equal(a.annotations[0].notes, "测试");
});
test("CSV preserves Unicode, newlines and quotes; neutralizes formula text", () => {
  const s = toCSV(
    [{ notes: "=SUM(1,2)", n: -1, other: '中文,"quoted"\nnew' }],
    ["notes", "n", "other"],
  );
  assert.ok(s.startsWith("\ufeff"));
  assert.ok(s.includes('"\'=SUM(1,2)"'));
  assert.ok(s.includes('"-1"'));
  assert.ok(s.includes('中文,""quoted""\nnew'));
});

test("one arrow counts once, colors survive import and merge, legacy points keep their tip", () => {
  const p = make(), original = structuredClone(p.annotations[0]);
  p.annotations[0].innerCount = 4;
  p.annotations[0].inner = [{type: "point", x: 2604, y: 7322}];
  p.annotations.push({...original, id: "blue", markerColor: "blue", label: "definite_CIC"});
  p.annotations.push({...original, id: "outline", geometry: {type: "ellipse", x: 2604, y: 7322, rx: 40, ry: 40}});
  const copy = validateProject(JSON.parse(JSON.stringify(p)), sections);
  assert.equal(arrowColor(copy.annotations[0]), "red");
  assert.deepEqual(arrowCounts(copy.annotations), {red: 1, blue: 1, total: 2});
  assert.deepEqual(geometryToGeoJSON(copy.annotations[0].geometry), {type: "Point", coordinates: [2604, 7322]});
  assert.deepEqual(arrowCounts(mergeProjects(copy, copy).annotations), {red: 1, blue: 1, total: 2});
  copy.annotations[1].markerColor = "red";
  assert.deepEqual(arrowCounts(copy.annotations), {red: 2, blue: 0, total: 2});
  copy.annotations.splice(0, 1);
  assert.deepEqual(arrowCounts(copy.annotations), {red: 1, blue: 0, total: 1});
  copy.annotations[0].markerColor = "purple";
  assert.throws(() => validateProject(copy, sections), /箭头颜色无效/);
});

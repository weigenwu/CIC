# Validation

## Data and automated checks

- Five original JPEGs copied byte-for-byte and verified against previous SHA256 manifests.
- 2,647 spots, no duplicated spot IDs within section; all pixel coordinates inside original canvas.
- PIEZO1 and base-table x/y matched to < 1e-6 px during dataset preparation.
- D6_A01 nearest center: 10x26, approximately 58.6 px. F1_A01: 21x12, approximately 76.9 px. Both remain bookmarks, not annotations.
- `npm test`: ten tests passed, covering coordinate transforms, data provenance, nearest centers, import validation, geometry roundtrip, conservative merge/conflicts, CSV protection, editable arrow endpoints/count compatibility and the pixel ruler.
- `npm run check`: JavaScript syntax passed.

## Browser checks

- H1 whole-section rendering and D6 spatial navigation checked in the browser.
- PIEZO1 overlay, high-to-low navigation, point annotation, confirmed status, outer ellipse and inner polygon checked through UI.
- Reload retained annotation, classification, outer/inner geometry and expression exposure; expression overlay returns to hidden.
- JSON fixture import succeeded; invalid JSON project was rejected while preserving the annotation count.
- Notes and annotator persisted after reload. Undo and redo of classification worked.
- JSON, CSV and GeoJSON generated nonempty downloadable blobs with visible retry links and no browser console errors. The in-app browser did not emit a download event, so final OS file-save completion was not verified there.
- Test labels live in a separate `?qa=1` browser storage namespace and are not research annotations or included in the repository.
- WebMCP read and section navigation registered and returned current visible state; invalid section rejected without changing the section.

## Arrow and viewing update (2026-09-19)

- Browser UI: red and blue arrows each add one; recolor moves the count between groups. Delete, undo and redo update counts; reload preserves both colors and coordinates. H1 and D6 keep separate totals.
- Focus mode uses the full 1280 x 720 page canvas; native fullscreen entered successfully at 1707 x 1067. Exiting restores side panels; magnification stays at 100% through layout changes.
- Floating controls switch sections and toggle the expression layer while fullscreen. No browser console errors observed. QA marks use `?qa=1` only.
- Point coordinates and GeoJSON Point remain the arrow tip; inner cells and added outlines do not multiply arrow counts. Legacy points default to red without rewriting coordinates or classification.

## Viewer navigation update (2026-09-20)

- Referenced QuPath's official viewing documentation. The app retains its own annotation data and color shortcuts.
- Browser: one dock switches library, annotation and spatial panels; closing it expands the same canvas. At a 1253 x 912 viewport the canvas measured 993 x 769 with the dock and 1253 x 769 without it.
- Checked overview dragging, 200% preset, Shift+Up to 280%, native-pixel view and direction-key navigation. At 100%, Right moved the sampled center from x=4642.5 to 4841.1, matching 20% of the 993-pixel canvas width; y was unchanged.
- Focus-mode center samples agreed within 0.5 source pixel at 100% (pointer rounding). Native fullscreen, section switching and opening the dock inside fullscreen all returned with the correct counts and panel state.
- Spatial toggle works in its tab and toolbar. Test arrows were undone; no research annotations were created. No browser console errors observed.

## Editable arrows (2026-09-21)

- Browser at 100%: a click did not add a mark; dragging from tail to target added one red arrow. Dragging its shaft moved both endpoints; dragging each selected endpoint changed the direction and length while retaining one object/count. A blue arrow brought the total to two.
- Reload retained the edited arrows. Subsequent movement changed the target from (4583, 4964) to (4603, 4984); undo restored (4583, 4964), redo restored (4603, 4984). Counts remained red 1 / blue 1.
- Visually checked thin open arrowheads and small selection handles. The 200% zoom preset and JSON/CSV/GeoJSON export actions worked; each export offered a nonempty save link. OS download completion was not rechecked. No browser console errors were observed; test marks used `?qa=1` only.
- Core tests cover tip/tail hit detection across zoom levels, translation constrained to the image, independent endpoint edits, malformed tail rejection, JSON roundtrip, legacy point fallback and target-based GeoJSON/counts. GeoJSON still uses the tip as a Point and stores the tail in properties; CSV and JSON retain both ends.

## Limits

- Browser-local storage; JSON backups required for transfer/recovery. No central server or automatic GitHub annotation sync.
- Full-resolution JPEG rendering depends on browser/device memory. One original is held at a time. TIFF/whole-slide pyramids are not supported in this version.
- H&E pixels and spot expression cannot establish CIC cell type, entosis mechanism, inner/outer gene assignment or capture footprint.
- GeoJSON uses original image pixels and section properties; external QuPath import has not been tested.

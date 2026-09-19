# Validation

## Data and automated checks

- Five original JPEGs copied byte-for-byte and verified against previous SHA256 manifests.
- 2,647 spots, no duplicated spot IDs within section; all pixel coordinates inside original canvas.
- PIEZO1 and base-table x/y matched to < 1e-6 px during dataset preparation.
- D6_A01 nearest center: 10x26, approximately 58.6 px. F1_A01: 21x12, approximately 76.9 px. Both remain bookmarks, not annotations.
- `npm test`: eight tests passed, covering coordinate transforms, data provenance, nearest centers, import validation, geometry roundtrip, conservative merge/conflicts, CSV protection and arrow color/count compatibility.
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

## Limits

- Browser-local storage; JSON backups required for transfer/recovery. No central server or automatic GitHub annotation sync.
- Full-resolution JPEG rendering depends on browser/device memory. One original is held at a time. TIFF/whole-slide pyramids are not supported in this version.
- H&E pixels and spot expression cannot establish CIC cell type, entosis mechanism, inner/outer gene assignment or capture footprint.
- GeoJSON uses original image pixels and section properties; external QuPath import has not been tested.

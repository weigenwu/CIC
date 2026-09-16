"""Build the five-section browser dataset from existing audited HER2ST results.
Original JPEG files are copied byte-for-byte. Only navigation thumbnails resize.
Run: python scripts/prepare_data.py --workspace <CIC workspace>
"""
import argparse, csv, gzip, hashlib, json, shutil
from pathlib import Path
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument('--workspace', type=Path, default=Path(__file__).resolve().parents[2])
args = p.parse_args()
root = args.workspace.resolve()
out = Path(__file__).resolve().parents[1] / 'dist' / 'data'
out.mkdir(parents=True, exist_ok=True)
proj = root / 'HER2_CIC_reanalysis_v2'
pilot = proj / 'HER2ST_CIC_localization_pilot_20260912'
results = proj / 'results'

def rows(path):
    with (gzip.open(path, 'rt', encoding='utf-8-sig') if path.suffix == '.gz' else path.open(encoding='utf-8-sig')) as f:
        return list(csv.DictReader(f, delimiter='\t'))

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()

def index(path):
    return {(r['section'], r['spot_id']): r for r in rows(path)}

base_path = results / '24_HER2ST_spatial_validation/tables/HER2ST_spot_scores.tsv.gz'
piezo_path = results / '76_HER2ST_PIEZO1_spatial_niche_audit/tables/01_PIEZO1_spot_values.tsv.gz'
niche_path = results / '76_HER2ST_PIEZO1_spatial_niche_audit/tables/13_joint_niche_spot_assignments.tsv.gz'
base, piezo, niches = index(base_path), index(piezo_path), index(niche_path)
provenance = {r['section']: r for r in rows(pilot / 'five_section_review/image_provenance.tsv')}
rois = rows(pilot / 'five_section_review/roi_manifest.tsv')
metrics = [
    ('PIEZO1_logCPM', 'PIEZO1', 'log2(1 + counts/library_size × 10⁶)'),
    ('ERBB2_logCPM', 'ERBB2 / HER2', 'log2(1 + counts/library_size × 10⁶)'),
    ('HER2_AMPLICON_UCell', 'HER2 扩增子活性', 'UCell score'),
    ('CIC_intrinsic_score', 'CIC 相关转录评分', '原分析固定签名分数；不是形态 CIC 数量'),
    ('CDH1_logCPM', 'CDH1', 'log2(1 + counts/library_size × 10⁶)'),
    ('TJP1_logCPM', 'TJP1', 'log2(1 + counts/library_size × 10⁶)'),
    ('CORTICAL_CONTRACTILITY_UCell', '皮质收缩相关程序', 'UCell score'),
    ('JUNCTION_UCell', '细胞连接相关程序', 'UCell score'),
    ('joint_high', 'HER2 高 / CIC 评分高联合区域', '沿用原分析残差分组；1 = 联合高值'),
]
manifest = {'schemaVersion': 1, 'coordinateSystem': 'zero-based original image pixels; x right, y down',
    'source': {'title': 'Spatial deconvolution of HER2-positive Breast cancer delineates tumor-associated cell type interactions',
    'url': 'https://doi.org/10.5281/zenodo.4751624', 'license': 'CC-BY-4.0'},
    'metrics': [{'key': k, 'label': l, 'unit': u} for k,l,u in metrics], 'sections': [],
    'provenance': [{'path': str(f.relative_to(root)).replace('\\','/'), 'sha256': digest(f)} for f in [base_path,piezo_path,niche_path]]}
for section in ['H1','D6','E1','F1','G1']:
    src = root / 'public_data_new/HER2ST_Zenodo4751624/images/images/HE' / (section + '.jpg')
    sha = digest(src)
    assert sha == provenance[section]['source_sha256'], section
    dest = out / (section + '.jpg')
    shutil.copyfile(src, dest)
    assert digest(dest) == sha
    with Image.open(src) as im:
        w,h = im.size
        im.thumbnail((320,320))
        im.save(out / (section + '_thumb.jpg'), quality=85)
    spots = []
    for key,b in base.items():
        if key[0] != section: continue
        q,n = piezo[key], niches[key]
        assert abs(float(b['pixel_x'])-float(q['pixel_x'])) < 1e-6
        assert abs(float(b['pixel_y'])-float(q['pixel_y'])) < 1e-6
        merged = {**b, **q, **n}
        values = {}
        for metric,_,_ in metrics:
            raw = merged[metric]
            values[metric] = None if raw in ('NA','NaN','') else (1 if raw == 'TRUE' else 0 if raw == 'FALSE' else float(raw))
        x,y = float(b['pixel_x']),float(b['pixel_y'])
        assert 0 <= x <= w and 0 <= y <= h
        spots.append({'id': key[1], 'x': x, 'y': y, 'pathology': b['pathology_label'], 'values': values})
    (out / (section + '_spots.json')).write_text(json.dumps(spots,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
    bookmarks = []
    if section == 'D6': bookmarks = [{'id':'D6_A01','x':2604,'y':7322,'note':'原有歧义书签；未确认完整包裹，不纳入 CIC 计数'}]
    if section == 'F1': bookmarks = [{'id':'F1_A01','x':5724,'y':3188,'note':'原有歧义书签；相邻、重叠与双核未排除，不纳入 CIC 计数'}]
    manifest['sections'].append({'id':section,'patient':section[0],'width':w,'height':h,'sha256':sha,
        'image':f'data/{section}.jpg','thumbnail':f'data/{section}_thumb.jpg','spots':f'data/{section}_spots.json',
        'spotCount':len(spots),'bookmarks':bookmarks,
        'rois':[{'id':r['roi_id'],'x':int(r['x0']),'y':int(r['y0']),'width':int(r['width']),'height':int(r['height'])} for r in rois if r['section']==section]})
(out / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({s['id']:s['spotCount'] for s in manifest['sections']}))

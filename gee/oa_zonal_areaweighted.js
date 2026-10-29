// =============================================================================
// 투고 논문 3.3~3.5절: 북구 집계구별 물리 변수 재산출 (면적 가중 구역통계)
// -----------------------------------------------------------------------------
// [문제] QGIS 구역통계는 화소 "중심점"이 집계구 안에 있는 화소만 사용 → 100m 화소 중심을
//        하나도 품지 못한 소면적 집계구 160개가 값 없이 누락됨
// [수정] 집계구 폴리곤 위에서 10m 단위로 계산 → 화소가 집계구와 겹치는 면적만큼 가중 평균
//        → 작은 집계구도 값이 생김 (단, 지표면온도 산출물 고정 공백에 완전히 들어간 집계구는 제외)
// [변수] 모두 기존 정의와 동일하게 산출
//   LST25_abs : 2025 하절기(5/1~9/30) Landsat 8 평균 지표면온도(℃)          → Abs_mean
//   RLST20/25 : 각 연도 지표면온도 − 북구 평균 지표면온도, dRLST = 25 − 20   → dRL_mean
//   NDBI20/25 : 반사율 변환 후 NDBI(장면별 산출 후 평균), dNDBI = 25 − 20    → dNB_mean
//   SAVI25_max: Sentinel-2 5~10월 최댓값 합성(구름 30% 미만, 반사율)          → SAVI
//   SAVI25_mean: 5~9월 평균 합성(구름 20% 미만) — 기존 값과 대조하여 맞는 쪽을 쓰기 위한 비교용
//   DEM       : SRTM 평균 고도(m)
//   valid20/25: 집계구 면적 중 지표면온도 값이 있는 비율(0~1)
// [추가] 집계구 Queen 인접 목록(공간가중행렬용)도 함께 내보냄
// =============================================================================

// ---- 1. 입력: 집계구 경계 자산 경로와 집계구 코드 필드명을 확인하세요 ----------
var OA_ASSET = 'projects/lateral-plane-500605-i8/assets/bnd_oa_24040_2025_2Q';   // ← 올린 자산 경로로 바꾸기
var OA_FIELD = 'TOT_OA_CD';                                                      // ← 집계구 코드 필드명
var FOLDER   = 'GEE_OA_zonal';

var oa = ee.FeatureCollection(OA_ASSET);
var korea_emd = ee.FeatureCollection('projects/lateral-plane-500605-i8/assets/emdyy');
var bukguGeom = korea_emd.filter(ee.Filter.stringStartsWith('EMD_CD', '29170'))
                         .union(ee.ErrorMargin(1)).geometry();   // 북구 평균 LST(RLST 기준값) 산출용, 기존과 동일
var region = oa.geometry().bounds().buffer(500);
print('집계구 수', oa.size());

// ---- 2. Landsat 8: LST, NDBI (기존과 같은 기간·마스크·평균 합성) ---------------
function prepL8(img) {
  var qa = img.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0));
  var lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST');
  var sr = img.select(['SR_B5', 'SR_B6']).multiply(0.0000275).add(-0.2);
  var ndbi = sr.normalizedDifference(['SR_B6', 'SR_B5']).rename('NDBI');
  return lst.addBands(ndbi).updateMask(clear).copyProperties(img, ['system:time_start']);
}
function l8comp(year) {
  var col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(region).filterDate(year + '-05-01', year + '-09-30').map(prepL8);
  print(year + '년 Landsat 8 장면 수', col.size());
  return col.mean();
}
var c20 = l8comp(2020), c25 = l8comp(2025);

function bukguMean(img) {   // 기존 코드와 동일: 북구 경계, 30m
  return ee.Number(img.reduceRegion({reducer: ee.Reducer.mean(), geometry: bukguGeom,
                                     scale: 30, maxPixels: 1e10}).get('LST'));
}
var m20 = bukguMean(c20.select('LST')), m25 = bukguMean(c25.select('LST'));
print('북구 평균 LST 2020 / 2025 (℃)', m20, m25);

var rl20 = c20.select('LST').subtract(m20).rename('RLST20');
var rl25 = c25.select('LST').subtract(m25).rename('RLST25');

// ---- 3. Sentinel-2: SAVI (반사율 = 화소값 ÷ 10,000) ----------------------------
function prepS2(img) {
  var qa = img.select('QA60');
  var clear = qa.bitwiseAnd(1 << 10).eq(0).and(qa.bitwiseAnd(1 << 11).eq(0));
  var r = img.select(['B8', 'B4']).divide(10000);
  var savi = r.expression('((N - R) / (N + R + 0.5)) * 1.5', {N: r.select('B8'), R: r.select('B4')}).rename('SAVI');
  return savi.updateMask(clear);
}
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(region);
var saviMax  = s2.filterDate('2025-05-01', '2025-10-31').filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
                 .map(prepS2).max().rename('SAVI25_max');
var saviMean = s2.filterDate('2025-05-01', '2025-09-30').filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
                 .map(prepS2).mean().rename('SAVI25_mean');

var dem = ee.Image('USGS/SRTMGL1_003').select('elevation').rename('DEM');

// ---- 4. 변수 묶기 ----------------------------------------------------------------
var stack = ee.Image.cat([
  c25.select('LST').rename('LST25_abs'),
  rl20, rl25, rl25.subtract(rl20).rename('dRLST'),
  c20.select('NDBI').rename('NDBI20'), c25.select('NDBI').rename('NDBI25'),
  c25.select('NDBI').subtract(c20.select('NDBI')).rename('dNDBI'),
  saviMax, saviMean, dem,
  c20.select('LST').mask().gt(0).unmask(0).rename('valid20'),
  c25.select('LST').mask().gt(0).unmask(0).rename('valid25')
]).toFloat();

// ---- 5. 집계구별 면적 가중 평균 ---------------------------------------------------
var proj5179 = ee.Projection('EPSG:5179');
var oaPrep = oa.map(function (f) {
  var xy = f.geometry().centroid(ee.ErrorMargin(1)).transform(proj5179, ee.ErrorMargin(1)).coordinates();
  return f.set({cx: xy.get(0), cy: xy.get(1), area_m2: f.geometry().area(ee.ErrorMargin(1))});
});
var stats = stack.reduceRegions({
  collection: oaPrep, reducer: ee.Reducer.mean(),
  crs: 'EPSG:5179', scale: 10, tileScale: 4
});
Export.table.toDrive({
  collection: stats, description: 'Bukgu_OA_zonal_areaweighted', folder: FOLDER, fileFormat: 'CSV',
  selectors: [OA_FIELD, 'ADM_CD', 'cx', 'cy', 'area_m2', 'LST25_abs', 'RLST20', 'RLST25', 'dRLST',
              'NDBI20', 'NDBI25', 'dNDBI', 'SAVI25_max', 'SAVI25_mean', 'DEM', 'valid20', 'valid25']
});

// ---- 6. 집계구 Queen 인접 목록(경계나 꼭짓점이 닿으면 이웃) ----------------------
var joined = ee.Join.saveAll('nbrs').apply({
  primary: oa, secondary: oa,
  condition: ee.Filter.intersects({leftField: '.geo', rightField: '.geo', maxError: 1})
});
var nbrTable = joined.map(function (f) {
  var ids = ee.List(f.get('nbrs')).map(function (n) { return ee.Feature(n).get(OA_FIELD); });
  return ee.Feature(null, {oa: f.get(OA_FIELD), nbrs: ids.join(';')});
});
Export.table.toDrive({
  collection: nbrTable, description: 'Bukgu_OA_queen_neighbors', folder: FOLDER, fileFormat: 'CSV',
  selectors: ['oa', 'nbrs']
});

// ---- 7. 확인용 지도 ---------------------------------------------------------------
Map.centerObject(oa, 12);
Map.addLayer(stack.select('LST25_abs'), {min: 28, max: 46, palette: ['313695', 'ffffbf', 'a50026']}, 'LST 2025');
Map.addLayer(ee.Image().byte().paint({featureCollection: oa, color: 1, width: 1}), {palette: ['000000']}, '집계구');

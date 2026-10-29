// ==============================================================================
// Track 1 거주지 기준 노출: 집계구 안 "주거용 건물 위"의 2025 여름 지표면온도 평균
//
// 지금 Track 1의 노출 값(Abs_mean)은 집계구 전체 면적 평균이라 공원·산·논밭·도로가 섞입니다.
// 이 스크립트는 같은 2025 LST(기존과 같은 자료·기간·마스크·평균 합성)를
// 주거용 건물이 덮은 면적만큼 가중해 평균합니다.
//
// [준비] QGIS에서 국토교통부 GIS건물통합정보(광주 북구)를 열고, 주용도가 단독주택·공동주택인
//        건물만 골라 shp로 저장 → GEE Assets 탭에서 NEW > Shape files로 업로드 → 아래 경로를 바꾸기
// [출력] Bukgu_OA_LST25_residential.csv (Google Drive 'GEE_Output')
//   LST25_all : 집계구 전체 면적 가중 평균(기존 Abs_mean과 같은 계산, 대조용)
//   LST25_res : 주거용 건물 면적 가중 평균(새 노출 값)
//   res_share : 집계구 면적 중 주거용 건물 지붕이 덮은 비율
// ==============================================================================

var RES_ASSET = 'projects/lateral-plane-500605-i8/assets/bukgu_res_buildings';   // ← 올린 자산 경로로 바꾸기
var OA_ASSET  = 'projects/lateral-plane-500605-i8/assets/bnd_oa_24040_2025_2Q';
var OA_FIELD  = 'TOT_OA_CD';
var FOLDER    = 'GEE_Output';

var oa  = ee.FeatureCollection(OA_ASSET);
var res = ee.FeatureCollection(RES_ASSET);
var region = oa.geometry().bounds().buffer(500);
print('집계구 수', oa.size(), '주거용 건물 수', res.size());

// ---- 1. 2025 여름 LST: 기존 oa_zonal_areaweighted.js와 같은 계산 --------------------
function prepL8(img) {
  var qa = img.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0));
  return img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15)
            .rename('LST').updateMask(clear);
}
var lst25 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterBounds(region).filterDate('2025-05-01', '2025-09-30')
  .map(prepL8).mean();

// ---- 2. 주거용 건물 지붕 마스크(10 m로 칠해짐) ------------------------------------------
var resImg = ee.Image(0).byte().paint(res, 1);           // 건물 안 1, 밖 0
var stack = ee.Image.cat([
  lst25.rename('LST25_all'),
  lst25.updateMask(resImg).rename('LST25_res'),
  resImg.rename('res_share')
]).toFloat();

// ---- 3. 집계구별 면적 가중 평균(10 m, EPSG:5179 — 기존과 같은 방식) ------------------
var stats = stack.reduceRegions({
  collection: oa, reducer: ee.Reducer.mean(),
  crs: 'EPSG:5179', scale: 10, tileScale: 4
});
Export.table.toDrive({
  collection: stats, description: 'Bukgu_OA_LST25_residential', folder: FOLDER, fileFormat: 'CSV',
  selectors: [OA_FIELD, 'LST25_all', 'LST25_res', 'res_share']
});

// ---- 4. 확인용 지도 ---------------------------------------------------------------------
Map.centerObject(oa, 13);
Map.addLayer(lst25, {min: 28, max: 46, palette: ['313695', 'ffffbf', 'a50026']}, 'LST 2025');
Map.addLayer(res.style({color: '000000', fillColor: 'ffffff66', width: 0.5}), {}, '주거용 건물');
Map.addLayer(ee.Image().byte().paint({featureCollection: oa, color: 1, width: 1}), {palette: ['2166ac']}, '집계구');

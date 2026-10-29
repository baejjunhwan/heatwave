// =============================================================================
// 논문 3.2절 격자 NDBI 재추출(v3): 2020·2025년 하절기, Landsat 8 C2 L2, 광주 북구
// -----------------------------------------------------------------------------
// [문제] 기존 코드는 SR_B6·SR_B5의 원시 화소값(DN)으로 NDBI를 계산하였다.
//        Collection 2 지표반사율은 "반사율 = DN × 0.0000275 − 0.2"로 변환해야 하며,
//        오프셋(−0.2) 때문에 DN으로 계산한 정규화 지수는 반사율 기준 값과 비례하지 않는다.
// [수정] 반사율로 변환한 뒤 NDBI = (SWIR1 − NIR) / (SWIR1 + NIR) = (B6 − B5) / (B6 + B5)
// [비교] 기존 방식(DN 기준, 이름 끝에 _raw)도 함께 산출 → 기존 자료와 대조해 원인 확인용
// [유지] 기간(5/1~9/30, filterDate 끝 날짜 미포함), QA_PIXEL bit 3·4 마스크,
//        장면별 NDBI 산출 후 평균 합성, 북구 경계로 clip — 모두 기존 코드와 동일
// [집계] 논문의 QGIS 100m 격자(EPSG:5179, 원점 939375.9156 / 1696099.9091)를
//        GEE에서 똑같이 재구성해 격자 평균 CSV로 내보냄(col·row = QGIS col_index·row_index)
// =============================================================================

var korea_emd = ee.FeatureCollection('projects/lateral-plane-500605-i8/assets/emdyy');
var bukgu     = korea_emd.filter(ee.Filter.stringStartsWith('EMD_CD', '29170'));
var bukguGeom = bukgu.union(ee.ErrorMargin(1)).geometry();

var FOLDER = 'GEE_NDBI_2020_2025';

// [선택] QGIS 격자 shapefile을 GEE 자산으로 올렸다면 경로를 넣으세요. 비워 두면 아래 원점으로 재구성합니다.
var GRID_ASSET = '';
// 논문 QGIS 격자의 좌상단 원점(EPSG:5179)과 격자 크기
var X0 = 939375.915623063;
var Y0 = 1696099.90909134;
var CELL = 100;

var EXPORT_GRID_CSV = true;    // 격자 평균 CSV (권장)
var EXPORT_RASTERS  = false;   // QGIS에서 직접 구역통계를 하려면 true (30m GeoTIFF, EPSG:5179)

// ---------------------------- 1. Landsat 8 전처리 ----------------------------
function prepL8(img) {
  var qa = img.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 3).eq(0)          // bit 3: 구름
               .and(qa.bitwiseAnd(1 << 4).eq(0));   // bit 4: 구름 그림자

  // [수정] 지표반사율 스케일 팩터·오프셋 적용 후 NDBI
  var sr = img.select(['SR_B5', 'SR_B6']).multiply(0.0000275).add(-0.2);
  var ndbi = sr.normalizedDifference(['SR_B6', 'SR_B5']).rename('NDBI');

  // [비교] 기존 방식: 원시 화소값(DN)으로 계산
  var ndbiRaw = img.normalizedDifference(['SR_B6', 'SR_B5']).rename('NDBI_raw');

  return ndbi.addBands(ndbiRaw).updateMask(clear)
             .copyProperties(img, ['system:time_start']);
}

function composite(year) {
  var col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(bukguGeom)
    .filterDate(year + '-05-01', year + '-09-30')   // 기존 코드와 동일(9/30 미포함)
    .map(prepL8);
  print(year + '년 하절기 Landsat 8 장면 수', col.size());
  return col.mean().clip(bukguGeom);
}

var c20 = composite(2020);
var c25 = composite(2025);

var stack = ee.Image.cat([
  c20.select('NDBI').rename('NDBI20'),
  c25.select('NDBI').rename('NDBI25'),
  c25.select('NDBI').subtract(c20.select('NDBI')).rename('dNDBI'),
  c20.select('NDBI_raw').rename('NDBI20_raw'),
  c25.select('NDBI_raw').rename('NDBI25_raw'),
  c25.select('NDBI_raw').subtract(c20.select('NDBI_raw')).rename('dNDBI_raw')
]).toFloat();

// ---------------------------- 2. 진단 출력 ----------------------------------
print('북구 평균(30m 화소): 수정 NDBI vs 기존 NDBI',
  stack.reduceRegion({reducer: ee.Reducer.mean(), geometry: bukguGeom, scale: 30, maxPixels: 1e10}));
print('ΔNDBI 수정 방식과 기존 방식의 화소 상관',
  stack.select(['dNDBI', 'dNDBI_raw']).reduceRegion({
    reducer: ee.Reducer.pearsonsCorrelation(), geometry: bukguGeom, scale: 30, maxPixels: 1e10}));

// ---------------------------- 3. 100m 격자 평균 CSV --------------------------
if (EXPORT_GRID_CSV) {
  var proj5179 = ee.Projection('EPSG:5179');
  var grid = GRID_ASSET
    ? ee.FeatureCollection(GRID_ASSET).filterBounds(bukguGeom)
    : bukguGeom.coveringGrid(ee.Projection('EPSG:5179', [CELL, 0, X0, 0, -CELL, Y0]));

  grid = grid.map(function (c) {
    var ctr = c.geometry().centroid(ee.ErrorMargin(1));
    var xy  = ctr.transform(proj5179, ee.ErrorMargin(1)).coordinates();
    var cx = ee.Number(xy.get(0)), cy = ee.Number(xy.get(1));
    return c.set({
      cx: cx, cy: cy,
      col: cx.subtract(X0).divide(CELL).floor(),          // = QGIS col_index
      row: ee.Number(Y0).subtract(cy).divide(CELL).floor(), // = QGIS row_index
      center_in: bukguGeom.contains(ctr, ee.ErrorMargin(1))
    });
  });
  print('격자 수(북구와 겹치는 격자)', grid.size());
  print('격자 정렬 확인: 중심점이 원점에서 50m 떨어져 있어야 함', grid.first());

  // 10m로 계산하여 30m 화소가 격자 경계에 걸친 부분까지 면적 비례로 평균(제3장 재추출과 동일)
  var stats = stack.reduceRegions({
    collection: grid, reducer: ee.Reducer.mean(),
    crs: 'EPSG:5179', scale: 10, tileScale: 4
  });

  Export.table.toDrive({
    collection: stats,
    description: 'Bukgu_NDBI_2020_2025_100m_grid',
    folder: FOLDER, fileFormat: 'CSV',
    selectors: ['col', 'row', 'cx', 'cy', 'center_in', 'id',
                'NDBI20', 'NDBI25', 'dNDBI', 'NDBI20_raw', 'NDBI25_raw', 'dNDBI_raw']
  });
}

// ---------------------------- 4. [선택] 래스터 내보내기 ----------------------
if (EXPORT_RASTERS) {
  Export.image.toDrive({
    image: stack, description: 'Bukgu_NDBI_2020_2025_stack',
    folder: FOLDER, region: bukguGeom, crs: 'EPSG:5179', scale: 30, maxPixels: 1e13
  });
  // 밴드 순서: 1 NDBI20, 2 NDBI25, 3 dNDBI, 4 NDBI20_raw, 5 NDBI25_raw, 6 dNDBI_raw
}

// ---------------------------- 5. 확인용 지도 --------------------------------
Map.centerObject(bukguGeom, 12);
Map.addLayer(stack.select('NDBI25'), {min: -0.5, max: 0.3, palette: ['1a9850', 'ffffbf', 'd73027']}, 'NDBI 2025 (수정)');
Map.addLayer(stack.select('dNDBI'), {min: -0.1, max: 0.1, palette: ['2166ac', 'f7f7f7', 'b2182b']}, 'ΔNDBI (수정)');
Map.addLayer(stack.select('dNDBI_raw'), {min: -0.1, max: 0.1, palette: ['2166ac', 'f7f7f7', 'b2182b']}, 'ΔNDBI (기존 방식)', false);
Map.addLayer(ee.Image().byte().paint({featureCollection: bukgu, color: 1, width: 2}), {palette: ['000000']}, '북구 경계');

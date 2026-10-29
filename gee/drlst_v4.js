// ==============================================================================
// ΔRLST v4 — 날짜를 맞춘 보정판
//
// [문제] v3(Mean LST+NDBI)는 5~9월 장면을 화소마다 구름을 걷어낸 뒤 그대로 평균하고,
//        그 합성에서 북구 평균 하나를 뺐습니다. 화소마다 평균에 들어간 날짜가 달라서,
//        2020년 유효 장면 수만으로 100 m 격자 ΔRLST와 r = 0.40, 격자 모형 R²가 0.175 → 0.325.
// [수정] ① 같은 날 겹치는 장면(path 116의 row 35·36)을 하루 하나로 합침
//        ② 구름 확장(bit 1)·권운(bit 2)까지 거름
//        ③ 북구 면적의 CLEAR_MIN 이상이 맑은 날만 씀
//        ④ 날짜마다 그날의 북구 평균을 먼저 빼서 RLST를 만든 뒤, 그 RLST를 화소별로 평균
//           → 날짜마다 기온이 다른 효과가 빠져, 화소마다 들어간 날짜 수가 달라도 덜 흔들림
//
// 출력(Google Drive 'GEE_Output', Tasks 탭에서 Run):
//   1) Bukgu_dRLST_v4.tif      : RLST20_v4, RLST25_v4, dRLST_v4, LST25_abs_v4, n2020, n2025 (30 m)
//   2) Bukgu_OA_dRLST_v4.csv   : 집계구별 면적 가중 평균(기존 oa_zonal_areaweighted.js와 같은 방식)
//   3) Bukgu_dRLST_v4_dates.csv: 사용한 날짜, 맑은 비율, 그날 북구 평균 LST
// ==============================================================================

var CLEAR_MIN = 0.7;   // 북구 면적 중 맑은 비율 하한
var FOLDER = 'GEE_Output';
var OA_ASSET = 'projects/lateral-plane-500605-i8/assets/bnd_oa_24040_2025_2Q';
var OA_FIELD = 'TOT_OA_CD';

var roi = ee.FeatureCollection('projects/lateral-plane-500605-i8/assets/emdyy')
            .filter(ee.Filter.stringStartsWith('EMD_CD', '29170'));
var bukguGeom = roi.union(ee.ErrorMargin(1)).geometry();
var oa = ee.FeatureCollection(OA_ASSET);

// ---- 1. 전처리: 엄격 마스크 + 날짜 속성 ------------------------------------------
function prep(img) {
  var qa = img.select('QA_PIXEL');
  var m = qa.bitwiseAnd(1 << 1).eq(0)
            .and(qa.bitwiseAnd(1 << 2).eq(0))
            .and(qa.bitwiseAnd(1 << 3).eq(0))
            .and(qa.bitwiseAnd(1 << 4).eq(0));
  return img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15)
            .rename('LST').updateMask(m)
            .set('date', img.get('DATE_ACQUIRED'));
}

// ---- 2. 날짜별 RLST ----------------------------------------------------------------
function dailyRLST(y) {
  var col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
              .filterBounds(bukguGeom)
              .filterDate(y + '-05-01', y + '-09-30')
              .map(prep);
  var dates = ee.List(col.aggregate_array('date')).distinct();
  var days = ee.ImageCollection.fromImages(dates.map(function (d) {
    var im = col.filter(ee.Filter.eq('date', d)).mean().rename('LST');   // 같은 날 겹치는 행을 하나로
    var clear = im.mask().unmask(0).rename('c').reduceRegion({
      reducer: ee.Reducer.mean(), geometry: bukguGeom, scale: 30, maxPixels: 1e10
    }).get('c');
    return im.set({date: d, clear: clear});
  })).filter(ee.Filter.gte('clear', CLEAR_MIN));
  return days.map(function (im) {
    var bk = ee.Number(im.reduceRegion({
      reducer: ee.Reducer.mean(), geometry: bukguGeom, scale: 30, maxPixels: 1e10
    }).get('LST'));
    return im.subtract(bk).rename('RLST')
             .set({date: im.get('date'), clear: im.get('clear'), bukgu_mean: bk});
  });
}

var d20 = dailyRLST(2020);
var d25 = dailyRLST(2025);
print('2020 사용 날짜', d20.aggregate_array('date'), '맑은 비율', d20.aggregate_array('clear'));
print('2025 사용 날짜', d25.aggregate_array('date'), '맑은 비율', d25.aggregate_array('clear'));

// ---- 3. 화소별 평균 -----------------------------------------------------------------
var r20 = d20.mean().rename('RLST20_v4');
var r25 = d25.mean().rename('RLST25_v4');
var bk25 = ee.Number(d25.aggregate_mean('bukgu_mean'));   // 사용한 2025년 날짜들의 북구 평균 LST
var stack = ee.Image.cat([
  r20, r25,
  r25.subtract(r20).rename('dRLST_v4'),
  r25.add(bk25).rename('LST25_abs_v4'),          // 날짜를 맞춘 2025 절대 LST(Track 1 점검용)
  d20.count().rename('n2020'),
  d25.count().rename('n2025')
]).toFloat();

// ---- 4. 내보내기 --------------------------------------------------------------------
Export.image.toDrive({
  image: stack.clip(roi), description: 'Bukgu_dRLST_v4', folder: FOLDER,
  scale: 30, region: bukguGeom.bounds(), maxPixels: 1e13
});

var oaStats = stack
  .addBands(r20.mask().unmask(0).rename('valid20'))
  .addBands(r25.mask().unmask(0).rename('valid25'))
  .reduceRegions({collection: oa, reducer: ee.Reducer.mean(), crs: 'EPSG:5179', scale: 10, tileScale: 4});
Export.table.toDrive({
  collection: oaStats, description: 'Bukgu_OA_dRLST_v4', folder: FOLDER, fileFormat: 'CSV',
  selectors: [OA_FIELD, 'RLST20_v4', 'RLST25_v4', 'dRLST_v4', 'LST25_abs_v4', 'n2020', 'n2025', 'valid20', 'valid25']
});

var dateTable = ee.FeatureCollection(d20.merge(d25).map(function (im) {
  return ee.Feature(null, {date: im.get('date'), clear: im.get('clear'), bukgu_mean: im.get('bukgu_mean')});
}));
Export.table.toDrive({
  collection: dateTable, description: 'Bukgu_dRLST_v4_dates', folder: FOLDER, fileFormat: 'CSV',
  selectors: ['date', 'clear', 'bukgu_mean']
});

// ---- 5. 확인용 지도 -----------------------------------------------------------------
var dv = {min: -3, max: 3, palette: ['2166ac', 'f7f7f7', 'b2182b']};
Map.centerObject(roi, 12);
Map.addLayer(stack.select('dRLST_v4').clip(roi), dv, 'ΔRLST v4');
Map.addLayer(stack.select('n2020').clip(roi), {min: 0, max: 6, palette: ['000000', 'ffffff']}, '2020 사용 날짜 수', false);
Map.addLayer(stack.select('n2025').clip(roi), {min: 0, max: 6, palette: ['000000', 'ffffff']}, '2025 사용 날짜 수', false);

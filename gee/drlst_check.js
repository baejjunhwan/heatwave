// ==============================================================================
// ΔRLST 점검: A(용봉동)·B(우산동)·C(군왕로)의 냉각·가열이 지면 변화인지, 합성 날짜 차이인지 가르기
//
// 원 스크립트(gee/Mean LST+NDBI)와 같은 자료(Landsat 8 C2 L2), 같은 기간(5/1~9/29),
// 같은 구름 마스크(QA bit 3 구름, bit 4 그림자)를 씁니다. 엄격 마스크는 bit 1(구름 확장)과
// bit 2(권운)를 더 걸러낸 것입니다.
//
// 출력(모두 Google Drive 'GEE_Output' 폴더, Tasks 탭에서 Run):
//   1) AB_scene_check.csv : 2020·2025 장면별 영역 평균 LST, 유효 화소 비율, 같은 장면의 북구 평균
//   2) AB_annual_RLST.csv : 2019~2025 연도별 여름 합성 RLST(원 마스크·엄격 마스크), 평균 유효 장면 수
//   3) AB_count_dRLST.tif : 화소별 유효 장면 수(2020·2025)와 ΔRLST(원 마스크·엄격 마스크), 30 m
// ==============================================================================

var roi = ee.FeatureCollection('projects/lateral-plane-500605-i8/assets/emdyy')
            .filter(ee.Filter.stringStartsWith('EMD_CD', '29170'));
var roiGeom = roi.geometry();

function rect(name, w, s, e, n) {
  return ee.Feature(ee.Geometry.Rectangle([w, s, e, n]), {name: name});
}
// 괄호 안은 100 m 격자 ΔRLST(현재 결과)
var regions = ee.FeatureCollection([
  rect('A_yongbong', 126.913474, 35.175065, 126.916749, 35.177785), // 3x3칸, +0.59
  rect('B_usan',     126.917873, 35.174184, 126.921148, 35.176905), // 3x3칸, -0.89
  rect('C_cool',     126.931107, 35.166132, 126.933284, 35.168847), // 군왕로 냉각 2x3칸, -1.64
  rect('C_west',     126.926715, 35.166111, 126.928892, 35.168826), // 군왕로 서쪽 2x3칸, +1.71
  rect('F_in_band',  126.923351, 35.176014, 126.924442, 35.176921), // 냉각 띠 안의 숲 1칸, -1.95
  rect('F_out_west', 126.907976, 35.175940, 126.909068, 35.176847)  // 띠 밖의 숲 1칸, +0.22
]);

// ------------------------------------------------------------------------------
// 전처리: strict=false 이면 원 스크립트와 같은 마스크
// ------------------------------------------------------------------------------
function makePrep(strict) {
  return function (img) {
    var qa = img.select('QA_PIXEL');
    var m = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0));
    if (strict) {
      m = m.and(qa.bitwiseAnd(1 << 1).eq(0)).and(qa.bitwiseAnd(1 << 2).eq(0));
    }
    var lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15)
                 .rename('LST').updateMask(m);
    return lst.set({
      'system:time_start': img.get('system:time_start'),
      'scene': img.get('system:index'),
      'path': img.get('WRS_PATH'),
      'row': img.get('WRS_ROW'),
      'cloud_cover': img.get('CLOUD_COVER')
    });
  };
}

var L8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterBounds(roiGeom);
function summer(y, strict) {
  return L8.filterDate(y + '-05-01', y + '-09-30').map(makePrep(strict));
}
function bukguMean(img) {
  return img.reduceRegion({reducer: ee.Reducer.mean(), geometry: roiGeom, scale: 30, maxPixels: 1e9})
            .get('LST');
}

print('2020 장면 수', summer(2020, false).size(), '2025 장면 수', summer(2025, false).size());
print('2020 장면', summer(2020, false).aggregate_array('scene'));
print('2025 장면', summer(2025, false).aggregate_array('scene'));

// ------------------------------------------------------------------------------
// 1) 장면별 표 (2020, 2025)
// ------------------------------------------------------------------------------
function sceneTable(y) {
  return ee.FeatureCollection(summer(y, false).map(function (lst) {
    var valid = lst.mask().unmask(0).rename('valid');
    var bk = bukguMean(lst);
    var bkValid = valid.reduceRegion({reducer: ee.Reducer.mean(), geometry: roiGeom, scale: 30, maxPixels: 1e9})
                       .get('valid');
    var date = ee.Date(lst.get('system:time_start')).format('YYYY-MM-dd');
    return lst.addBands(valid)
      .reduceRegions({collection: regions, reducer: ee.Reducer.mean(), scale: 30})
      .map(function (f) {
        return ee.Feature(null, {
          year: y, date: date, scene: lst.get('scene'), path: lst.get('path'), row: lst.get('row'),
          cloud_cover: lst.get('cloud_cover'), name: f.get('name'),
          valid: f.get('valid'), LST: f.get('LST'), bukgu_mean: bk, bukgu_valid: bkValid
        });
      });
  })).flatten();
}
var scenes = sceneTable(2020).merge(sceneTable(2025));
Export.table.toDrive({
  collection: scenes, description: 'AB_scene_check', folder: 'GEE_Output', fileFormat: 'CSV',
  selectors: ['year', 'date', 'scene', 'path', 'row', 'cloud_cover', 'name', 'valid', 'LST', 'bukgu_mean', 'bukgu_valid']
});

// ------------------------------------------------------------------------------
// 2) 연도별 여름 합성 RLST, 2019~2025 (원 스크립트와 같은 계산: 화소별 평균 - 북구 평균)
// ------------------------------------------------------------------------------
var annual = ee.FeatureCollection([]);
[2019, 2020, 2021, 2022, 2023, 2024, 2025].forEach(function (y) {
  [false, true].forEach(function (strict) {
    var col = summer(y, strict);
    var comp = col.mean();
    var bk = ee.Number(bukguMean(comp));
    var img = comp.subtract(bk).rename('RLST').addBands(col.count().rename('n'));
    var fc = img.reduceRegions({collection: regions, reducer: ee.Reducer.mean(), scale: 30})
      .map(function (f) {
        return ee.Feature(null, {
          year: y, mask: strict ? 'strict' : 'orig', name: f.get('name'),
          RLST: f.get('RLST'), n_mean: f.get('n'), scenes: col.size(), bukgu_mean: bk
        });
      });
    annual = annual.merge(fc);
  });
});
Export.table.toDrive({
  collection: annual, description: 'AB_annual_RLST', folder: 'GEE_Output', fileFormat: 'CSV',
  selectors: ['year', 'mask', 'name', 'RLST', 'n_mean', 'scenes', 'bukgu_mean']
});

// ------------------------------------------------------------------------------
// 3) 화소별 유효 장면 수와 ΔRLST (원·엄격)
// ------------------------------------------------------------------------------
function dRLST(strict) {
  var m20 = summer(2020, strict).mean(), m25 = summer(2025, strict).mean();
  var b20 = ee.Number(bukguMean(m20)), b25 = ee.Number(bukguMean(m25));
  return m25.subtract(b25).subtract(m20.subtract(b20)).rename(strict ? 'dRLST_strict' : 'dRLST_orig');
}
var out = ee.Image.cat([
  dRLST(false), dRLST(true),
  summer(2020, false).count().rename('n2020'),
  summer(2025, false).count().rename('n2025')
]).toFloat().clip(roi);

var dv = {min: -3, max: 3, palette: ['2166ac', 'f7f7f7', 'b2182b']};
Map.centerObject(regions, 14);
Map.addLayer(out.select('dRLST_orig'), dv, 'ΔRLST 원 마스크');
Map.addLayer(out.select('dRLST_strict'), dv, 'ΔRLST 엄격 마스크', false);
Map.addLayer(out.select('n2020'), {min: 0, max: 12, palette: ['000000', 'ffffff']}, '2020 유효 장면 수', false);
Map.addLayer(out.select('n2025'), {min: 0, max: 12, palette: ['000000', 'ffffff']}, '2025 유효 장면 수', false);
Map.addLayer(regions.style({color: 'ffff00', fillColor: '00000000', width: 2}), {}, '점검 영역');

Export.image.toDrive({
  image: out, description: 'AB_count_dRLST', folder: 'GEE_Output',
  scale: 30, region: roiGeom.bounds(), maxPixels: 1e13
});

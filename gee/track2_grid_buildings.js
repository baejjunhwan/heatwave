// ==============================================================================
// Track 2 격자판: 100 m 격자 칸마다 주거 건물 지붕 면적과 노후 건물 면적
//
// 기존 Track 2의 노후주택 비율(SGIS, 1999년 이전 건축 주택 ÷ 전체 주택)을 건물 자료로 바꿉니다.
//   노후 비율 = 1999년 이전 사용승인 주거 건물의 지붕 면적 ÷ 사용승인일이 있는 주거 건물의 지붕 면적
// 4장 격자(N = 11,752)와 같은 칸에 맞추려고, 격자 원점·크기를 그대로 써서 100 m 래스터로 내보냅니다.
//
// [바꿀 것] 아래 두 자산 경로와 사용승인일 칸 이름(DATE_FIELD)
//   - 칸 이름은 QGIS 속성표나, 실행 후 콘솔의 "첫 건물 속성"에서 확인
// [출력] Bukgu_grid100_buildings.tif (Google Drive 'GEE_Output'), 밴드 단위는 칸당 m²
//   res_h / known_h / old_h : 단독·공동주택 지붕 면적 / 그중 사용승인일 있는 면적 / 그중 1999년 이전
//   res_m / known_m / old_m : 근린생활시설 포함판의 같은 값
// ==============================================================================

var ASSET_HOUSE = 'projects/lateral-plane-500605-i8/assets/bukgu_res_buildings';     // ← 2번: 단독·공동주택
var ASSET_MIXED = 'projects/lateral-plane-500605-i8/assets/bukgu_res_buildings_2';   // ← 1번: 근린생활시설 포함
var DATE_FIELD  = 'A13';        // ← 사용승인일 칸 이름으로 바꾸기
var OLD_YEAR    = 1999;         // 기존 SGIS 노후주택 기준과 같음
var FOLDER      = 'GEE_Output';

// 4장 100 m 격자 (EPSG:5179)
var X0 = 939392.419, Y0 = 1696099.8, NC = 172, NR = 154;

var house = ee.FeatureCollection(ASSET_HOUSE);
var mixed = ee.FeatureCollection(ASSET_MIXED);
print('첫 건물 속성(사용승인일 칸 이름 확인용)', ee.Feature(house.first()).toDictionary());
print('건물 수: 주택 / 근생 포함', house.size(), mixed.size());

// ---- 1. 사용승인 연도 뽑기: '19950312', '1995-03-12', 19950312, 1995 모두 처리 -----------
function addYear(fc) {
  return fc.filter(ee.Filter.notNull([DATE_FIELD])).map(function (f) {
    var v = f.get(DATE_FIELD);
    var isStr = ee.String(ee.Algorithms.ObjectType(v)).equals('String');
    var yr = ee.Algorithms.If(isStr,
      ee.Algorithms.If(ee.String(v).trim().length().gte(4),
        ee.Number.parse(ee.String(v).trim().slice(0, 4)), 0),
      ee.Algorithms.If(ee.Number(v).gte(10000), ee.Number(v).divide(10000).floor(), ee.Number(v)));
    return f.set('yr', yr);
  });
}
var yh = addYear(house);
print('사용승인 연도 예시(주택)', yh.limit(5).aggregate_array('yr'));

function bands(fc, tag) {
  var known = addYear(fc).filter(ee.Filter.gt('yr', 1800));
  var old = known.filter(ee.Filter.lte('yr', OLD_YEAR));
  return ee.Image.cat([
    ee.Image(0).byte().paint(fc, 1).rename('res_' + tag),
    ee.Image(0).byte().paint(known, 1).rename('known_' + tag),
    ee.Image(0).byte().paint(old, 1).rename('old_' + tag)
  ]);
}

// ---- 2. 5 m로 칠한 뒤 100 m 격자 칸으로 평균 → 칸당 면적(m²) ----------------------------
var proj5   = ee.Projection('EPSG:5179', [5, 0, X0, 0, -5, Y0]);
var proj100 = ee.Projection('EPSG:5179', [100, 0, X0, 0, -100, Y0]);
var img = ee.Image.cat([bands(house, 'h'), bands(mixed, 'm')])
  .reproject(proj5)
  .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024})
  .reproject(proj100)
  .multiply(10000)
  .toFloat();

var region = ee.Geometry.Rectangle([X0, Y0 - 100 * NR, X0 + 100 * NC, Y0], 'EPSG:5179', false);
Export.image.toDrive({
  image: img, description: 'Bukgu_grid100_buildings', folder: FOLDER,
  crs: 'EPSG:5179', crsTransform: [100, 0, X0, 0, -100, Y0], region: region, maxPixels: 1e9
});

// ---- 3. 확인용 지도 ---------------------------------------------------------------------
Map.centerObject(region, 13);
Map.addLayer(img.select('old_h').divide(img.select('known_h').max(1)), {min: 0, max: 1, palette: ['f7f7f7', '67001f']},
             '노후 주거 지붕 비율(주택)');
Map.addLayer(img.select('res_h'), {min: 0, max: 4000, palette: ['ffffff', '000000']}, '주거 지붕 면적(m²)', false);

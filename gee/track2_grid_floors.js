// ==============================================================================
// Track 2 격자판 점검: 노후 지붕 면적을 "저층(4층·5층 이하) 노후 주거 지붕 면적"으로 좁히면?
//
// 지난번 track2_grid_buildings.js와 같은 자산·같은 100 m 격자·같은 노후 기준(1999년 이전 사용승인)을 쓰고,
// 지상층수(A26) 조건만 더합니다.
//   - 4층 이하: 건축법상 단독·다가구(3개 층 이하)와 연립·다세대(4개 층 이하). 아파트(5개 층 이상)를 뺌
//   - 5층 이하: 1층 필로티 다세대가 5층으로 기록된 경우를 살리는 비교용 기준
//
// [출력] Bukgu_grid100_floors.tif (Google Drive 'GEE_Output'), 밴드 단위는 칸당 m²
//   res_h    : 단독·공동주택 지붕 면적(전체)            ← 지난번 값과 같아야 함(대조용)
//   known_h  : 그중 사용승인일이 있는 면적               ← 〃
//   old_h    : 그중 1999년 이전(층수 무관)                ← 〃 지금 Track 2의 노후 지붕
//   old_lo4  : 1999년 이전 + 지상 1~4층
//   old_lo5  : 1999년 이전 + 지상 1~5층
//   old_flna : 1999년 이전 + 층수 없음 또는 0             ← 결측 점검용
// [콘솔] 층수 값 예시, 노후 건물 수와 층수 결측 수, 노후 건물 층수 분포, 북구 전체 면적 합계(ha)
// ==============================================================================

var ASSET_HOUSE = 'projects/lateral-plane-500605-i8/assets/bukgu_res_buildings';   // 단독·공동주택
var DATE_FIELD  = 'A13';   // 사용승인일
var FLOOR_FIELD = 'A26';   // 지상층수
var OLD_YEAR    = 1999;
var FOLDER      = 'GEE_Output';

// 4장 100 m 격자 (EPSG:5179)
var X0 = 939392.419, Y0 = 1696099.8, NC = 172, NR = 154;

var house = ee.FeatureCollection(ASSET_HOUSE);
print('층수 값 예시(A26)', house.limit(10).aggregate_array(FLOOR_FIELD));

// ---- 1. 사용승인 연도(yr)와 지상층수(fl) 붙이기 -----------------------------------------
//   연도: '19950312', '1995-03-12', 19950312, 1995 모두 처리(지난번과 같은 방식), 없으면 0
//   층수: 3, '3', ' 3 ' → 3 / 비었거나 숫자가 아니면 -1
function toYear(v) {
  return ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), 0,
    ee.Algorithms.If(ee.String(ee.Algorithms.ObjectType(v)).equals('String'),
      ee.Algorithms.If(ee.String(v).trim().length().gte(4),
        ee.Number.parse(ee.String(v).trim().slice(0, 4)), 0),
      ee.Algorithms.If(ee.Number(v).gte(10000), ee.Number(v).divide(10000).floor(), ee.Number(v)))));
}
function toFloor(v) {
  return ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), -1,
    ee.Algorithms.If(ee.String(ee.Algorithms.ObjectType(v)).equals('String'),
      ee.Algorithms.If(ee.String(v).trim().match('^[0-9]+$').length().gt(0),
        ee.Number.parse(ee.String(v).trim()), -1),
      ee.Number(v))));
}
var feats = house.map(function (f) {
  return f.set({yr: toYear(f.get(DATE_FIELD)), fl: toFloor(f.get(FLOOR_FIELD))});
});

var known = feats.filter(ee.Filter.gt('yr', 1800));
var old   = known.filter(ee.Filter.lte('yr', OLD_YEAR));
var oldLo4  = old.filter(ee.Filter.and(ee.Filter.gte('fl', 1), ee.Filter.lte('fl', 4)));
var oldLo5  = old.filter(ee.Filter.and(ee.Filter.gte('fl', 1), ee.Filter.lte('fl', 5)));
var oldFlNA = old.filter(ee.Filter.lte('fl', 0));

print('노후 주거 건물 수', old.size());
print('그중 층수 없음·0', oldFlNA.size());
print('노후 주거 건물 층수 분포 {층수: 건물 수}', old.aggregate_histogram('fl'));

// ---- 2. 5 m로 칠한 뒤 100 m 격자 칸으로 평균 → 칸당 면적(m²) ----------------------------
function paint(fc, name) { return ee.Image(0).byte().paint(fc, 1).rename(name); }
var proj5   = ee.Projection('EPSG:5179', [5, 0, X0, 0, -5, Y0]);
var proj100 = ee.Projection('EPSG:5179', [100, 0, X0, 0, -100, Y0]);
var img = ee.Image.cat([
    paint(feats, 'res_h'), paint(known, 'known_h'), paint(old, 'old_h'),
    paint(oldLo4, 'old_lo4'), paint(oldLo5, 'old_lo5'), paint(oldFlNA, 'old_flna')
  ])
  .reproject(proj5)
  .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024})
  .reproject(proj100)
  .multiply(10000)
  .toFloat();

var region = ee.Geometry.Rectangle([X0, Y0 - 100 * NR, X0 + 100 * NC, Y0], 'EPSG:5179', false);

// 북구 전체 합계(ha): old_lo4 / old_h 비율로 아파트가 노후 지붕에서 차지하는 몫을 바로 볼 수 있음
var totals = img.reduceRegion({
  reducer: ee.Reducer.sum(), geometry: region,
  crs: 'EPSG:5179', crsTransform: [100, 0, X0, 0, -100, Y0], maxPixels: 1e9
});
print('북구 합계(ha)', totals.map(function (k, v) { return ee.Number(v).divide(10000); }));

// ---- 3. 내보내기 ------------------------------------------------------------------------
Export.image.toDrive({
  image: img, description: 'Bukgu_grid100_floors', folder: FOLDER,
  crs: 'EPSG:5179', crsTransform: [100, 0, X0, 0, -100, Y0], region: region, maxPixels: 1e9
});

// ---- 4. 확인용 지도 ---------------------------------------------------------------------
Map.centerObject(region, 13);
Map.addLayer(img.select('old_h'),   {min: 0, max: 4000, palette: ['ffffff', '67001f']}, '노후 지붕(층수 무관)');
Map.addLayer(img.select('old_lo4'), {min: 0, max: 4000, palette: ['ffffff', '67001f']}, '노후 지붕(4층 이하)', false);
Map.addLayer(img.select('old_h').subtract(img.select('old_lo4')),
             {min: 0, max: 3000, palette: ['ffffff', '2166ac']}, '빠지는 면적(5층 이상)', false);
Map.addLayer(img.select('old_flna'), {min: 0, max: 1000, palette: ['ffffff', '000000']}, '층수 없는 노후 지붕', false);

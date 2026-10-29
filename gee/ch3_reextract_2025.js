// ==============================================================================
// 제3장 재추출: 북구·서구·광산구 2025년 하절기 LST · RLST · NDBI · SAVI · DEM
// ------------------------------------------------------------------------------
// 기존 코드 대비 수정 사항
//  1) SAVI  : Sentinel-2 화소값을 10,000으로 나눠 반사율로 변환한 뒤 계산
//             (기존: 정수값 그대로 계산 → 보정계수 L=0.5가 무력화, 최댓값 1.36)
//  2) SAVI  : 제4·5장과 같은 방식으로 통일 (5~10월, 장면 구름 30% 미만, 최댓값 합성)
//             (기존: 5~9월, 구름 20% 미만, 평균 합성)
//  3) NDBI  : Landsat SR_B6·SR_B5에 스케일 팩터(×0.0000275)와 오프셋(−0.2)을
//             적용해 반사율로 바꾼 뒤 계산 (기존: 정수값 그대로)
//  4) RLST  : 구 평균 기준(RLST_gu, 기존 방식)과 광주 전체 평균 기준(RLST_gj)을
//             함께 출력하고, 절대 지표면온도(LST_abs)도 출력 → 구 간 온도 수준 비교 가능
//  5) 콘솔  : 구별·광주 전체 평균 LST와 사용 장면 수 출력 (본문 기재용)
//  6) 내보내기 좌표계 명시 (EXPORT_CRS). 기존 3장 100m 격자(EPSG:5186)와 맞춤
//  7) [선택] 100m 격자 구역평균을 GEE에서 바로 CSV로 내보내기 (QGIS 단계 생략 가능)
//  8) [선택] 제4장 〈표 4-5〉용: 북구 2020~2025년 연도별 장면 수와 평균 LST 출력
//  9) [비교용] Sentinel-2 NDBI(NDBI_S2, B11·B8, 5~9월 중앙값)도 함께 내보냄
//     → 본 분석은 Landsat NDBI, NDBI_S2는 민감도 검토용
// ==============================================================================

// ---------------------------- 0. 설정 ---------------------------------------
var korea_emd = ee.FeatureCollection('projects/lateral-plane-500605-i8/assets/emdyy');

var GU = [                       // 행정표준코드 앞 5자리
  {code: '29170', name: 'Bukgu'},
  {code: '29140', name: 'Seogu'},
  {code: '29200', name: 'Gwangsan'}
];

var YEAR = 2025;
// 기간 문자열은 제4·5장 코드와 동일하게 유지 (filterDate의 끝 날짜는 포함되지 않음)
var LST_START  = YEAR + '-05-01', LST_END  = YEAR + '-09-30';   // LST·NDBI: 5~9월 평균
var SAVI_START = YEAR + '-05-01', SAVI_END = YEAR + '-10-31';   // SAVI: 5~10월 최댓값

var EXPORT_CRS = 'EPSG:5186';   // 기존 3장 100m 격자 좌표계. 다른 격자를 쓰면 맞춰 바꿀 것
var FOLDER = 'GEE_Ch3_' + YEAR + '_v2';

var EXPORT_RASTERS  = true;     // 래스터(GeoTIFF) 내보내기 → QGIS 구역통계용
var EXPORT_GRID_CSV = true;     // 100m 격자 구역평균 CSV 바로 내보내기
var PRINT_CH4_TABLE = true;     // 제4장 표 4-5용 연도별 장면 수·평균 LST 출력

var gwangju = korea_emd.filter(ee.Filter.stringStartsWith('EMD_CD', '29'));
var gwangjuGeom = gwangju.union(ee.ErrorMargin(1)).geometry();

// ---------------------------- 1. Landsat 8: LST · NDBI -----------------------
function prepL8(img) {
  var qa = img.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 3).eq(0)        // bit 3: 구름
               .and(qa.bitwiseAnd(1 << 4).eq(0)); // bit 4: 구름 그림자

  // 지표면온도: 켈빈 변환 후 섭씨
  var lst = img.select('ST_B10').multiply(0.00341802).add(149.0)
               .subtract(273.15).rename('LST');

  // [수정] 지표반사율 스케일 팩터·오프셋 적용 후 NDBI 계산
  var sr = img.select(['SR_B5', 'SR_B6']).multiply(0.0000275).add(-0.2);
  var ndbi = sr.normalizedDifference(['SR_B6', 'SR_B5']).rename('NDBI');  // (SWIR1−NIR)/(SWIR1+NIR)

  return lst.addBands(ndbi).updateMask(clear)
            .copyProperties(img, ['system:time_start']);
}

var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterBounds(gwangjuGeom)
  .filterDate(LST_START, LST_END)
  .map(prepL8);
var l8Mean = l8.mean();

// ---------------------------- 2. Sentinel-2: SAVI ---------------------------
function prepS2(img) {
  var qa = img.select('QA60');
  var clear = qa.bitwiseAnd(1 << 10).eq(0)        // 구름
               .and(qa.bitwiseAnd(1 << 11).eq(0)); // 권운

  // [수정] 화소값 ÷ 10,000 → 반사율(0~1)
  var refl = img.select(['B8', 'B4', 'B11']).divide(10000);
  var savi = refl.expression('((NIR - RED) / (NIR + RED + 0.5)) * 1.5', {
    NIR: refl.select('B8'),
    RED: refl.select('B4')
  }).rename('SAVI');
  // [비교용] Sentinel-2 NDBI = (SWIR1 B11 − NIR B8) / (SWIR1 + NIR), B11은 20m
  var ndbiS2 = refl.normalizedDifference(['B11', 'B8']).rename('NDBI_S2');
  return savi.addBands(ndbiS2).updateMask(clear)
             .copyProperties(img, ['system:time_start']);
}

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(gwangjuGeom)
  .filterDate(SAVI_START, SAVI_END)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .map(prepS2);
var savi = s2.select('SAVI').max();   // [수정] 제4·5장과 같은 최댓값 합성
// NDBI_S2는 Landsat NDBI와 같은 기간(5~9월)의 중앙값 합성
// (최댓값 합성은 밝은 나지·구름 잔여에 치우치므로 시가화지수에는 쓰지 않음)
var ndbiS2 = s2.filterDate(LST_START, LST_END).select('NDBI_S2').median();

// ---------------------------- 3. SRTM: DEM ----------------------------------
var dem = ee.Image('USGS/SRTMGL1_003').select('elevation').rename('DEM');

// ---------------------------- 4. 기준 평균과 장면 수 -------------------------
var gjMean = ee.Number(l8Mean.select('LST').reduceRegion({
  reducer: ee.Reducer.mean(), geometry: gwangjuGeom, scale: 30, maxPixels: 1e10
}).get('LST'));

print('광주 전체 ' + YEAR + ' 하절기 평균 LST (℃)', gjMean);
print('사용 Landsat 8 장면 수 (광주 영역)', l8.size());
print('사용 Sentinel-2 장면 수 (광주 영역, 구름 30% 미만)', s2.size());

// ---------------------------- 5. 구별 산출·내보내기 --------------------------
GU.forEach(function (g) {
  var roi  = korea_emd.filter(ee.Filter.stringStartsWith('EMD_CD', g.code));
  var geom = roi.union(ee.ErrorMargin(1)).geometry();

  var guMean = ee.Number(l8Mean.select('LST').reduceRegion({
    reducer: ee.Reducer.mean(), geometry: geom, scale: 30, maxPixels: 1e10
  }).get('LST'));
  print(g.name + ' ' + YEAR + ' 하절기 평균 LST (℃)', guMean);

  var lstAbs = l8Mean.select('LST').rename('LST_abs');
  var rlstGu = lstAbs.subtract(guMean).rename('RLST_gu');   // 구 평균 기준 (기존 정의)
  var rlstGj = lstAbs.subtract(gjMean).rename('RLST_gj');   // 광주 전체 평균 기준
  var ndbi   = l8Mean.select('NDBI');

  var stack30 = lstAbs.addBands([rlstGu, rlstGj, ndbi]).clip(geom).toFloat();

  if (EXPORT_RASTERS) {
    // 밴드 순서: 1 LST_abs, 2 RLST_gu, 3 RLST_gj, 4 NDBI
    Export.image.toDrive({
      image: stack30, description: g.name + '_L8_LST_RLST_NDBI_' + YEAR,
      folder: FOLDER, region: geom, scale: 30, crs: EXPORT_CRS, maxPixels: 1e13
    });
    Export.image.toDrive({
      image: savi.clip(geom).toFloat(), description: g.name + '_SAVI_' + YEAR,
      folder: FOLDER, region: geom, scale: 10, crs: EXPORT_CRS, maxPixels: 1e13
    });
    Export.image.toDrive({
      image: ndbiS2.clip(geom).toFloat(), description: g.name + '_NDBI_S2_' + YEAR,
      folder: FOLDER, region: geom, scale: 20, crs: EXPORT_CRS, maxPixels: 1e13
    });
    Export.image.toDrive({
      image: dem.clip(geom).toFloat(), description: g.name + '_DEM',
      folder: FOLDER, region: geom, scale: 30, crs: EXPORT_CRS, maxPixels: 1e13
    });
  }

  if (EXPORT_GRID_CSV) {
    // 100m 격자 생성 → 중심점이 구 경계 안에 있는 격자만 사용(기존 기준과 동일)
    var proj100 = ee.Projection(EXPORT_CRS).atScale(100);
    var cells = geom.coveringGrid(proj100).map(function (c) {
      var ctr = c.geometry().centroid(ee.ErrorMargin(1));
      var xy  = ctr.transform(ee.Projection(EXPORT_CRS), ee.ErrorMargin(1)).coordinates();
      return c.set({
        center_in: geom.contains(ctr, ee.ErrorMargin(1)),
        cx: xy.get(0),
        cy: xy.get(1)
      });
    }).filter(ee.Filter.eq('center_in', true));

    var stackAll = stack30.addBands(savi.clip(geom).rename('SAVI'))
                          .addBands(ndbiS2.clip(geom))
                          .addBands(dem.clip(geom));

    // 10m로 계산하여 30m 화소가 격자 경계에 걸친 부분까지 면적 비례로 평균
    var stats = stackAll.reduceRegions({
      collection: cells, reducer: ee.Reducer.mean(),
      scale: 10, crs: EXPORT_CRS, tileScale: 4
    });

    Export.table.toDrive({
      collection: stats, description: g.name + '_100m_grid_' + YEAR,
      folder: FOLDER, fileFormat: 'CSV',
      selectors: ['system:index', 'cx', 'cy',
                  'LST_abs', 'RLST_gu', 'RLST_gj', 'NDBI', 'NDBI_S2', 'SAVI', 'DEM']
    });
  }
});

// ---------------------------- 6. [선택] 제4장 표 4-5 -------------------------
// 북구 2020~2025년 하절기(5~9월) 연도별 Landsat 8 장면 수와 평균 LST
if (PRINT_CH4_TABLE) {
  var buk = korea_emd.filter(ee.Filter.stringStartsWith('EMD_CD', '29170'))
                     .union(ee.ErrorMargin(1)).geometry();

  var rows = ee.List.sequence(2020, 2025).map(function (y) {
    y = ee.Number(y).int();
    var col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(buk)
      .filterDate(ee.Date.fromYMD(y, 5, 1), ee.Date.fromYMD(y, 9, 30))
      .map(prepL8);

    // 장면별로 북구 면적 중 구름 없이 관측된 비율
    var withClear = col.map(function (im) {
      var frac = im.select('LST').mask().unmask(0).reduceRegion({
        reducer: ee.Reducer.mean(), geometry: buk, scale: 100, maxPixels: 1e10
      }).get('LST');
      return im.set('clear_frac', frac);
    });
    var valid = withClear.filter(ee.Filter.gt('clear_frac', 0));

    var meanLst = col.mean().select('LST').reduceRegion({
      reducer: ee.Reducer.mean(), geometry: buk, scale: 30, maxPixels: 1e10
    }).get('LST');

    return ee.Feature(null, {
      year: y,
      scenes_total: col.size(),                       // 북구와 겹치는 전체 장면
      scenes_valid: valid.size(),                     // 구름 없는 화소가 1개 이상인 장면
      mean_clear_fraction: valid.aggregate_mean('clear_frac'),
      mean_LST_Bukgu: meanLst
    });
  });

  print('제4장 표 4-5용: 북구 연도별 장면 수와 평균 LST', ee.FeatureCollection(rows));
}

// ---------------------------- 7. 확인용 지도 ---------------------------------
Map.centerObject(gwangjuGeom, 11);
Map.addLayer(l8Mean.select('LST').clip(gwangjuGeom),
             {min: 25, max: 50, palette: ['blue', 'cyan', 'yellow', 'red']}, 'LST 평균', false);
Map.addLayer(l8Mean.select('NDBI').clip(gwangjuGeom),
             {min: -0.5, max: 0.2, palette: ['green', 'white', 'brown']}, 'NDBI(반사율 기준)', false);
Map.addLayer(savi.clip(gwangjuGeom),
             {min: 0, max: 0.8, palette: ['white', 'green']}, 'SAVI(반사율 기준)');

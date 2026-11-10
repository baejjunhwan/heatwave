// ==============================================================================
// 정책지도 지표 탭용 식생지수 SAVI 10 m (2020·2025)
//
// 기존 'SAVI+DEM' 스크립트와 같은 합성입니다:
//   Sentinel-2 SR Harmonized, 5~10월, CLOUDY_PIXEL_PERCENTAGE < 30, QA60 구름·권운 제외,
//   SAVI = 1.5 × (B8 − B4) / (B8 + B4 + 0.5) (반사율 = 화소값 ÷ 10,000), 화소별 최댓값.
// 내보내기만 정책지도에 맞게 바꿉니다:
//   EPSG:5179, 10 m, 4장 100 m 격자와 같은 원점(100 m 칸 하나 = 10 m 화소 10 × 10개),
//   북구 경계 밖은 −9999(값 없음).
//
// [출력] Bukgu_SAVI_10m.tif (Google Drive 'GEE_Output') — 밴드 SAVI_2020, SAVI_2025
// ==============================================================================

var FOLDER = 'GEE_Output';
var X0 = 939392.419, Y0 = 1696099.8, NC = 172, NR = 154;   // 4장 100 m 격자 범위

var roi = ee.FeatureCollection('projects/lateral-plane-500605-i8/assets/emdyy')
            .filter(ee.Filter.stringStartsWith('EMD_CD', '29170'));
var bukgu = roi.geometry();

function maskS2clouds(image) {
  var qa = image.select('QA60');
  var mask = qa.bitwiseAnd(1 << 10).eq(0).and(qa.bitwiseAnd(1 << 11).eq(0));
  return image.updateMask(mask).divide(10000);
}
function annualSAVI(year) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(bukgu)
    .filterDate(year + '-05-01', year + '-10-31')
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
    .map(maskS2clouds)
    .map(function (img) {
      return img.expression('((NIR - RED) / (NIR + RED + 0.5)) * 1.5',
        {NIR: img.select('B8'), RED: img.select('B4')}).rename('SAVI');
    })
    .max();
}
var savi = ee.Image.cat([annualSAVI(2020).rename('SAVI_2020'), annualSAVI(2025).rename('SAVI_2025')])
  .clip(bukgu).toFloat();

var region = ee.Geometry.Rectangle([X0, Y0 - 100 * NR, X0 + 100 * NC, Y0], 'EPSG:5179', false);
Export.image.toDrive({
  image: savi, description: 'Bukgu_SAVI_10m', folder: FOLDER,
  crs: 'EPSG:5179', crsTransform: [10, 0, X0, 0, -10, Y0], region: region, maxPixels: 1e10,
  formatOptions: {noData: -9999}
});

Map.centerObject(roi, 12);
Map.addLayer(savi.select('SAVI_2025'), {min: 0, max: 0.6, palette: ['f7fcf5', 'a1d99b', '238b45', '00441b']}, 'SAVI 2025 (10 m)');
Map.addLayer(savi.select('SAVI_2025').subtract(savi.select('SAVI_2020')), {min: -0.3, max: 0.3, palette: ['8c510a', 'f5f5f5', '01665e']}, 'ΔSAVI 2020→2025', false);

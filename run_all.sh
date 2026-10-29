#!/usr/bin/env bash
# 저장소 최상위에서 실행합니다.
set -euo pipefail
cd "$(dirname "$0")"

# 1. 논문(v3) 분석: 격자 모형, 집계구 모형, Track 1·2(집계구판), 그림
python3 analysis/01_build_grid_master.py
python3 analysis/02_grid_models.py
python3 analysis/03_build_oa_master.py
python3 analysis/04_oa_models_and_tracks.py
python3 analysis/05_figures.py

# 2. Track 2 격자판(100 m, 건물 자료)
python3 track2_grid/00_build_grid_table.py
python3 track2_grid/01_scores_and_robustness.py
python3 track2_grid/02_export_table.py
python3 track2_grid/03_component_checks.py
python3 track2_grid/04_map_figure.py

# 3. Track 1 거주지 기준 노출(강건성 점검)
python3 track1_residential/01_join.py
python3 track1_residential/02_compare.py
python3 track1_residential/03_figure.py

# 4. 정책지도: data/boundary/ 에 SGIS 집계구 경계가 있을 때만 웹 자료를 다시 만듭니다
if [ -f data/boundary/bnd_oa_24040_2025_2Q.shp ]; then
  python3 web/build_web_data.py
fi
python3 web/build_grid_t2.py
python3 web/assemble.py

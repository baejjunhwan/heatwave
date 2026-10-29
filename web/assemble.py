"""Assemble the policy map: site/ (netlify, self-contained incl. Leaflet) and artifact/ (claude.ai preview)."""
import os, shutil
W = os.path.dirname(os.path.abspath(__file__))
UP = os.path.join(W, 'vendor', 'leaflet')
rd = lambda p: open(p, encoding='utf-8').read()
leaflet_css = rd(f'{UP}/css/leaflet.css')
style, body, app = rd(f'{W}/src/style.css'), rd(f'{W}/src/body.html'), rd(f'{W}/src/app.js')
import re
app_art = re.sub(r'/\*DL-START\*/.*?/\*DL-END\*/', '', app, flags=re.S)
body_art = body.replace('\n            <button class="btn" id="dlCsv" hidden>CSV 내려받기</button>', '')
assert app_art != app and body_art != body
TITLE = '북구 폭염 정책지도'
DESC = '광주 북구의 폭염 대응 우선순위(Track 1 단기 구호는 집계구 832곳, Track 2 중장기 개선은 100m 격자)를 위성 지표면온도, 인구 통계, 건물 자료로 보여 주는 지도'
FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' \
       '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">'
CSS = f'<style>\n/* Leaflet 1.9.4 */\n{leaflet_css}\n</style>\n<style>\n{style}\n</style>'

site = f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{TITLE}</title>
<meta name="description" content="{DESC}">
<meta property="og:title" content="{TITLE}">
<meta property="og:description" content="{DESC}">
{FONT}
{CSS}
</head>
<body>
{body}
<script>window.APP_ENV = 'site';</script>
<script src="lib/leaflet.js"></script>
<script>
{app}
</script>
</body>
</html>
"""
art = f"""<title>{TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
{FONT}
{CSS}
{body_art}
<script>window.APP_ENV = 'artifact';</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script>
{app_art}
</script>
"""
os.makedirs(f'{W}/site/lib', exist_ok=True)
shutil.copy(f'{UP}/js/leaflet.js', f'{W}/site/lib/leaflet.js')
open(f'{W}/site/index.html', 'w', encoding='utf-8').write(site)
os.makedirs(f'{W}/artifact', exist_ok=True)
open(f'{W}/artifact/index.html', 'w', encoding='utf-8').write(art)
print('site', len(site), 'artifact', len(art))

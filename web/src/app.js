/* 광주 북구 폭염 대응 정책지도 — Leaflet app. Data: data/oa.json (919 OAs, Track 1), grid_t2.json (100m grid, Track 2), meta.json, dongs.json, raster_meta.json.
   window.APP_ENV = 'site' (netlify) | 'artifact' (claude.ai preview: no external tiles, no downloads). */
(function () {
  'use strict';
  const ENV = window.APP_ENV || 'site';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const nf = new Intl.NumberFormat('ko-KR');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const narrow = () => window.matchMedia('(max-width: 880px)').matches;

  // ---------------------------------------------------------------- colour ramps (light→dark, one hue each)
  const RAMP = {
    t1: ['#fbe3d6', '#f2ab83', '#eb6834', '#9e3b13'],
    t2: ['#d3e6fc', '#9ec5f4', '#3987e5', '#184f95'],
    abs: ['#fde0d2', '#f7b096', '#ec7b5a', '#d24a35', '#9e2a1f'],
    eld: ['#ebe7fb', '#c7bdf2', '#9f90e4', '#7462cf', '#4a38a3'],
    old: ['#fbefd3', '#f2d28a', '#e1a944', '#b97a1c', '#7f520f'],
    savi: ['#e7f2de', '#bcdea6', '#86c06e', '#4f9c45', '#256c2f'],
    div: ['#1c5cab', '#5598e7', '#b7d3f6', '#ecebe6', '#f6c3a6', '#eb6834', '#b8410f'],
  };
  const EXCL_TXT = {
    nolst: '위성 지표면온도 산출물이 이 위치에서 비어 있어(방사율 입력자료 ASTER GED 결측) 점수를 계산하지 않았습니다. 사람이 사는 곳이므로 현장 확인이 필요할 수 있습니다.',
    nopop: '2024년 거주 인구가 없는 집계구(산업·공공시설 등)라 분석에서 제외했습니다.',
    nohouse: '주택 통계가 없어 노후 주택 비율을 계산할 수 없어 제외했습니다.',
  };
  const EXCL_SHORT = { nolst: '온도 자료 없음', nopop: '거주 인구 없음', nohouse: '주택 통계 없음' };

  const POLICY = {
    t1: ['무더위쉼터 지정·운영시간 연장을 먼저 검토', '쿨링포그·그늘막 우선 설치', '폭염특보 때 홀로 사는 어르신 안부 확인(생활지원사·방문간호 연계)'],
    t2: ['노후 주택 쿨루프(차열 도장)·옥상녹화 지원', '골목 가로수·그늘 확충, 포장면 줄이기'],
    dev: ['개발 단계에서 녹지율·투수 포장 확보', '바람길을 막지 않는 건물 배치 검토'],
  };

  // ---------------------------------------------------------------- state
  const S = { tab: 'prio', track: 't1', ind: 'abs', grid: false, base: 's2', op: 0.78, sel: null, scope: 'top', swipe: 0.5, compOutline: true };
  let HOME, D, META, DONGS, RM, IND, F = {}, OK = [], map, oaLayer, topLayers, selLayer, gridLayers = {}, s2 = {}, tiles = {}, labels;
  // Track 2 (100m grid): GT = {meta, cells, dev}; G = id → feature; T2BYOA = OA code → top-cell count
  let GT, G = {}, T2BYOA = {}, t2Layer, oaRenderer;
  const isCell = (id) => typeof id === 'string' && id[0] === 'g';
  const t2Mode = () => S.track === 't2' && S.tab !== 'ind' && S.tab !== 'comp';

  // ---------------------------------------------------------------- formatting
  const fmt = (v, nd, signed) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '–';
    const s = Number(v).toFixed(nd);
    return signed && v > 0 ? '+' + s : s.replace('-', '−');
  };
  const pcText = (pc) => (pc >= 50 ? `832곳 중 상위 ${Math.max(1, Math.ceil(100 - pc))}%` : `832곳 중 하위 ${Math.max(1, Math.ceil(pc))}%`);
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; $('.mapwrap').appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }
  async function copyText(txt, okMsg) {
    try { await navigator.clipboard.writeText(txt); toast(okMsg); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
      ta.remove(); toast(ok ? okMsg : '복사하지 못했습니다. 직접 선택해 복사해 주세요.');
    }
  }

  // ---------------------------------------------------------------- classes
  const clsCount = (v, br) => br.reduce((k, b) => k + (v >= b ? 1 : 0), 0);
  function trackClass(p) {
    const br = META.breaks.t1;
    if (p.k1) return 3;
    return p.t1 >= br[1] ? 2 : p.t1 >= br[0] ? 1 : 0;
  }
  function cellClass(q) {
    const M = GT.meta;
    return q.k ? 3 : q.r <= M.q25 ? 2 : q.r <= M.q50 ? 1 : 0;
  }

  // ---------------------------------------------------------------- map styles
  function baseStroke() { return { color: css('--map-line') || '#fff', weight: 0.6, opacity: 0.85 }; }
  function exclStyle() { return Object.assign(baseStroke(), { fillColor: css('--excl'), fillOpacity: S.op * 0.75, dashArray: '2 3' }); }

  function styleFor(p) {
    const st = baseStroke();
    if (S.tab === 'comp') return Object.assign(st, { fillOpacity: 0, opacity: S.compOutline ? 0.7 : 0 });
    if (S.tab === 'ind') {
      const I = IND[S.ind];
      if (S.grid && I.grid) return Object.assign(st, { fillOpacity: 0, opacity: 0.55 });
      const v = p[S.ind];
      if (v === undefined || v === null || (p.s !== 'ok' && S.ind !== 'eld')) return exclStyle();
      const ramp = RAMP[I.ramp];
      return Object.assign(st, { fillColor: ramp[clsCount(v, I.breaks)], fillOpacity: S.op });
    }
    if (S.track === 't2' && S.tab !== 'comp') return Object.assign(st, { fillOpacity: 0, opacity: 0.5 });
    if (p.s !== 'ok') return exclStyle();
    const k = trackClass(p);
    return Object.assign(st, { fillColor: RAMP.t1[k], fillOpacity: k === 0 ? S.op * 0.4 : S.op });
  }

  // Track 2 grid cell style (drawn on the same canvas as the OA layer so clicks resolve to the cell)
  function cellStyle(f) {
    const q = f.properties;
    if (q.dev) return { color: css('--ink-2') || '#47515e', weight: 0.8, opacity: 0.9, dashArray: '2 2', fillColor: css('--excl'), fillOpacity: S.op * 0.8 };
    const k = cellClass(q);
    return { color: css('--map-line') || '#fff', weight: 0.3, opacity: 0.6, fillColor: RAMP.t2[k], fillOpacity: k === 0 ? S.op * 0.45 : S.op };
  }

  function topFilter(p) {
    if (p.s !== 'ok') return false;
    if (S.tab === 'ind') return false;
    if (S.tab === 'comp' && !S.compOutline) return false;
    return S.track === 't1' && p.k1;
  }

  function restyle() {
    oaLayer.setStyle(styleFor_layer);
    // Track 2 grid cells
    const t2on = t2Mode();
    if (t2on && !map.hasLayer(t2Layer)) t2Layer.addTo(map);
    if (!t2on && map.hasLayer(t2Layer)) map.removeLayer(t2Layer);
    if (t2on) t2Layer.setStyle(cellStyle);
    // top-10% double stroke (Track 1: OAs, Track 2: grid cells)
    topLayers.clearLayers();
    const feats = S.track === 't1' ? D.features.filter((f) => topFilter(f.properties))
      : (S.tab === 'ind' || (S.tab === 'comp' && !S.compOutline)) ? [] : GT.cells.filter((q) => q.k).map((q) => G[q.id]);
    if (feats.length) {
      const c = S.tab === 'comp' ? css(S.track === 't1' ? '--t1' : '--t2') : css('--ink');
      const w = S.track === 't2' ? [2.4, 1.1] : [3.6, 1.7];
      topLayers.addLayer(L.geoJSON(feats, { pane: 'top', renderer: topRenderer, interactive: false, style: { color: '#ffffff', weight: w[0], opacity: 0.95, fill: false } }));
      topLayers.addLayer(L.geoJSON(feats, { pane: 'top', renderer: topRenderer, interactive: false, style: { color: c, weight: w[1], opacity: 1, fill: false } }));
    }
    // grid
    Object.entries(gridLayers).forEach(([k, l]) => {
      const on = S.tab === 'ind' && S.grid && IND[S.ind].grid === k;
      if (on && !map.hasLayer(l)) l.addTo(map);
      if (!on && map.hasLayer(l)) map.removeLayer(l);
      l.setOpacity(Math.min(1, S.op + 0.1));
    });
    applyBase();
    drawSel();
  }
  const styleFor_layer = (f) => styleFor(f.properties);

  // ---------------------------------------------------------------- basemaps & satellite
  function applyBase() {
    const comp = S.tab === 'comp';
    const want2025 = comp || S.base === 's2';
    if (want2025 && !map.hasLayer(s2[2025])) s2[2025].addTo(map);
    if (!want2025 && map.hasLayer(s2[2025])) map.removeLayer(s2[2025]);
    if (comp && !map.hasLayer(s2[2020])) s2[2020].addTo(map);
    if (!comp && map.hasLayer(s2[2020])) map.removeLayer(s2[2020]);
    ['esri', 'osm'].forEach((k) => {
      const on = S.base === k;
      if (on && !map.hasLayer(tiles[k])) tiles[k].addTo(map);
      if (!on && map.hasLayer(tiles[k])) map.removeLayer(tiles[k]);
    });
    $$('.basemap [data-base]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.base === S.base)));
    $('#swipe').hidden = !comp; $('#tagL').hidden = !comp; $('#tagR').hidden = !comp;
    if (comp) clipSwipe(); else map.getPane('s2020').style.clip = '';
  }

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function setupTiles() {
    tiles.esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
    });
    // 일반 지도: OpenStreetMap 표준 타일(키 불필요, 한글 지명). 회색조로 눌러 집계구 색이 먼저 보이게 함 (CSS .osm-muted)
    tiles.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'osm-muted', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' });
    const disable = (why) => {
      ['esri', 'osm'].forEach((k) => { const b = $(`.basemap [data-base="${k}"]`); b.disabled = true; b.title = why; });
    };
    if (ENV === 'artifact') { disable('미리보기 화면에서는 외부 배경지도를 쓸 수 없습니다. 웹사이트에서는 사용할 수 있습니다.'); return; }
    Object.entries(tiles).forEach(([k, t]) => {
      let ok = 0, bad = 0;
      t.on('tileload', () => { ok++; });
      t.on('tileerror', () => {
        bad++;
        if (bad >= 4 && ok === 0 && S.base === k) {
          S.base = 's2'; applyBase(); note('외부 배경지도를 불러오지 못해 위성 2025 영상으로 바꿨습니다.');
        }
      });
    });
  }
  function note(msg) {
    const n = $('#mapNote'); n.textContent = msg; n.hidden = false;
    clearTimeout(note.t); note.t = setTimeout(() => { n.hidden = true; }, 5000);
  }

  // ---------------------------------------------------------------- swipe
  function clipSwipe() {
    const size = map.getSize();
    const nw = map.containerPointToLayerPoint([0, 0]);
    const se = map.containerPointToLayerPoint(size);
    const x = nw.x + size.x * S.swipe;
    map.getPane('s2020').style.clip = `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`;
    const px = size.x * S.swipe;
    $('#swipe').style.left = px + 'px';
    const tl = $('#tagL'), tr = $('#tagR');
    tl.style.left = Math.max(8, px - tl.offsetWidth - 10) + 'px';
    tr.style.left = Math.min(size.x - tr.offsetWidth - 8, px + 10) + 'px';
    $('.swipe .knob').setAttribute('aria-valuenow', String(Math.round(S.swipe * 100)));
  }
  function setupSwipe() {
    const knob = $('.swipe .knob');
    let drag = false;
    const move = (e) => {
      if (!drag) return;
      const r = $('.mapwrap').getBoundingClientRect();
      S.swipe = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width));
      clipSwipe();
    };
    knob.addEventListener('pointerdown', (e) => { drag = true; knob.setPointerCapture(e.pointerId); map.dragging.disable(); e.preventDefault(); });
    knob.addEventListener('pointermove', move);
    const end = () => { if (drag) { drag = false; map.dragging.enable(); } };
    knob.addEventListener('pointerup', end); knob.addEventListener('pointercancel', end);
    knob.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        S.swipe = Math.min(0.98, Math.max(0.02, S.swipe + (e.key === 'ArrowLeft' ? -0.05 : 0.05))); clipSwipe(); e.preventDefault();
      }
    });
    ['mousedown', 'touchstart', 'dblclick', 'wheel'].forEach((ev) => $('#swipe').addEventListener(ev, (e) => e.stopPropagation()));
    map.on('move zoomend resize', () => { if (S.tab === 'comp') clipSwipe(); });
  }

  // ---------------------------------------------------------------- selection & detail
  function drawSel() {
    selLayer.clearLayers();
    if (!S.sel) return;
    const f = isCell(S.sel) ? G[S.sel] : F[S.sel];
    selLayer.addLayer(L.geoJSON(f, { pane: 'sel', interactive: false, style: { color: '#ffffff', weight: 8, opacity: 1, fillColor: '#ffffff', fillOpacity: isCell(S.sel) ? 0 : 0.25 } }));
    selLayer.addLayer(L.geoJSON(f, { pane: 'sel', interactive: false, style: { color: '#111111', weight: 3.4, opacity: 1, fill: false } }));
  }

  function zoomTo(code) {
    const b = L.geoJSON(isCell(code) ? G[code] : F[code]).getBounds();
    const pad = narrow() ? { paddingTopLeft: [20, 70], paddingBottomRight: [20, Math.round($('.mapwrap').offsetHeight * 0.6) + 16] }
      : { paddingTopLeft: [40, 40], paddingBottomRight: [400, 40] };
    map.fitBounds(b, Object.assign({ maxZoom: 16, animate: true }, pad));
  }

  function select(code, opts = {}) {
    if (!F[code] && !G[code]) return;
    if (isCell(code) && S.track !== 't2') { S.track = 't2'; renderPrio(); if (S.tab === 'table') renderTable(); restyle(); }
    S.sel = code;
    drawSel();
    renderDetail();
    if (opts.zoom !== false) zoomTo(code);
    if (narrow() && opts.scroll !== false) $('.mapwrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $$('#tblBody tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.code === code));
    if (ENV === 'site') { try { history.replaceState(null, '', '#' + code); } catch (e) { /* ignore */ } }
  }
  function closeDetail() {
    S.sel = null; $('#detail').hidden = true; $('.mapwrap').classList.remove('has-detail'); drawSel();
    $$('#tblBody tr.sel').forEach((tr) => tr.classList.remove('sel'));
    if (ENV === 'site') { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } }
  }

  function metricRow(k, p) {
    const I = IND[k], v = p[k], pc = p.pc ? p.pc[k] : null;
    if (v === undefined || v === null) return '';
    const bar = pc === null ? '' : `<div class="bar" aria-hidden="true"><u style="width:${pc}%"></u><i style="left:${pc}%"></i></div><div class="pc">${pcText(pc)}</div>`;
    return `<div class="metric"><span class="nm">${esc(I.name)}</span><span class="v num">${fmt(v, I.nd, I.signed)}${I.unit ? ' ' + I.unit : ''}</span>${bar}</div>`;
  }

  function cellMetric(name, val, z, pc, note) {
    const bar = `<div class="bar" aria-hidden="true"><u style="width:${pc}%"></u><i style="left:${pc}%"></i></div><div class="pc">${pc >= 50 ? `격자 ${nf.format(GT.meta.N)}칸 중 상위 ${Math.max(1, Math.ceil(100 - pc))}%` : `격자 ${nf.format(GT.meta.N)}칸 중 하위 ${Math.max(1, Math.ceil(pc))}%`} · Z ${fmt(z, 2, true)}</div>`;
    return `<div class="metric"><span class="nm">${esc(name)}</span><span class="v num">${val}</span>${bar}${note ? `<div class="pc">${note}</div>` : ''}</div>`;
  }

  function renderCellDetail() {
    const q = G[S.sel].properties;
    $('#dName').textContent = `${q.d || '북구'} · 100m 격자`;
    $('#dCode').textContent = `격자 중심 ${q.la.toFixed(5)}, ${q.lo.toFixed(5)}`;
    const ul = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    let h = '';
    if (q.dev) {
      h += `<div class="badges"><span class="badge"><i style="background:var(--excl)"></i>재건축·신개발 진행 · 순위 제외</span></div>`;
      h += `<p class="why">2020→2025년에 건물밀도가 크게 늘고(ΔNDBI ${fmt(q.n, 3, true)}) 녹지가 크게 줄어(ΔSAVI ${fmt(q.sv, 3, true)}) 재건축이나 신개발이 진행 중인 곳입니다. 건물 자료에 철거 전 건물이 남아 있을 수 있어 Track 2 순위에서 뺐습니다.</p>`;
      h += `<div class="box policy"><h3>검토할 수 있는 대응</h3>${ul(POLICY.dev)}</div>`;
    } else {
      h += `<div class="badges">${q.k ? '<span class="badge hot" style="color:var(--t2)"><i style="background:var(--t2)"></i>Track 2 상위 10%</span>' : '<span class="badge">상위 10% 밖</span>'}</div>`;
      h += `<div class="ranks"><div><span>Track 2 중장기 개선</span><b class="num">${q.r}</b><span class="num">/ ${nf.format(GT.meta.N)}위 · 점수 ${fmt(q.s, 2, true)}</span></div></div>`;
      h += `<div class="people"><div><b class="num">${nf.format(q.a)}</b><span>노후 주거 지붕(m²)</span></div><div><b class="num">${nf.format(q.t)}</b><span>주거 지붕 전체(m²)</span></div></div>`;
      if (q.k) h += `<div class="box policy"><h3>검토할 수 있는 대응</h3>${ul(POLICY.t2)}</div>`;
      h += `<div class="metrics">${cellMetric('건물밀도 변화 ΔNDBI', fmt(q.n, 3, true), q.zn, q.pn)}${cellMetric(`노후 주거 지붕 면적 (${GT.meta.old_year}년 이전)`, nf.format(q.a) + ' m²', q.za, q.pa)}${cellMetric('상대 지표면온도 변화 ΔRLST', fmt(q.l, 2, true) + ' ℃', q.zl, q.pl)}</div>`;
      h += `<p class="note">100m 격자 한 칸(1ha) 단위입니다. 주거 지붕이 ${nf.format(GT.meta.thr)}m² 이상인 ${nf.format(GT.meta.N)}칸 안에서 비교했습니다.</p>`;
    }
    if (q.o && F[q.o]) h += `<div><button class="btn" id="goOA" data-oa="${q.o}">이 격자가 속한 집계구 보기</button></div>`;
    if (ENV === 'site') h += '<div><button class="btn" id="copyLink">이 격자 링크 복사</button></div>';
    $('#dBody').innerHTML = h;
    $('#detail').hidden = false; $('.mapwrap').classList.add('has-detail');
    $('#dBody').scrollTop = 0;
    const go = $('#goOA'); if (go) go.onclick = () => { S.track = 't1'; renderPrio(); if (S.tab === 'table') renderTable(); restyle(); select(go.dataset.oa); };
    const cl = $('#copyLink'); if (cl) cl.onclick = () => copyText(location.href.split('#')[0] + '#' + q.id, '링크를 복사했습니다.');
  }

  function renderDetail() {
    if (isCell(S.sel)) { renderCellDetail(); return; }
    const p = F[S.sel].properties;
    $('#dName').textContent = p.d;
    $('#dCode').textContent = '집계구 ' + p.c;
    let h = '';
    if (p.s !== 'ok') {
      h += `<div class="badges"><span class="badge"><i style="background:var(--excl)"></i>점수 없음 · ${esc(EXCL_SHORT[p.s])}</span></div>`;
      h += `<p class="why">${esc(EXCL_TXT[p.s])}</p>`;
      h += `<div class="people"><div><b class="num">${p.pop ? nf.format(p.pop) : '–'}</b><span>인구(명)</span></div>`;
      h += `<div><b class="num">${p.eld !== undefined ? fmt(p.eld, 1) + '%' : '–'}</b><span>65세 이상 비율</span></div></div>`;
    } else {
      h += `<div class="badges">${p.k1 ? '<span class="badge hot" style="color:var(--t1)"><i style="background:var(--t1)"></i>Track 1 상위 10%</span>' : '<span class="badge">Track 1 상위 10% 밖</span>'}</div>`;
      const n2 = T2BYOA[p.c] || 0;
      h += `<div class="ranks"><div><span>Track 1 단기 구호</span><b class="num">${p.r1}</b><span class="num">/ 832위 · 점수 ${fmt(p.t1, 2, true)}</span></div>`;
      h += `<div><span>Track 2 상위 격자</span><b class="num">${n2}</b><span class="num">칸 (100m 격자로 계산)</span></div></div>`;
      h += `<div class="people"><div><b class="num">${nf.format(p.pop)}</b><span>인구(명)</span></div><div><b class="num">${nf.format(p.e65)}</b><span>65세 이상(명)</span></div>`;
      h += `<div><b class="num">${nf.format(Math.round(p.ho))}<small style="font-weight:500;color:var(--muted)"> / ${nf.format(Math.round(p.ht))}</small></b><span>노후 / 전체 주택(호)</span></div></div>`;
      const ul = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
      if (p.k1) h += `<div class="box policy"><h3>검토할 수 있는 대응</h3>${ul(POLICY.t1)}</div>`;
      h += `<div class="metrics">${['abs', 'eld', 'drl', 'dnb', 'old', 'savi', 'dem'].map((k) => metricRow(k, p)).join('')}</div>`;
      h += '<p class="note">막대는 분석 대상 832곳 안에서의 위치입니다. 지표면온도는 기온이 아닙니다.</p>';
      if (n2) h += `<div><button class="btn" id="goT2">이 집계구의 Track 2 격자 보기</button></div>`;
    }
    if (ENV === 'site') h += '<div><button class="btn" id="copyLink">이 집계구 링크 복사</button></div>';
    $('#dBody').innerHTML = h;
    $('#detail').hidden = false; $('.mapwrap').classList.add('has-detail');
    $('#dBody').scrollTop = 0;
    const g2 = $('#goT2'); if (g2) g2.onclick = () => { setTrack('t2'); zoomTo(p.c); };
    const cl = $('#copyLink'); if (cl) cl.onclick = () => copyText(location.href.split('#')[0] + '#' + p.c, '링크를 복사했습니다.');
  }

  // ---------------------------------------------------------------- side panes
  function legendRow(color, label, extra = '') {
    return `<div class="row"><span class="sw${extra}" style="background:${color}"></span><span>${label}</span></div>`;
  }
  function trackRows() {
    return OK.filter((f) => f.properties.k1).sort((a, b) => a.properties.r1 - b.properties.r1);
  }
  const sum = (arr, k) => arr.reduce((s, f) => s + (f.properties[k] || 0), 0);

  function renderPrio() {
    $$('#trackSeg button, #trackSeg2 button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.track === S.track)));
    const ul = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (S.track === 't2') {
      const M = GT.meta, top = GT.cells.filter((q) => q.k);
      $('#prioStat').innerHTML = `<div><b class="num">${M.top}칸</b><span>상위 10% 격자</span></div><div><b class="num">${M.old_top_ha}ha</b><span>노후 주거 지붕</span></div><div><b class="num">${M.ndev}칸</b><span>재건축·신개발(제외)</span></div>`;
      $('#prioLead').textContent = '100m 격자 단위로 봅니다. 오래된 주거 지붕이 몰려 있고, 5년 사이 건물이 늘거나 주변보다 더 뜨거워진 곳입니다. 쿨루프·녹화 같은 환경 개선 사업 후보입니다.';
      const R = RAMP.t2;
      let lg = legendRow(R[3], `상위 10% (${M.top}칸) — 굵은 테두리`) + legendRow(R[2], '상위 10~25%') + legendRow(R[1], '상위 25~50%') + legendRow(R[0], '하위 50% (옅게 표시)');
      lg += legendRow('var(--excl)', `재건축·신개발 진행 (${M.ndev}칸) — 순위에서 제외`, ' dash');
      lg += `<p class="note">주거 지붕이 ${nf.format(M.thr)}m² 이상인 격자 ${nf.format(M.N)}칸만 칠했습니다. 집계구 경계는 선으로만 표시합니다.</p>`;
      $('#prioLegend').innerHTML = `<div class="label">범례</div>${lg}`;
      $('#prioPolicy').innerHTML = `<h3>검토할 수 있는 대응</h3><div class="pol-g"><b>상위 격자 · 노후 주거지</b>${ul(POLICY.t2)}</div><div class="pol-g"><b>재건축·신개발 진행 격자</b>${ul(POLICY.dev)}</div>`;
      $('#prioFormula').innerHTML = `<b>점수</b> = Z(건물밀도 변화 ΔNDBI) + Z(노후 주거 지붕 면적) + Z(상대 지표면온도 변화 ΔRLST). 격자 ${nf.format(M.N)}칸의 평균이 0입니다. 노후 지붕은 ${M.old_year}년 이전 사용승인 주거용 건물(국토교통부 건물통합정보)입니다.`;
      const show = top.slice(0, 20);
      $('#topLabel').textContent = `상위 ${show.length}칸`;
      $('#topList').innerHTML = show.map((q) => `<button data-code="${q.id}"><span class="rk num">${q.r}</span><span>${esc(q.d || '북구')}<small>노후 지붕 ${nf.format(q.a)}m² · ΔRLST ${fmt(q.l, 1, true)}℃</small></span><span class="num">${fmt(q.s, 2, true)}</span></button>`).join('');
      return;
    }
    const rows = trackRows();
    const nEx = D.features.length - OK.length;
    $('#prioStat').innerHTML = `<div><b class="num">${rows.length}곳</b><span>상위 10% 집계구</span></div><div><b class="num">${nf.format(sum(rows, 'pop'))}</b><span>거주 인구(명)</span></div><div><b class="num">${nf.format(sum(rows, 'e65'))}</b><span>65세 이상(명)</span></div>`;
    $('#prioLead').textContent = '올여름 바로 손쓸 곳입니다. 2025년 여름 지표면이 뜨겁고 어르신 비율이 높은 집계구를 위에서부터 보여 줍니다.';
    const R = RAMP.t1;
    let lg = legendRow(R[3], `상위 10% (${META.top}곳) — 굵은 테두리`) + legendRow(R[2], '상위 10~25%') + legendRow(R[1], '상위 25~50%') + legendRow(R[0], '하위 50% (옅게 표시)');
    lg += legendRow('var(--excl)', `점수 없음 (${nEx}곳) — 누르면 이유가 나옵니다`);
    $('#prioLegend').innerHTML = `<div class="label">범례</div>${lg}`;
    $('#prioPolicy').innerHTML = `<h3>검토할 수 있는 대응</h3>${ul(POLICY.t1)}`;
    $('#prioFormula').innerHTML = '<b>점수</b> = Z(2025 여름 평균 지표면온도) + Z(65세 이상 비율). 0이 북구 평균입니다.';
    const show = rows.slice(0, 20);
    $('#topLabel').textContent = `상위 ${show.length}곳`;
    $('#topList').innerHTML = show.map((f) => {
      const p = f.properties;
      return `<button data-code="${p.c}"><span class="rk num">${p.r1}</span><span>${esc(p.d)}<small>65세 이상 ${fmt(p.eld, 1)}% · ${p.c}</small></span><span class="num">${fmt(p.t1, 2, true)}</span></button>`;
    }).join('');
  }

  function renderInd() {
    const I = IND[S.ind];
    $$('#indList input').forEach((r) => { r.checked = r.value === S.ind; });
    $('#gridWrap').hidden = !I.grid;
    $('#gridChk').checked = S.grid;
    if (I.grid) $('#gridTxt').textContent = I.grid === 'rl25' ? '100m 격자로 보기 (2025 북구 평균 대비 온도)' : '100m 격자로 보기 (2020→2025 상대온도 변화)';
    let lg = '';
    if (S.grid && I.grid) {
      const br = RM.grid[I.grid], cols = RM.grid.colors;
      const lab = (i) => (i === 0 ? `${fmt(br[0], 1)}℃ 미만` : i === cols.length - 1 ? `${fmt(br[br.length - 1], 1, true)}℃ 이상` : `${fmt(br[i - 1], 1, true)} ~ ${fmt(br[i], 1, true)}℃`);
      lg = cols.slice().reverse().map((c, j) => legendRow(c, lab(cols.length - 1 - j))).join('');
      lg = `<div class="label">${I.grid === 'rl25' ? '2025 여름, 북구 평균과의 차이' : '상대온도 변화 2020→2025'}</div>${lg}`;
      lg += `<p class="note">100m 격자 11,809개. 산·강을 포함한 북구 전체 평균이 0입니다. 집계구 경계는 선으로만 표시합니다.</p>`;
    } else {
      const R = RAMP[I.ramp], br = I.breaks;
      const u = I.unit;
      const lab = (i) => {
        if (i === 0) return `${fmt(br[0], I.nd, I.signed)}${u} 미만`;
        if (i === br.length) return `${fmt(br[br.length - 1], I.nd, I.signed)}${u} 이상`;
        return `${fmt(br[i - 1], I.nd, I.signed)} ~ ${fmt(br[i], I.nd, I.signed)}${u}`;
      };
      lg = R.map((c, i) => legendRow(c, lab(i))).reverse().join('');
      lg = `<div class="label">${esc(I.name)}${I.q ? ' · 5분위' : ''}</div>${lg}`;
      lg += legendRow('var(--excl)', S.ind === 'eld' ? '거주 인구 없음' : '값 없음 (분석 제외)');
    }
    $('#indLegend').innerHTML = lg;
    $('#indNote').innerHTML = `<h3>${esc(I.name)}</h3><p class="why">${esc(I.desc)}</p><p class="note">북구 832곳 평균 ${fmt(META.mean[S.ind], I.nd, I.signed)}${I.unit} · 범위 ${fmt(META.ranges[S.ind][0], I.nd, I.signed)} ~ ${fmt(META.ranges[S.ind][1], I.nd, I.signed)}${I.unit}</p>`;
  }

  function renderComp() {
    const rows = OK.slice().sort((a, b) => b.properties.dnb - a.properties.dnb).slice(0, 8);
    $('#chgList').innerHTML = rows.map((f, i) => {
      const p = f.properties;
      return `<button data-code="${p.c}"><span class="rk num">${i + 1}</span><span>${esc(p.d)}<small>${p.c}</small></span><span class="num">ΔNDBI ${fmt(p.dnb, 3, true)}</span></button>`;
    }).join('');
    $('#compOutline').checked = S.compOutline;
  }

  // table
  const COLS = {
    t1: [['순위', (p) => p.r1], ['행정동', (p) => esc(p.d)], ['점수', (p) => fmt(p.t1, 2, true)], ['지표면온도', (p) => fmt(p.abs, 1) + '℃'], ['65세+', (p) => fmt(p.eld, 1) + '%'], ['인구', (p) => nf.format(p.pop)], ['집계구 코드', (p) => p.c]],
    t2: [['순위', (q) => q.r], ['행정동', (q) => esc(q.d || '')], ['점수', (q) => fmt(q.s, 2, true)], ['ΔNDBI', (q) => fmt(q.n, 3, true)], ['노후 지붕', (q) => nf.format(q.a)], ['ΔRLST', (q) => fmt(q.l, 2, true)]],
  };
  function tableRows() {
    const q = $('#tq').value.trim();
    if (S.track === 't2') {
      let rows = S.scope === 'top' ? GT.cells.filter((c) => c.k) : GT.cells.slice();
      if (q) rows = rows.filter((c) => (c.d || '').includes(q) || (c.o || '').includes(q));
      return rows;
    }
    let rows = S.scope === 'top' ? trackRows() : OK.slice().sort((a, b) => a.properties.r1 - b.properties.r1);
    if (q) rows = rows.filter((f) => f.properties.d.includes(q) || f.properties.c.includes(q));
    return rows.map((f) => f.properties);
  }
  function renderTable() {
    $$('#scopeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === S.scope)));
    const cols = COLS[S.track], t2 = S.track === 't2';
    $('#tblHead').innerHTML = cols.map((c) => `<th scope="col">${c[0]}</th>`).join('');
    const rows = tableRows();
    $('#tblBody').innerHTML = rows.map((p) => {
      const id = t2 ? p.id : p.c;
      return `<tr data-code="${id}" tabindex="0"${id === S.sel ? ' class="sel"' : ''}>${cols.map((c, i) => `<td${i === 1 ? '' : ' class="num"'}>${c[1](p)}</td>`).join('')}</tr>`;
    }).join('') || `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--muted)">맞는 ${t2 ? '격자' : '집계구'}가 없습니다.</td></tr>`;
    $('#tblCount').textContent = t2 ? `${nf.format(rows.length)}칸 · Track 2 순위 순 (100m 격자) · 노후 지붕 m², ΔRLST ℃` : `${rows.length}곳 · Track 1 순위 순`;
  }
  function csv() {
    if (S.track === 't2') {
      const head = ['격자ID', '행정동', '집계구코드', '격자중심위도', '격자중심경도', '주거지붕m2', '노후주거지붕m2', '건물밀도변화dNDBI', '상대온도변화dRLST', 'Track2점수', 'Track2순위', 'Track2상위10%'];
      return [head.join(',')].concat(tableRows().map((q) => [q.id, q.d || '', q.o || '', q.la, q.lo, q.t, q.a, q.n, q.l, q.s, q.r, q.k ? 'Y' : ''].join(','))).join('\n');
    }
    const head = ['집계구코드', '행정동', '인구', '65세이상인구', '65세이상비율', '2025여름평균지표면온도', 'Track1점수', 'Track1순위', 'Track1상위10%', '상대온도변화dRLST', '건물밀도변화dNDBI', '노후주택비율', 'SAVI2025', '평균고도DEM'];
    const lines = tableRows().map((p) => [p.c, p.d, p.pop, p.e65, p.eld, p.abs, p.t1, p.r1, p.k1 ? 'Y' : '', p.drl, p.dnb, p.old, p.savi, p.dem].join(','));
    return [head.join(',')].concat(lines).join('\n');
  }

  // ---------------------------------------------------------------- tabs
  function setTab(tab) {
    S.tab = tab;
    $$('.tabs [role=tab]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $$('.pane').forEach((p) => { p.hidden = p.id !== 'pane-' + tab; });
    if (tab === 'prio') renderPrio();
    if (tab === 'ind') renderInd();
    if (tab === 'comp') renderComp();
    if (tab === 'table') renderTable();
    restyle();
  }
  function setTrack(tr) {
    S.track = tr; renderPrio(); if (S.tab === 'table') renderTable(); restyle();
  }

  // ---------------------------------------------------------------- search
  function setupSearch() {
    const q = $('#q'), box = $('#sugg');
    let items = [], on = -1;
    const pick = (it) => {
      box.hidden = true; q.value = it.label;
      if (it.type === 'dong') {
        const b = it.bbox; map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [30, 30] });
        if (narrow()) $('.mapwrap').scrollIntoView({ behavior: 'smooth' });
      } else select(it.code);
    };
    const render = () => {
      box.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" class="${i === on ? 'on' : ''}" role="option"><span>${esc(it.label)}</span><small>${esc(it.sub)}</small></button>`).join('');
      box.hidden = !items.length;
    };
    q.addEventListener('input', () => {
      const v = q.value.trim(); on = -1;
      if (!v) { items = []; render(); return; }
      const ds = DONGS.filter((d) => d.name.includes(v)).slice(0, 6).map((d) => ({ type: 'dong', label: d.name, sub: `집계구 ${d.n}곳`, bbox: d.bbox }));
      let os = [];
      if (/^\d{3,}$/.test(v)) os = D.features.filter((f) => f.properties.c.includes(v)).slice(0, 8).map((f) => ({ type: 'oa', code: f.properties.c, label: f.properties.c, sub: f.properties.d }));
      items = ds.concat(os); render();
    });
    q.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { on = Math.min(items.length - 1, on + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { pick(items[Math.max(0, on)]); e.preventDefault(); }
      else if (e.key === 'Escape') { box.hidden = true; }
    });
    box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(items[+b.dataset.i]); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.hidden = true; });
  }

  // ---------------------------------------------------------------- tooltip
  function tip(p) {
    if (p.s !== 'ok') return `<b>${esc(p.d)}</b> · 점수 없음 (${EXCL_SHORT[p.s]})`;
    if (S.tab === 'ind') {
      const I = IND[S.ind];
      return `<b>${esc(p.d)}</b> · ${esc(I.short)} <span class="num">${fmt(p[S.ind], I.nd, I.signed)}${I.unit}</span>`;
    }
    if (S.track === 't2') return `<b>${esc(p.d)}</b> · Track 2 상위 격자 ${T2BYOA[p.c] || 0}칸`;
    return `<b>${esc(p.d)}</b> · Track 1 ${p.r1}위${p.k1 ? ' · 상위 10%' : ''}`;
  }
  function cellTip(q) {
    if (q.dev) return `<b>${esc(q.d || '북구')}</b> · 재건축·신개발 진행 (순위 제외)`;
    return `<b>${esc(q.d || '북구')}</b> · Track 2 ${q.r}위${q.k ? ' · 상위 10%' : ''} · 노후 지붕 ${nf.format(q.a)}m²`;
  }

  // ---------------------------------------------------------------- init
  let topRenderer;
  async function init() {
    try {
      const get = (n) => fetch(`data/${n}.json`).then((r) => { if (!r.ok) throw new Error(n + ' ' + r.status); return r.json(); });
      [D, META, DONGS, RM, GT] = await Promise.all(['oa', 'meta', 'dongs', 'raster_meta', 'grid_t2'].map(get));
    } catch (e) {
      $('#loading').textContent = '자료를 불러오지 못했습니다. 새로고침해 주세요.'; return;
    }
    IND = {
      abs: { name: '2025 여름 평균 지표면온도', short: '지표면온도', unit: '℃', nd: 1, ramp: 'abs', breaks: META.breaks.abs, q: true, grid: 'rl25',
        desc: '2025년 5~9월 Landsat 8 관측의 평균입니다. 오전 11시 무렵 땅·지붕 표면의 온도라 기온과 다르고 훨씬 높게 나옵니다. Track 1의 노출도 지표입니다.' },
      eld: { name: '65세 이상 인구 비율', short: '65세 이상', unit: '%', nd: 1, ramp: 'eld', breaks: META.breaks.eld, q: true,
        desc: 'SGIS 2024 집계구 통계로 65세 이상 인구를 총인구로 나눈 값입니다. Track 1의 민감도 지표입니다. 온도 자료가 없어 점수에서 빠진 집계구도 여기에서는 비율을 보여 줍니다.' },
      drl: { name: '상대 지표면온도 변화 ΔRLST', short: 'ΔRLST', unit: '℃', nd: 2, signed: true, ramp: 'div', breaks: [-2, -1, -0.25, 0.25, 1, 2], grid: 'drl',
        desc: '2020년과 2025년 각각 북구 평균과의 온도 차이를 구한 뒤 그 차이가 얼마나 변했는지 봅니다. 장마였던 2020년과 폭염이던 2025년의 날씨 차이를 빼고, 주변보다 더 뜨거워졌는지를 보여 줍니다. Track 2는 이 값을 100m 격자로 씁니다.' },
      dnb: { name: '건물밀도 변화 ΔNDBI', short: 'ΔNDBI', unit: '', nd: 3, signed: true, ramp: 'div', breaks: [-0.05, -0.02, -0.005, 0.005, 0.02, 0.05],
        desc: '2020→2025년 Landsat 8 NDBI(정규 건물 지수)의 변화입니다. 양수는 건물·포장이 늘었다는 뜻이고, 신규 택지에서 크게 나타납니다. Track 2는 이 값을 100m 격자로 씁니다.' },
      old: { name: '노후 주택 비율', short: '노후 주택', unit: '%', nd: 1, ramp: 'old', breaks: META.breaks.old,
        desc: 'SGIS 2024 건축연도별 주택 통계로, 1999년 이전(건축 후 25년 이상)에 지은 주택의 비율입니다. 참고용입니다. Track 2는 같은 기준(1999년 이전)을 건물통합정보의 지붕 면적으로 바꿔 100m 격자에서 계산합니다.' },
      savi: { name: '식생지수 SAVI (2025)', short: 'SAVI', unit: '', nd: 3, ramp: 'savi', breaks: META.breaks.savi, q: true,
        desc: 'Sentinel-2 10m 영상으로 구한 토양조정 식생지수입니다. 클수록 녹지가 많습니다. 우선순위 점수에는 들어가지 않지만, 집계구 분석에서 지표면온도를 가장 크게 낮추는 요인이었습니다.' },
    };
    IND.dem = { name: '평균 고도', short: '고도', unit: 'm', nd: 0 };
    D.features.forEach((f) => { F[f.properties.c] = f; if (f.properties.s === 'ok') OK.push(f); });
    const cellFeat = (q, dev) => ({ type: 'Feature', properties: Object.assign({ dev: !!dev }, q), geometry: { type: 'Polygon', coordinates: [q.c.map(([la, lo]) => [lo, la]).concat([[q.c[0][1], q.c[0][0]]])] } });
    GT.cells.forEach((q) => { G[q.id] = cellFeat(q, false); if (q.k && q.o) T2BYOA[q.o] = (T2BYOA[q.o] || 0) + 1; });
    GT.dev.forEach((q) => { G[q.id] = cellFeat(q, true); });

    map = L.map('map', { zoomControl: true, preferCanvas: true, minZoom: 10, maxZoom: 18, attributionControl: true, zoomSnap: 0.25 });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    [['s2025', 250], ['s2020', 260], ['grid', 300], ['top', 450], ['sel', 460], ['labels', 470]].forEach(([n, z]) => {
      const p = map.createPane(n); p.style.zIndex = z; if (n !== 's2025') p.style.pointerEvents = 'none';
    });
    map.getPane('s2025').style.pointerEvents = 'none';
    const B = RM.bounds;
    const hot = L.geoJSON({ type: 'FeatureCollection', features: OK.filter((f) => f.properties.k1).concat(GT.cells.filter((q) => q.k).map((q) => G[q.id])) }).getBounds();
    HOME = hot.pad(0.08);
    map.fitBounds(HOME);
    const Home = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const d = L.DomUtil.create('div', 'leaflet-bar home-ctl');
        d.innerHTML = '<a href="#" role="button" title="북구 전체 보기" aria-label="북구 전체 보기">전체</a>';
        L.DomEvent.disableClickPropagation(d);
        d.firstChild.addEventListener('click', (e) => { e.preventDefault(); map.fitBounds(B, { padding: [10, 10] }); });
        return d;
      },
    });
    new Home().addTo(map);

    s2[2025] = L.imageOverlay('data/s2_2025.webp', B, { pane: 's2025', attribution: 'Sentinel-2 &copy; Copernicus (가공)' });
    s2[2020] = L.imageOverlay('data/s2_2020.webp', B, { pane: 's2020' });
    gridLayers.rl25 = L.imageOverlay('data/grid_rl25.png', B, { pane: 'grid', className: 'px' });
    gridLayers.drl = L.imageOverlay('data/grid_drl.png', B, { pane: 'grid', className: 'px' });
    setupTiles();

    oaRenderer = L.canvas({ padding: 0.4 });
    topRenderer = L.canvas({ padding: 0.4, pane: 'top' });
    oaLayer = L.geoJSON(D, {
      renderer: oaRenderer, style: styleFor_layer,
      onEachFeature: (f, layer) => {
        layer.bindTooltip(() => tip(f.properties), { sticky: true, className: 'tip', direction: 'top', offset: [0, -8], opacity: 1 });
        layer.on('click', () => select(f.properties.c, { zoom: false, scroll: false }));
        layer.on('mouseover', () => layer.setStyle({ weight: 2, color: css('--ink'), opacity: 1 }));
        layer.on('mouseout', () => oaLayer.resetStyle(layer));
      },
      attribution: '집계구 경계·통계 &copy; 통계청 SGIS',
    }).addTo(map);
    t2Layer = L.geoJSON({ type: 'FeatureCollection', features: GT.cells.slice().reverse().map((q) => G[q.id]).concat(GT.dev.map((q) => G[q.id])) }, {
      renderer: oaRenderer, style: cellStyle,
      onEachFeature: (f, layer) => {
        layer.bindTooltip(() => cellTip(f.properties), { sticky: true, className: 'tip', direction: 'top', offset: [0, -8], opacity: 1 });
        layer.on('click', () => select(f.properties.id, { zoom: false, scroll: false }));
        layer.on('mouseover', () => layer.setStyle({ weight: 1.6, color: css('--ink'), opacity: 1 }));
        layer.on('mouseout', () => t2Layer.resetStyle(layer));
      },
      attribution: '건물 &copy; 국토교통부 GIS건물통합정보',
    });
    topLayers = L.layerGroup().addTo(map);
    selLayer = L.featureGroup().addTo(map);

    // dong labels
    const acc = {};
    oaLayer.eachLayer((l) => {
      const c = l.getBounds().getCenter(), d = l.feature.properties.d;
      const a = acc[d] || (acc[d] = [0, 0, 0]); a[0] += c.lat; a[1] += c.lng; a[2]++;
    });
    labels = L.layerGroup(Object.entries(acc).map(([d, a]) => L.marker([a[0] / a[2], a[1] / a[2]], {
      pane: 'labels', interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'dl', html: `<span class="dong-label">${esc(d)}</span>`, iconSize: [0, 0] }),
    })));
    const lab = () => { const on = map.getZoom() >= 13; if (on && !map.hasLayer(labels)) labels.addTo(map); if (!on && map.hasLayer(labels)) map.removeLayer(labels); };
    map.on('zoomend', lab); lab();

    // UI wiring
    $('#indList').innerHTML = ['abs', 'eld', 'drl', 'dnb', 'old', 'savi'].map((k) => `<label><input type="radio" name="ind" value="${k}"><span>${esc(IND[k].name)}<small>${{ abs: 'Track 1 · 노출도', eld: 'Track 1 · 민감도', drl: 'Track 2 구성 · 온도 변화', dnb: 'Track 2 구성 · 개발 변화', old: '참고 · 노후 주택 통계', savi: '참고 · 녹지' }[k]}</small></span></label>`).join('');
    $('#indList').addEventListener('change', (e) => { S.ind = e.target.value; if (!IND[S.ind].grid) S.grid = false; renderInd(); restyle(); });
    $('#gridChk').addEventListener('change', (e) => { S.grid = e.target.checked; renderInd(); restyle(); });
    $('#compOutline').addEventListener('change', (e) => { S.compOutline = e.target.checked; restyle(); });
    $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('.tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = $$('.tabs [role=tab]'), i = tabs.findIndex((t) => t.dataset.tab === S.tab);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; setTab(n.dataset.tab); n.focus(); e.preventDefault();
    });
    $$('#trackSeg button, #trackSeg2 button').forEach((b) => b.addEventListener('click', () => setTrack(b.dataset.track)));
    $$('#scopeSeg button').forEach((b) => b.addEventListener('click', () => { S.scope = b.dataset.scope; renderTable(); }));
    $('#tq').addEventListener('input', renderTable);
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]'); if (g) { S.scope = 'top'; setTab(g.dataset.goto); return; }
      const b = e.target.closest('.toplist button[data-code]'); if (b) select(b.dataset.code);
    });
    $('#tblBody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-code]'); if (tr) select(tr.dataset.code); });
    $('#tblBody').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-code]'); if (tr) select(tr.dataset.code); } });
    $('#copyCsv').addEventListener('click', () => copyText(csv(), `${nf.format(tableRows().length)}${S.track === 't2' ? '칸' : '곳'}을 CSV로 복사했습니다. 엑셀에 붙여 넣을 수 있습니다.`));
    /*DL-START*/
    if (ENV === 'site') {
      $('#dlCsv').hidden = false;
      $('#dlCsv').addEventListener('click', () => {
        const blob = new Blob(['﻿' + csv()], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `bukgu_heat_priority_${S.track === 't2' ? 't2_grid100m' : 't1'}_${S.scope}.csv`; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      });
    }
    /*DL-END*/
    $('#copyMail').addEventListener('click', () => copyText('cnu123@jnu.ac.kr', '메일 주소를 복사했습니다.'));
    $('#dClose').addEventListener('click', closeDetail);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#detail').hidden) closeDetail(); });
    $$('.basemap [data-base]').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) { S.base = b.dataset.base; applyBase(); } }));
    $('#opacity').addEventListener('input', (e) => { S.op = +e.target.value; restyle(); });
    ['mousedown', 'touchstart', 'dblclick', 'wheel'].forEach((ev) => { $('.basemap').addEventListener(ev, (e) => e.stopPropagation()); $('#detail').addEventListener(ev, (e) => e.stopPropagation()); });
    setupSwipe();
    setupSearch();

    // theme changes → recolour
    const reTheme = () => { restyle(); };
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reTheme); } catch (e) { /* old browsers */ }
    new MutationObserver(reTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('resize', () => map.invalidateSize());

    // deep link: #t1 #t2 #ind #comp #table #about, a 14-digit OA code, or a grid cell id (#g45_27)
    let h = '';
    try { h = (location.hash || '').slice(1); } catch (e) { /* ignore */ }
    if (['t1', 't2'].includes(h)) S.track = h;
    if (G[h]) S.track = 't2';
    setTab(['ind', 'comp', 'table', 'about'].includes(h) ? h : 'prio');
    if ((/^\d{14}$/.test(h) && F[h]) || G[h]) select(h, { scroll: false });
    $('#loading').hidden = true;
    setTimeout(() => map.invalidateSize(), 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

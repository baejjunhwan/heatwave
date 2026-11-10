const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com|arcgisonline|openstreetmap/, (r) => r.abort());
  await p.goto('http://localhost:8767/#ind'); await p.waitForSelector('#loading[hidden]', { state: 'attached' }); await p.waitForTimeout(800);
  const box = await p.locator('#map').boundingBox();
  for (const k of ['drl', 'dnb', 'oldr', 'abs100', 'savi10', 'abs']) {
    await p.check(`#indList input[value=${k}]`); await p.waitForTimeout(1200);
    const out = [];
    for (const [fx, fy] of [[0.45, 0.6], [0.6, 0.55]]) {
      await p.mouse.move(box.x + box.width * fx, box.y + box.height * fy); await p.waitForTimeout(200);
      await p.mouse.move(box.x + box.width * fx + 3, box.y + box.height * fy + 2); await p.waitForTimeout(300);
      out.push(await p.evaluate(() => (document.querySelector('.leaflet-tooltip') || {}).innerText || 'no tip'));
    }
    console.log(k, '|', out.join(' | '), '| gridChk visible:', await p.isVisible('#gridWrap'));
    await p.screenshot({ path: `g_${k}.png` });
  }
  console.log(errs.join('\n') || 'no page errors'); await b.close();
})();

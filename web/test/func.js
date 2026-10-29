const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = []; const res = {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com|arcgisonline|openstreetmap/, (r) => r.abort());
  await p.goto('http://localhost:8767/'); await p.waitForSelector('#loading[hidden]', { state: 'attached' });
  // tab keyboard nav
  await p.focus('#tab-prio'); await p.keyboard.press('ArrowRight'); res.tabKey = await p.evaluate(() => document.querySelector('[aria-selected=true]').dataset.tab);
  // swipe drag
  await p.click('#tab-comp'); await p.waitForTimeout(300);
  const k = await p.locator('.swipe .knob').boundingBox();
  await p.mouse.move(k.x + k.width / 2, k.y + k.height / 2); await p.mouse.down(); await p.mouse.move(k.x - 300, k.y + 18, { steps: 8 }); await p.mouse.up();
  res.swipeAfterDrag = await p.evaluate(() => [document.querySelector('.swipe .knob').getAttribute('aria-valuenow'), document.querySelector('.leaflet-pane.leaflet-s2020-pane').style.clip]);
  await p.focus('.swipe .knob'); await p.keyboard.press('ArrowRight'); res.swipeKey = await p.evaluate(() => document.querySelector('.swipe .knob').getAttribute('aria-valuenow'));
  // search
  await p.fill('#q', '오치'); await p.waitForTimeout(200); res.sugg = await p.locator('#sugg button').count();
  await p.keyboard.press('Escape');
  // table + csv
  await p.click('#tab-table'); await p.fill('#tq', '문화동'); await p.waitForTimeout(200); res.rows = await p.locator('#tblBody tr').count();
  await p.click('#copyCsv'); await p.waitForTimeout(300);
  res.clip = (await p.evaluate(() => navigator.clipboard.readText())).split('\n').length;
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dlCsv')]);
  const fs = require('fs'); const path = await dl.path(); const txt = fs.readFileSync(path, 'utf8');
  res.download = [dl.suggestedFilename(), txt.split('\n').length, txt.split('\n')[0].split(',').length, txt.charCodeAt(0) === 0xfeff];
  // enter on row
  await p.locator('#tblBody tr').first().focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  res.detailOpen = await p.isVisible('#detail'); res.hash = await p.evaluate(() => location.hash);
  await p.keyboard.press('Escape'); res.detailClosed = !(await p.isVisible('#detail'));
  console.log(JSON.stringify(res, null, 1)); console.log(errs.join('\n') || 'no page errors'); await b.close();
})();

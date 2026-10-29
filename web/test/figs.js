const { chromium } = require('playwright');
const OUT = 'screens'; require('fs').mkdirSync(OUT, {recursive: true});
(async () => {
  const b = await chromium.launch(); const errs = [];
  async function open(w, h, hash = '', dsf = 1.5) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, colorScheme: 'light' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com|arcgisonline|openstreetmap/, (r) => r.abort());
    await p.goto('http://localhost:8767/' + hash); await p.waitForSelector('#loading[hidden]', { state: 'attached' });
    await p.waitForTimeout(900); return p;
  }
  let p = await open(1440, 900);
  await p.screenshot({ path: `${OUT}/s2_prio.png` });
  p = await open(1440, 900, '#t2');
  await p.click('#topList button'); await p.waitForTimeout(1300);
  await p.screenshot({ path: `${OUT}/s3_detail.png` });
  p = await open(1440, 900, '#ind');
  await p.check('#gridChk'); await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/s4_grid.png` });
  p = await open(1440, 900, '#comp');
  await p.click('#chgList button'); await p.waitForTimeout(1300); await p.click('#dClose'); await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/s5_comp.png` });
  p = await open(1440, 900, '#table');
  await p.click('#trackSeg2 button[data-track=t2]'); await p.waitForTimeout(500);
  await p.locator('#tblBody tr').nth(1).click(); await p.waitForTimeout(1300);
  await p.screenshot({ path: `${OUT}/s6_table.png` });
  p = await open(390, 844, '', 2);
  await p.screenshot({ path: `${OUT}/m1.png` });
  await p.click('#topList button'); await p.waitForTimeout(1400);
  await p.screenshot({ path: `${OUT}/m2.png` });
  console.log(errs.join('\n') || 'no page errors'); await b.close();
})();

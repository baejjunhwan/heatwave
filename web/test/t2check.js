const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  async function open(w, h, hash = '', dsf = 1) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, colorScheme: 'light' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.route(/fonts\.(googleapis|gstatic)\.com|arcgisonline|openstreetmap/, (r) => r.abort());
    await p.goto('http://localhost:8767/' + hash); await p.waitForSelector('#loading[hidden]', { state: 'attached', timeout: 15000 });
    await p.waitForTimeout(900); return p;
  }
  let p = await open(1440, 900, '#t2');
  await p.screenshot({ path: 'n1_t2.png' });
  await p.click('#topList button'); await p.waitForTimeout(1300);
  await p.screenshot({ path: 'n2_t2_detail.png' });
  await p.click('#goOA'); await p.waitForTimeout(1300);
  await p.screenshot({ path: 'n3_oa_detail.png' });
  p = await open(1440, 900, '#table');
  await p.click('#trackSeg2 button[data-track="t2"]'); await p.waitForTimeout(600);
  await p.screenshot({ path: 'n4_table_t2.png' });
  const rows = await p.locator('#tblBody tr').count(); console.log('t2 table rows', rows, await p.textContent('#tblCount'));
  p = await open(1440, 900, '#g45_27'); await p.waitForTimeout(800); await p.screenshot({ path: 'n5_dev_link.png' });
  p = await open(1440, 900, ''); await p.screenshot({ path: 'n6_t1.png' });
  p = await open(390, 844, '#t2', 2); await p.screenshot({ path: 'n7_phone_t2.png' });
  console.log(errs.join('\n') || 'no page errors'); await b.close();
})();

// Drives the real phone page in Chromium during a live run. Page is opened once and never reloaded.
const path = require('node:path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { runLive } = require('/home/user/repo/demo/live');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const mk = async scheme => (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme })).newPage();
  const page = await mk('light'); const shots = [];
  const shot = async n => { await page.screenshot({ path: `${out}/${n}.png` }); shots.push(n); };
  const r = await runLive({ ownerKey: 'phone-check', log: () => {}, waitLimitMs: 20000, waitForOwner: async (what, base) => {
    if (what === 'home setup') {
      await page.goto(base + '/owner'); await shot('1-code');
      await page.fill('#code', 'phone-check'); await page.click('#login button');
      await page.getByText('Start keeping these promises?').waitFor(); await shot('2-setup');
      await page.click('.card .yes');
      await page.getByText('Done. Your home now follows this.').waitFor(); await shot('3-setup-done');
    } else {
      await page.getByText(/air fryer/).waitFor({ timeout: 10000 }); // arrives via polling, no reload
      await shot('4-air-fryer');
      const d = await mk('dark'); await d.goto(base + '/owner'); await d.fill('#code', 'phone-check'); await d.click('#login button');
      await d.getByText(/air fryer/).waitFor(); await d.screenshot({ path: `${out}/5-air-fryer-dark.png` }); shots.push('5-air-fryer-dark');
      await page.click('.card .no');
      await page.getByText("Okay, it won't happen.").waitFor(); await shot('6-declined');
    }
  } });
  console.log(JSON.stringify({ shots, setUp: r.setUp, airFryerOrdered: r.airFryerOrdered, orders: r.orders, chainOk: r.chainOk }));
  await browser.close();
})().catch(e => { console.error('PHONE CHECK FAILED', e); process.exit(1); });

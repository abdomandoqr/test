
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const URL = process.env.SCREENSHOT_URL;
function findSystemChromium() {
  const candidates = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const name of candidates) {
    try { const r = execSync('which ' + name, {encoding:'utf8', stdio:['pipe','pipe','ignore']}).trim(); if (r) return r; } catch {}
  }
}
const browser = await chromium.launch({ executablePath: findSystemChromium() });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
const style = await page.evaluate(() => {
  const st = document.querySelector('style');
  return st ? st.textContent.slice(0, 3000) : 'no style';
});
console.log(style);
await browser.close();

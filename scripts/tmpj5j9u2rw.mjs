
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
const info = await page.evaluate(() => {
  const h2 = document.querySelector('#services h2');
  const h1 = document.querySelector('#hero h1');
  return {
    h1: {
      className: h1.className,
      lineHeight: window.getComputedStyle(h1).lineHeight,
      fontSize: window.getComputedStyle(h1).fontSize,
    },
    h2: {
      className: h2.className,
      lineHeight: window.getComputedStyle(h2).lineHeight,
      fontSize: window.getComputedStyle(h2).fontSize,
    },
    hasLeadingTight: !!document.querySelector('style')?.textContent?.includes('.leading-tight'),
    tailwindStyleLength: document.querySelector('style')?.textContent?.length || 0,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();

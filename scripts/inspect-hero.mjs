import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const URL = process.env.SCREENSHOT_URL || 'http://localhost:8081/index.html';

function findSystemChromium() {
  const candidates = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const name of candidates) {
    try {
      const resolved = execSync(`which ${name}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (resolved) return resolved;
    } catch {}
  }
}

const browser = await chromium.launch({ executablePath: findSystemChromium() });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });

const info = await page.evaluate(() => {
  const h1 = document.querySelector('#hero h1');
  const rect = h1.getBoundingClientRect();
  return {
    innerHTML: h1.innerHTML.slice(0, 800),
    textContent: h1.textContent.slice(0, 200),
    clientHeight: h1.clientHeight,
    scrollHeight: h1.scrollHeight,
    offsetHeight: h1.offsetHeight,
    rectHeight: rect.height,
    lineHeight: window.getComputedStyle(h1).lineHeight,
    width: rect.width,
  };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();

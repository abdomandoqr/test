import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

const URL = process.env.SCREENSHOT_URL || 'http://localhost:8081/index.html';
const OUTPUT_DIR = process.env.SCREENSHOT_DIR || path.resolve(process.cwd(), 'temporary-screenshots');

const SECTIONS = [
  { name: 'hero', selector: '#hero' },
  { name: 'services', selector: '#services' },
  { name: 'why', selector: '#why' },
  { name: 'testimonials', selector: '#testimonials' },
  { name: 'cta', selector: '#contact' },
  { name: 'footer', selector: 'footer' },
];

async function takeSectionScreenshots() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`Launching Chromium…`);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || findSystemChromium();
  if (executablePath) {
    console.log(`Using system Chromium: ${executablePath}`);
  }
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined);

  try {
    const page = await browser.newPage();
    console.log(`Navigating to ${URL}…`);
    await page.goto(URL, { waitUntil: 'networkidle' });

    // Desktop sections
    for (const section of SECTIONS) {
      const outputPath = path.join(OUTPUT_DIR, `${section.name}.png`);
      const element = await page.locator(section.selector).first();
      await element.scrollIntoViewIfNeeded();
      await element.screenshot({ path: outputPath });
      console.log(`Saved ${section.name} screenshot to ${outputPath}`);
    }

    // Mobile full-page
    const mobilePath = path.join(OUTPUT_DIR, 'mobile-full-page.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: mobilePath, fullPage: true });
    console.log(`Saved mobile full-page screenshot to ${mobilePath}`);
  } finally {
    await browser.close();
  }
}

function findSystemChromium() {
  const candidates = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const name of candidates) {
    try {
      const resolved = execSync(`which ${name}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (resolved) return resolved;
    } catch {
      // not found, try next
    }
  }
  return undefined;
}

takeSectionScreenshots().catch((error) => {
  console.error('Section screenshots failed:', error);
  process.exit(1);
});

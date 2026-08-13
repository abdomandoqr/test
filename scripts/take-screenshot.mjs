import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

const URL = process.env.SCREENSHOT_URL || 'http://localhost:8081';
const OUTPUT_DIR = process.env.SCREENSHOT_DIR || path.resolve(process.cwd(), 'temporary-screenshots');

async function takeScreenshot() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `screenshot-${timestamp}.png`);

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

    console.log(`Taking screenshot…`);
    await page.screenshot({ path: outputPath, fullPage: true });

    console.log(`Saved screenshot to ${outputPath}`);
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

takeScreenshot().catch((error) => {
  console.error('Screenshot failed:', error);
  process.exit(1);
});

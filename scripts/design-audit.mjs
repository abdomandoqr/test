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
  return undefined;
}

async function audit() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || findSystemChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined);
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });

  const data = await page.evaluate(() => {
    const getStyle = (el, prop) => window.getComputedStyle(el)[prop];
    const bbox = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return {
        selector: sel,
        width: Math.round(r.width),
        height: Math.round(r.height),
        top: Math.round(r.top + window.scrollY),
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        backgroundColor: s.backgroundColor,
        textAlign: s.textAlign,
      };
    };

    const cards = [...document.querySelectorAll('#services article')].map((el, i) => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return { index: i, width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) };
    });

    const testimonials = [...document.querySelectorAll('#testimonials article')].map((el, i) => {
      const r = el.getBoundingClientRect();
      return { index: i, width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) };
    });

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      hero: bbox('#hero'),
      services: bbox('#services'),
      why: bbox('#why'),
      testimonials: bbox('#testimonials'),
      cta: bbox('#contact'),
      footer: bbox('footer'),
      heroHeading: bbox('#hero h1'),
      servicesHeading: bbox('#services h2'),
      whyHeading: bbox('#why h2'),
      serviceCards: cards,
      testimonialCards: testimonials,
      navHeight: bbox('header'),
      whatsapp: bbox('.whatsapp-float'),
    };
  });

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
}

audit().catch((err) => { console.error(err); process.exit(1); });

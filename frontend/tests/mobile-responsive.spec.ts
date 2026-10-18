import { test, expect } from '@playwright/test';

const MOBILE_VIEWPORTS = [
  { width: 360, height: 740, name: '360x740' },
  { width: 390, height: 844, name: '390x844' },
];

async function checkNoHorizontalScroll(page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const windowWidth = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth).toBeLessThanOrEqual(windowWidth);
}

for (const viewport of MOBILE_VIEWPORTS) {
  test.describe(`Mobile responsive at ${viewport.name}`, () => {
    test.use({ viewport });

    test('landing page has no horizontal scroll', async ({ page }) => {
      await page.goto('/');
      await checkNoHorizontalScroll(page);
    });

    test('results page has no horizontal scroll', async ({ page }) => {
      await page.goto('/');

      // Fill in the form and simulate
      await page.fill('input[placeholder*="order"]', 'ORD-1001');
      await page.fill('input[placeholder*="Refund"]', '500');
      await page.click('button:has-text("Simulate")');

      // Wait for results
      await page.waitForSelector('[data-testid="consequence-graph"]', { timeout: 10000 });

      await checkNoHorizontalScroll(page);
    });

    test('dashboard page has no horizontal scroll', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForSelector('table', { timeout: 10000 });
      await checkNoHorizontalScroll(page);
    });

    test('agents page has no horizontal scroll', async ({ page }) => {
      await page.goto('/agents');
      await page.waitForSelector('table', { timeout: 10000 });
      await checkNoHorizontalScroll(page);
    });

    test('audit page has no horizontal scroll', async ({ page }) => {
      await page.goto('/audit');
      await page.waitForSelector('table', { timeout: 10000 });
      await checkNoHorizontalScroll(page);
    });
  });
}

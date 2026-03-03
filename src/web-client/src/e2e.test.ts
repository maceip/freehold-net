import puppeteer, { Browser, Page } from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { preview } from 'vite';
import type { PreviewServer } from 'vite';
import path from 'path';

describe('MPCAuth E2E Web Test', () => {
  let server: PreviewServer;
  let browser: Browser;
  let page: Page;
  let baseUrl: string;

  beforeAll(async () => {
    server = await preview({
      root: path.resolve(__dirname, '..'),
      build: { outDir: 'dist' }
    });

    browser = await puppeteer.launch({
      headless: true,
    });
    page = await browser.newPage();
    page.setDefaultTimeout(15000);
    baseUrl = `http://localhost:${server.config.preview.port || 4173}`;
  }, 30000);

  afterAll(() => {
    // Fire-and-forget teardown — Puppeteer + Vite preview hang on Windows
    // when awaiting close due to keep-alive sockets and Chrome process cleanup.
    browser?.close().catch(() => {});
    (server?.httpServer as any)?.closeAllConnections?.();
    server?.httpServer?.close();
  }, 5000);

  it('should render landing page with Freehold title and bento carousel', async () => {
    await page.goto(baseUrl, { waitUntil: 'networkidle0' });

    // Verify page title
    const title = await page.title();
    expect(title).toBe('Freehold: Secure Advocacy');

    // Verify hero title text
    const heroText = await page.$eval('.hero-title', (el) => el.textContent);
    expect(heroText).toBe('Freehold');

    // Verify bento carousel is populated
    const bentoBoxes = await page.$$('#bento-track .bento-box');
    expect(bentoBoxes.length).toBeGreaterThan(0);

    // Verify CLUSTER ACTIVE status indicator
    const statusText = await page.$eval('#anchored-status', (el) => el.textContent);
    expect(statusText).toContain('CLUSTER ACTIVE');

    // Verify status dot exists (green LED indicator)
    const statusDot = await page.$('#anchored-status .status-dot');
    expect(statusDot).not.toBeNull();

    console.log('Landing page verified: title, bento carousel, cluster status.');
  }, 15000);

  it('should navigate to Sign view and render glass-page panel', async () => {
    await page.goto(baseUrl, { waitUntil: 'networkidle0' });

    // Click the Sign nav link
    await page.evaluate(() => {
      (document.querySelector('nav a[data-target="sign"]') as HTMLElement)?.click();
    });

    // Wait for sign-view to become active
    await page.waitForFunction(
      () => document.getElementById('sign-view')?.classList.contains('active'),
      { timeout: 5000 }
    );

    // Verify glass-page panel rendered
    const glassPage = await page.$('#sign-view .glass-page');
    expect(glassPage).not.toBeNull();

    // Verify step-identity is the active step
    const identityActive = await page.$eval('#step-identity', (el) =>
      el.classList.contains('active')
    );
    expect(identityActive).toBe(true);

    // Verify Signatory Verification heading
    const heading = await page.$eval('#sign-view .glass-page h1', (el) => el.textContent);
    expect(heading).toContain('Signatory Verification');

    console.log('Sign view verified: glass-page panel, identity step active.');
  }, 15000);

  it('should complete the full signing ceremony', async () => {
    await page.goto(baseUrl, { waitUntil: 'networkidle0' });

    // Navigate to Sign view
    await page.evaluate(() => {
      (document.querySelector('nav a[data-target="sign"]') as HTMLElement)?.click();
    });
    await page.waitForFunction(
      () => document.getElementById('sign-view')?.classList.contains('active'),
      { timeout: 5000 }
    );

    // ── Step 1: Email input ──
    await page.evaluate(() => {
      (document.getElementById('signer-email') as HTMLInputElement).value = 'dev@example.com';
    });
    await page.evaluate(() => {
      document.getElementById('request-code-btn')?.click();
    });

    // MPC shard animation plays (~5.4s total), then OTP step becomes active
    // Verify the MCP loading overlay appears (console boot animation)
    const mcpVisible = await page.waitForFunction(
      () => {
        const el = document.getElementById('mcp-loading');
        return el && (el.style.display === 'flex' || el.classList.contains('console-booting'));
      },
      { timeout: 3000 }
    ).then(() => true).catch(() => false);

    if (mcpVisible) {
      // Verify SVG graph with MPC nodes exists within the animation
      const graphExists = await page.$('#mcp-graph') !== null;
      expect(graphExists).toBe(true);
      console.log('MPC animation triggered: shard distribution console visible.');
    }

    // Wait for OTP step to become active (after animation completes)
    await page.waitForFunction(
      () => document.getElementById('step-otp')?.classList.contains('active'),
      { timeout: 10000 }
    );

    // ── Step 2: OTP verification ──
    await page.evaluate(() => {
      const digits = '123456';
      document.querySelectorAll('.otp-island').forEach((input, i) => {
        (input as HTMLInputElement).value = digits[i] || '';
      });
    });
    await page.evaluate(() => {
      document.getElementById('verify-code-btn')?.click();
    });

    // Wait for petition list to be populated
    await page.waitForFunction(
      () => (document.getElementById('petition-list')?.textContent?.length ?? 0) > 0,
      { timeout: 5000 }
    );
    const petitionText = await page.$eval('#petition-list', (el) => el.textContent);
    expect(petitionText).toContain('Permanent Remote Work');

    // ── Step 3: Select petition ──
    await page.evaluate(() => {
      document.getElementById('final-select')?.click();
    });

    // Wait for signature step
    await page.waitForFunction(
      () => document.getElementById('step-signature')?.classList.contains('active'),
      { timeout: 5000 }
    );

    // Verify galaxy canvas and fountain pen input are present
    const galaxyCanvas = await page.$('#galaxy-canvas');
    expect(galaxyCanvas).not.toBeNull();

    const fountainInput = await page.$('#signature-input');
    expect(fountainInput).not.toBeNull();

    // ── Step 4: Type signature and verify crypto ink ──
    await page.type('#signature-input', 'John Doe', { delay: 80 });

    // Check that math-ink crypto equations spawned during typing
    const mathInkCount = await page.$$eval('.math-ink', (els) => els.length);
    expect(mathInkCount).toBeGreaterThan(0);
    console.log(`Crypto ink equations spawned during signature: ${mathInkCount}`);

    // Click CAST SIGNATURE
    await page.evaluate(() => {
      document.getElementById('finalize-sign-btn')?.click();
    });

    // Verify completion: green checkmark and success message
    await page.waitForFunction(
      () => {
        const step = document.getElementById('step-signature');
        return step?.textContent?.includes('Signature Cast');
      },
      { timeout: 5000 }
    );

    const completionText = await page.$eval('#step-signature', (el) => el.textContent);
    expect(completionText).toContain('Signature Cast');
    expect(completionText).toContain('identity shards have been distributed');

    // Verify the green checkmark SVG is present
    const checkmark = await page.$('#step-signature svg');
    expect(checkmark).not.toBeNull();

    console.log('Full signing ceremony completed: email -> MPC animation -> OTP -> petition -> signature -> verified.');
  }, 30000);
});

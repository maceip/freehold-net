import puppeteer, { Browser, Page } from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { preview } from 'vite';
import type { PreviewServer } from 'vite';
import path from 'path';

describe('MPCAuth E2E Web Test', () => {
  let server: PreviewServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    // 1. Start the Vite preview server
    server = await preview({
      root: path.resolve(__dirname, '..'),
      build: { outDir: 'dist' }
    });

    // 2. Launch Puppeteer
    browser = await puppeteer.launch({
      headless: true, // Set to true for CI/CLI
    });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('should shard an email and request a passcode via MPC cluster', async () => {
    const url = `http://localhost:${server.config.preview.port || 4173}`;
    await page.goto(url);

    // Navigate to Sign
    await page.click('nav a[data-target="sign"]');

    // Verify page title
    const title = await page.title();
    expect(title).toBe('OpenPetition: Secure Advocacy');

    // Step 1: Request Code
    await page.type('#signer-email', 'dev@example.com');
    await page.click('#request-code-btn');

    // Wait for OTP step
    await page.waitForSelector('#otp-code');
    
    // Step 2: Sign
    await page.type('#otp-code', '123456');
    await page.click('#verify-code-btn');

    // Wait for Eligible list
    await page.waitForSelector('#petition-list');
    const statusText = await page.$eval('#petition-list', (el) => el.textContent);
    expect(statusText).toContain('Permanent Remote Work');
    
    console.log('✅ Puppeteer E2E Test Passed: Modern UI flow verified.');
  });
});

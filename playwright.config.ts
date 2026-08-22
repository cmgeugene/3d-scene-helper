import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';
const usesExternalServer =
  process.env.npm_lifecycle_event === 'test:e2e:external' ||
  process.env.I2V_PLAYWRIGHT_EXTERNAL === '1';
const localChromiumExecutable = process.env.I2V_PLAYWRIGHT_EXECUTABLE;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: usesExternalServer
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(localChromiumExecutable === undefined
            ? {}
            : { executablePath: localChromiumExecutable }),
          args: [
            '--enable-webgl',
            '--enable-unsafe-swiftshader',
            '--use-angle=swiftshader',
            '--use-gl=angle',
          ],
        },
      },
    },
  ],
});

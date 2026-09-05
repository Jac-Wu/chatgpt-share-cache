import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 3177;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 1100 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(chrome) ? chrome : undefined),
      args: ['--host-resolver-rules=MAP archive.example.com 127.0.0.1'],
    },
  },
  webServer: {
    command: 'npm run start',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_BASE_URL: 'http://obsolete.example.invalid:9999',
      TRUST_PROXY: '',
      ALLOWED_HOSTS: 'archive.example.com',
      ADMIN_SECRET: 'e2e-only-admin-secret-not-for-production-use',
      DATA_DIR: path.join(os.tmpdir(), `shiguang-e2e-${process.pid}`),
      NODE_ENV: 'production',
    },
  },
});

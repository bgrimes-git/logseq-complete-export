import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  use: {
    browserName: "chromium",
    channel: process.env.CI ? undefined : "msedge",
    baseURL: "http://127.0.0.1:47813",
  },
  webServer: {
    command:
      "npm exec vite -- preview --host 127.0.0.1 --port 47813 --strictPort",
    url: "http://127.0.0.1:47813",
    reuseExistingServer: false,
  },
  workers: 1,
});

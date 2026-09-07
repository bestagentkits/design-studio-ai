import { chromium } from '@playwright/test';
export const launchExportBrowser = () => chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

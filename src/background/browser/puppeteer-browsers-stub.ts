// Stands in for `@puppeteer/browsers` in the extension build.
// Since puppeteer-core 25, connect() dynamically imports it for the `channel` option, which we never use.
// The background is a single IIFE, so Vite would otherwise inline the whole Node-only package (~300 KB).
const unsupported = (): never => {
  throw new Error('@puppeteer/browsers is not available in the extension');
};

export const Browser = {};
export const ChromeReleaseChannel = {};
export const detectBrowserPlatform = unsupported;
export const resolveDefaultUserDataDir = unsupported;

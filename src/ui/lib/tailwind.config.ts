import type { Config } from 'tailwindcss/types/config';

// global.css only needs preflight, so it scans no content.
// It must name this config with @config: Tailwind 3 otherwise reuses whichever page's
// @config the shared PostCSS plugin processed last, which leaks that page's utilities.
export default {
  content: [],
} as Config;

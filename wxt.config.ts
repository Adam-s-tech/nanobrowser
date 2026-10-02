import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'wxt';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const localesDir = resolve(import.meta.dirname, 'public/_locales');

// Regenerates the MessageKey type in src/i18n/lib/type.ts from public/_locales.
const generateI18n = () => execFileSync(process.execPath, [resolve(import.meta.dirname, 'src/i18n/generate-i18n.mjs')]);

// WXT's build:before hook doesn't fire on dev rebuilds, so regenerate when a locale changes.
const i18nWatcher = (): Plugin => ({
  name: 'nanobrowser:i18n-watcher',
  configureServer(server) {
    server.watcher.add(localesDir);
    server.watcher.on('all', (_event, file) => {
      if (file.startsWith(localesDir + sep)) generateI18n();
    });
  },
});

// These directories were packages with "sideEffects": false. Keep that for tree-shaking,
// so production chunks match the previous build.
const sideEffectFreeDirs = ['storage', 'i18n', 'ui', 'shared'].map(
  dir => resolve(import.meta.dirname, 'src', dir) + sep,
);
const sideEffectFree = (): Plugin => ({
  name: 'nanobrowser:side-effect-free',
  transform(code, id) {
    if (/\.tsx?$/.test(id) && sideEffectFreeDirs.some(dir => id.startsWith(dir))) {
      return { code, map: null, moduleSideEffects: false };
    }
    return null;
  },
});

export default defineConfig({
  imports: false,
  outDir: 'dist',
  outDirTemplate: '',
  alias: {
    '@root': '.',
    '@src': 'src',
    '@assets': 'src/assets',
    '@extension/storage': 'src/storage',
    '@extension/i18n': 'src/i18n',
    '@extension/ui': 'src/ui',
    '@extension/shared': 'src/shared',
  },
  manifest: {
    default_locale: 'en',
    name: '__MSG_app_metadata_name__',
    description: '__MSG_app_metadata_description__',
    host_permissions: ['<all_urls>'],
    permissions: ['storage', 'scripting', 'tabs', 'activeTab', 'debugger', 'unlimitedStorage', 'webNavigation'],
    action: { default_icon: 'icon-32.png' },
    icons: { 128: 'icon-128.png' },
    web_accessible_resources: [
      {
        resources: [
          '*.js',
          '*.css',
          '*.svg',
          'icon-128.png',
          'icon-32.png',
          'permission/index.html',
          'permission/permission.js',
        ],
        matches: ['*://*/*'],
      },
    ],
  },
  hooks: {
    'config:resolved': wxt => {
      // WXT 0.21.4 still installs Unimport's Vite plugin with imports: false.
      // Clear its presets too, so existing storage/browser variables stay untouched.
      wxt.config.imports.presets = [];
      wxt.config.imports.imports = [];
    },
    'build:before': () => {
      generateI18n();
    },
    'build:manifestGenerated': (_wxt, manifest) => {
      // WXT builds the default IIFE; this hook preserves the existing MV3 manifest type.
      // WXT discovers extra icons and sorts matches; preserve the shipped manifest.
      manifest.icons = { 128: 'icon-128.png' };
      if (manifest.content_scripts?.[0]) {
        manifest.content_scripts[0].matches = ['http://*/*', 'https://*/*', '<all_urls>'];
      }
      if (manifest.background) (manifest.background as { type?: string }).type = 'module';
    },
  },
  vite: env => ({
    plugins: [react(), i18nWatcher(), sideEffectFree()],
    resolve: {
      alias: {
        '@puppeteer/browsers': resolve(import.meta.dirname, 'src/background/browser/puppeteer-browsers-stub.ts'),
        '@ai-sdk/gateway': resolve(import.meta.dirname, 'src/background/llm/gateway-stub.ts'),
      },
      conditions: ['browser', 'module', 'import', 'default'],
      mainFields: ['browser', 'module', 'main'],
    },
    // Page CSS selects its own @config; shared global.css emits only preflight.
    css: { postcss: { plugins: [tailwindcss({ content: [] }), autoprefixer()] } },
    build: {
      sourcemap: env.mode === 'development',
      minify: env.mode === 'production',
      rollupOptions: { external: ['chrome'] },
    },
  }),
});

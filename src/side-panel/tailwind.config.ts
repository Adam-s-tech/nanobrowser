import { resolve } from 'node:path';
import type { Config } from 'tailwindcss/types/config';

export default {
  // This config sits in the page folder; don't scan it for class names.
  content: [resolve(__dirname, '**/*.{js,ts,jsx,tsx}'), `!${resolve(__dirname, 'tailwind.config.ts')}`],
  theme: {
    extend: {
      keyframes: {
        progress: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        progress: 'progress 1.5s infinite ease-in-out',
      },
    },
  },
  plugins: [],
} as Config;

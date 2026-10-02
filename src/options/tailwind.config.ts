import { resolve } from 'node:path';
// Tailwind's config loader ignores WXT aliases, so import withUI from source.
import { withUI } from '../ui/lib/withUI';

export default withUI({
  // This config sits in the page folder; don't scan it for class names.
  content: [resolve(__dirname, '**/*.{js,ts,jsx,tsx}'), `!${resolve(__dirname, 'tailwind.config.ts')}`],
  theme: {
    extend: {},
  },
  plugins: [],
});

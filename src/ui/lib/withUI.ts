import deepmerge from 'deepmerge';
import type { Config } from 'tailwindcss/types/config';

// Tailwind's config loader supplies this when it loads this source file.
declare const __dirname: string;

export function withUI(tailwindConfig: Config): Config {
  return deepmerge(tailwindConfig, {
    content: [`${__dirname}/**/*.{tsx,ts,js,jsx}`],
  });
}

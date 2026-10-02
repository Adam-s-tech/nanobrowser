# Contributing to NanoBrowser

We deeply appreciate your interest in contributing to NanoBrowser! Every contribution helps make Nanobrowser more powerful and accessible for everyone.

## Quick Start

1. Fork and clone the repository
2. Create a new branch (`git checkout -b feature-name`)
3. Make your changes
4. Submit a Pull Request

## Local development

Use Node.js 24 LTS (v24.11.0 or higher is required, see `engines` in `package.json`) and pnpm 10. The exact version is pinned in `package.json`: any global pnpm 10 or newer switches to it automatically, and older pnpm and npm are refused at install time. If you don't have pnpm yet, run `corepack enable` once for each Node installation:

```bash
corepack enable # skip if pnpm 10+ is already installed
pnpm install
pnpm dev
```

Load the repository's `dist/` folder as an unpacked extension in Chrome or Edge. The WXT browser runner is disabled by default, so you can use your existing browser profile. WXT hot-updates pages, including shared code under `src/`, and reloads the extension for background/content edits.

`entrypoints/` contains thin wrappers importing the background, content, side panel, and options source under `src/`. Keep application logic in those source directories.

Locales live in `public/_locales/`. During `pnpm dev`, editing them regenerates the i18n types, and WXT copies `_locales` and reloads the extension. WXT is pinned to `0.21.4`; upgrades should explicitly verify the config hooks, manifest, and CSS baseline.

Run `pnpm build` for production, `pnpm zip` for an archive in `dist-zip/`, `pnpm test` for unit tests, and `pnpm type-check` for TypeScript checks.

`pnpm type-check` passes; `pnpm exec eslint .` reports one pre-existing error (`no-explicit-any` in `src/background/browser/dom/history/view.ts`). Avoid introducing new failures. The `pnpm lint` script auto-fixes files; use `pnpm exec eslint <path>` for a check without fixes.

## How Can I Contribute?

### Reporting Bugs
- Search existing issues first
- Include:
  - Clear description
  - Steps to reproduce
  - Environment details (OS, browser version)
  - Screenshots if applicable

### Suggesting Enhancements
- Open an issue with a clear title and detailed description
- Explain why this enhancement would be useful

### Code Contributions
1. Follow the existing code style
2. Write clear commit messages in present tense ("Add feature" not "Added feature")
3. Test your changes thoroughly
4. Update documentation if needed
5. Create a Pull Request with a clear description
6. Be responsive to feedback and address review comments promptly

## License

By contributing, you agree that your contributions will be licensed under the project's license terms.

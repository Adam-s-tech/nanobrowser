import type { MessageKey } from './type';

// Extension pages, including WXT dev pages, read public/_locales through chrome.i18n.
export function t(key: MessageKey, substitutions?: string | string[]) {
  return chrome.i18n.getMessage(key, substitutions);
}

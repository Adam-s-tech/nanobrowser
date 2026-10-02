import { defineContentScript } from 'wxt/utils/define-content-script';
import '../src/content/index';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*', '<all_urls>'],
  allFrames: true,
  main() {},
});

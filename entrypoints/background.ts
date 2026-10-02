import { defineBackground } from 'wxt/utils/define-background';
// Keep existing Chrome listener registration synchronous at service-worker startup.
// WXT strips side-effect imports when evaluating entrypoint options at build time.
import '@src/background/index';

export default defineBackground({ main() {} });

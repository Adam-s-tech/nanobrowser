import { createRoot } from 'react-dom/client';
// Shared base styles first, so the page's own CSS can override them.
import '@extension/ui/lib/global.css';
import './index.css';
import Options from './Options';

function init() {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    throw new Error('Can not find #app-container');
  }
  const root = createRoot(appContainer);
  appContainer.className = 'min-w-[768px]';
  root.render(<Options />);
}

init();

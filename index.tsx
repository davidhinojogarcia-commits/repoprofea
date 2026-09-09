import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './components/AuthGate';
import { installButtonSounds } from './src/lib/uiSounds';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Install the short key-click sound globally for buttons in the application.
installButtonSounds();

// Remove the obsolete manual synchronization entry from the sidebar without
// touching the legacy component code still used by older workspaces.
const hideLegacySyncMenu = () => {
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const button of buttons) {
    const label = (button.textContent || '').trim();
    if (label === 'Sincronizar') {
      button.remove();
    }
  }
};

const observer = new MutationObserver(hideLegacySyncMenu);
observer.observe(document.body, { childList: true, subtree: true });

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>
);

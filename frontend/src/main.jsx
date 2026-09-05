import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { StoreProvider } from './store.jsx';
import ErrorBoundary, { reloadAfterStaleAssetError } from './ErrorBoundary.jsx';
import './index.css';

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadAfterStaleAssetError(event.payload || new Error('Failed to fetch dynamically imported module'));
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <React.StrictMode>
      <StoreProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StoreProvider>
    </React.StrictMode>
  </ErrorBoundary>
);

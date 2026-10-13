/**
 * Phase F — Vite entry point. Mounts the chat + settings App shell.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyBrand } from '@workspace/brand-config';
import App from './App';
import './styles.css';
import { BRAND } from './brand';

// White-label identity: brand accent variables + document title, before the
// first paint.
applyBrand(BRAND);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root element in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

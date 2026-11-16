import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@dcaldeira/design-system';
import '@dcaldeira/design-system/style.css';
import '../design-system.css';
import './styles.css';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider mode="light">
      <App />
    </ThemeProvider>
  </StrictMode>,
);

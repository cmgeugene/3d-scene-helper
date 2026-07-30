import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/App.css';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('앱을 마운트할 #root 요소를 찾을 수 없습니다.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

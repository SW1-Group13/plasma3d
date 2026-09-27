import { createRoot } from 'react-dom/client';
import '@/index.css';
import { App } from '@/app/App';

const container = document.getElementById('root');
if (!container) throw new Error('No se encontro el elemento #root');

createRoot(container).render(<App />);

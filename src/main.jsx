import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// Pas de <StrictMode> : il doublerait le démarrage du worker Pyodide en développement.
createRoot(document.getElementById('root')).render(<App />);

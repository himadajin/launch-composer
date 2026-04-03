import ReactDOM from 'react-dom/client';

import '@himadajin/vscode-components/styles.css';

import { App } from './App.js';
import './styles.css';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('Missing root element.');
}

ReactDOM.createRoot(root).render(<App />);

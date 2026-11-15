import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { PrintHost } from './EvalSheet.jsx';
import { DeskProvider, DialogHost, ToastProvider } from './ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <DeskProvider>
      <ToastProvider>
        <App />
        <PrintHost />
        <DialogHost />
      </ToastProvider>
    </DeskProvider>
  </BrowserRouter>,
);

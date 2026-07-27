import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import CandidateApp from './CandidateApp.tsx';
import { AuthProvider } from './context/AuthContext.js';
import { CandidateAuthProvider } from './context/CandidateAuthContext.js';
import './index.css';

// The app has no client-side router (confirmed by inspection), so this single path check is
// the minimal-footprint way to serve the independent candidate screen tree without adding a
// routing dependency. Every URL not starting with /candidate renders exactly what it rendered
// before this change.
const isCandidateRoute = window.location.pathname.startsWith('/candidate');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCandidateRoute ? (
      <CandidateAuthProvider>
        <CandidateApp />
      </CandidateAuthProvider>
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>,
);

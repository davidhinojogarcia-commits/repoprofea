import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './components/AuthGate';

const App = React.lazy(() => import('./App'));

class RootErrorBoundary extends React.Component<{children:React.ReactNode},{error:Error|null}> {
  state:{error:Error|null}={error:null};
  static getDerivedStateFromError(error:Error){return {error};}
  componentDidCatch(error:Error, info:React.ErrorInfo){console.error('Error fatal de la aplicación', error, info);}
  render(){
    if(this.state.error){
      return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4"><div className="w-full max-w-lg rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-8 shadow-xl"><h1 className="text-xl font-bold text-slate-900 dark:text-white">No se ha podido cargar la aplicación</h1><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Se ha producido un error al iniciar PROFEA. Recarga la página. Si continúa, comunica el problema al administrador.</p><button type="button" onClick={()=>window.location.reload()} className="mt-5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2.5 font-semibold">Recargar</button></div></div>;
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AuthGate>
        <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950"><div className="text-sm text-slate-500">Cargando aplicación…</div></div>}>
          <App />
        </React.Suspense>
      </AuthGate>
    </RootErrorBoundary>
  </React.StrictMode>
);

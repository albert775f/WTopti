import { useEffect } from 'react';
import { useAppState, useAppDispatch, useAppActions } from './context/AppContext';
import { useOptimizer } from './hooks/useOptimizer';
import { processPhase1 } from './algorithm/phase1';
import UploadSection from './components/UploadSection';
import ABCSection from './components/ABCSection';
import WTVisualization from './components/WTVisualization';
import WTRatioSection from './components/WTRatioSection';
import ValidationDashboard from './components/validation/ValidationDashboard';
import type { AppState } from './context/AppContext';

const NAV_ITEMS: { id: AppState['activeSection']; label: string; icon: string }[] = [
  { id: 'upload', label: 'Daten & Config', icon: '📤' },
  { id: 'abc', label: 'ABC-Analyse', icon: '📊' },
  { id: 'visualization', label: 'WT-Visualisierung', icon: '🗺️' },
  { id: 'ratio', label: 'WT-Simulator', icon: '⚖️' },
  { id: 'validation', label: 'Ergebnisvalidierung', icon: '✓' },
];

function ProgressOverlay() {
  const { optimizationStatus, optimizationProgress } = useAppState();
  if (optimizationStatus !== 'running') return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-8 shadow-2xl max-w-md w-full mx-4">
        <h3 className="text-lg font-bold text-gray-800 mb-2">Optimierung läuft...</h3>
        <p className="text-sm text-gray-600 mb-4">
          Phase {optimizationProgress.phase}: {optimizationProgress.phaseName}
        </p>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div className="h-3 rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: `${optimizationProgress.progress}%` }} />
        </div>
        <p className="text-right text-sm text-gray-500 mt-1">{optimizationProgress.progress}%</p>
      </div>
    </div>
  );
}

export default function App() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { checkApiStatus } = useAppActions();
  const { startOptimization } = useOptimizer();

  // Check backend status on mount
  useEffect(() => {
    checkApiStatus();
  }, [checkApiStatus]);

  const handleStartOptimization = (data: { artikel: any[]; bestellungen: any[]; bestand: any[] }) => {
    // Run Phase 1 synchronously first for ABC display
    const { processed } = processPhase1(
      data.artikel, data.bestellungen, data.bestand, state.config
    );
    dispatch({ type: 'SET_ARTIKEL_PROCESSED', payload: processed });

    // Run full pipeline in worker
    startOptimization({
      artikel: data.artikel,
      bestellungen: data.bestellungen,
      bestand: data.bestand,
      config: state.config,
    });
    dispatch({ type: 'SET_SECTION', section: 'abc' });
  };

  // Loading state
  if (state.apiLoading && state.apiStatus === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="mt-3 text-sm text-gray-600">Verbindung zum Backend...</p>
        </div>
      </div>
    );
  }

  // Backend error state
  if (state.apiError && state.apiStatus === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="max-w-md bg-white rounded-lg border border-red-200 p-6 text-center">
          <p className="text-3xl mb-3">⚠️</p>
          <h2 className="text-lg font-bold text-red-800 mb-2">Backend nicht erreichbar</h2>
          <p className="text-sm text-red-700 mb-4">{state.apiError}</p>
          <button
            onClick={() => checkApiStatus()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  const renderSection = () => {
    switch (state.activeSection) {
      case 'upload':
        return <UploadSection onStartOptimization={handleStartOptimization} />;
      case 'abc':
        return <ABCSection />;
      case 'visualization':
        return <WTVisualization />;
      case 'ratio':
        return <WTRatioSection />;
      case 'validation':
        return state.result?.validation_dashboard ? (
          <ValidationDashboard
            data={state.result.validation_dashboard}
            wts={state.result.wts}
            bestellungen={state.apiData?.bestellungen ?? []}
            config={state.config}
            coMatrix={state.result.coMatrix ?? {}}
            artikelBezeichnungen={new Map(
              (state.apiData?.artikel ?? []).map(a => [a.artikelnummer, a.bezeichnung])
            )}
            onExportBelegungsplan={() => {
              if (!state.result) return;
              const headers = ['WT-ID', 'Typ', 'Artikel', 'Bezeichnung', 'Stück', 'Gewicht (kg)', 'Fläche %', 'Cluster', 'ABC', 'Teiler'];
              const rows = state.result.wts.flatMap(wt =>
                wt.positionen.map(pos => [
                  wt.id, wt.typ, pos.artikelnummer, pos.bezeichnung,
                  pos.stueckzahl, wt.gesamtgewicht_kg, wt.flaeche_netto_pct,
                  wt.cluster_id, pos.abc_klasse, wt.anzahl_teiler
                ])
              );
              const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'belegungsplan.csv';
              a.click();
              URL.revokeObjectURL(url);
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>Erst Optimierung starten um die Validierung zu sehen.</p>
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-800">Warenträger-Optimierung</h1>
          <p className="text-xs text-gray-500">STOROJET</p>
        </div>
        <nav className="flex-1 py-2">
          {NAV_ITEMS.map((item) => (
            <button key={item.id}
              onClick={() => dispatch({ type: 'SET_SECTION', section: item.id })}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm transition-colors ${
                state.activeSection === item.id
                  ? 'bg-blue-50 text-blue-700 font-semibold border-r-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}>
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        {state.result && (
          <div className="p-4 border-t border-gray-200 text-xs text-gray-500 space-y-1">
            <p>WTs: {state.result.stats.wts_benoetigt}</p>
            <p>Klein: {state.result.stats.wts_klein} | Groß: {state.result.stats.wts_gross}</p>
            <p>Artikel: {state.result.stats.artikel_platziert}/{state.result.stats.artikel_gesamt}</p>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6">
        {renderSection()}
      </main>

      <ProgressOverlay />
    </div>
  );
}

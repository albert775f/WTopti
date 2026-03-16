import { useAppState, useAppDispatch } from './context/AppContext';
import { useOptimizer } from './hooks/useOptimizer';
import { processPhase1 } from './algorithm/phase1';
import UploadSection from './components/UploadSection';
import ABCSection from './components/ABCSection';
import CoOccurrenceSection from './components/CoOccurrenceSection';
import BelegungsplanSection from './components/BelegungsplanSection';
import WTVisualization from './components/WTVisualization';
import WTRatioSection from './components/WTRatioSection';
import type { AppState } from './context/AppContext';

const NAV_ITEMS: { id: AppState['activeSection']; label: string; icon: string }[] = [
  { id: 'upload', label: 'Daten & Config', icon: '📤' },
  { id: 'abc', label: 'ABC-Analyse', icon: '📊' },
  { id: 'cooccurrence', label: 'Co-Occurrence', icon: '🔗' },
  { id: 'belegungsplan', label: 'Belegungsplan', icon: '📋' },
  { id: 'visualization', label: 'WT-Visualisierung', icon: '🗺️' },
  { id: 'ratio', label: 'WT-Simulator', icon: '⚖️' },
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
  const { startOptimization } = useOptimizer();

  const handleStartOptimization = () => {
    // Run Phase 1 synchronously first for ABC display
    const { processed } = processPhase1(
      state.artikelRaw, state.bestellungenRaw, state.umsatzRaw, state.bestandRaw, state.config
    );
    dispatch({ type: 'SET_ARTIKEL_PROCESSED', payload: processed });

    // Run full pipeline in worker
    startOptimization(
      state.artikelRaw, state.bestellungenRaw, state.umsatzRaw, state.bestandRaw, state.config
    );
  };

  const renderSection = () => {
    switch (state.activeSection) {
      case 'upload':
        return <UploadSection onStartOptimization={handleStartOptimization} />;
      case 'abc':
        return <ABCSection />;
      case 'cooccurrence':
        return <CoOccurrenceSection />;
      case 'belegungsplan':
        return <BelegungsplanSection />;
      case 'visualization':
        return <WTVisualization />;
      case 'ratio':
        return <WTRatioSection />;
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

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import type { ArtikelData, BestellungData, UmsatzData, BestandData, WTConfig, OptimizationResult, ArtikelProcessed } from '../types';

export interface AppState {
  artikelRaw: ArtikelData[];
  bestellungenRaw: BestellungData[];
  umsatzRaw: UmsatzData[];
  bestandRaw: BestandData[];
  artikelProcessed: ArtikelProcessed[];
  config: WTConfig;
  uploadStatus: {
    artikel: 'none' | 'loading' | 'valid' | 'error';
    bestellungen: 'none' | 'loading' | 'valid' | 'error';
    umsatz: 'none' | 'loading' | 'valid' | 'error';
    bestand: 'none' | 'loading' | 'valid' | 'error';
  };
  uploadErrors: Record<string, string>;
  optimizationStatus: 'idle' | 'running' | 'done' | 'error';
  optimizationProgress: { phase: number; phaseName: string; progress: number };
  result: OptimizationResult | null;
  activeSection: 'upload' | 'abc' | 'cooccurrence' | 'belegungsplan' | 'visualization' | 'ratio';
}

export type Action =
  | { type: 'SET_ARTIKEL'; payload: ArtikelData[] }
  | { type: 'SET_BESTELLUNGEN'; payload: BestellungData[] }
  | { type: 'SET_UMSATZ'; payload: UmsatzData[] }
  | { type: 'SET_BESTAND'; payload: BestandData[] }
  | { type: 'SET_ARTIKEL_PROCESSED'; payload: ArtikelProcessed[] }
  | { type: 'SET_UPLOAD_STATUS'; key: keyof AppState['uploadStatus']; status: AppState['uploadStatus']['artikel'] }
  | { type: 'SET_UPLOAD_ERROR'; key: string; error: string }
  | { type: 'SET_CONFIG'; payload: Partial<WTConfig> }
  | { type: 'SET_OPTIMIZATION_STATUS'; status: AppState['optimizationStatus'] }
  | { type: 'SET_OPTIMIZATION_PROGRESS'; payload: AppState['optimizationProgress'] }
  | { type: 'SET_RESULT'; payload: OptimizationResult }
  | { type: 'SET_SECTION'; section: AppState['activeSection'] };

const DEFAULT_CONFIG: WTConfig = {
  anzahl_klein: 4145,
  anzahl_gross: 1111,
  gewicht_hard_kg: 24,
  gewicht_soft_kg: 20,
  hoehe_limit_mm: 320,
  teiler_breite_mm: 5,
  teiler_verlust_prozent: 2,
  teiler_modus: 'percent',
  co_occurrence_schwellwert: 3,
};

const initialState: AppState = {
  artikelRaw: [],
  bestellungenRaw: [],
  umsatzRaw: [],
  bestandRaw: [],
  artikelProcessed: [],
  config: DEFAULT_CONFIG,
  uploadStatus: { artikel: 'none', bestellungen: 'none', umsatz: 'none', bestand: 'none' },
  uploadErrors: {},
  optimizationStatus: 'idle',
  optimizationProgress: { phase: 0, phaseName: '', progress: 0 },
  result: null,
  activeSection: 'upload',
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_ARTIKEL':
      return { ...state, artikelRaw: action.payload };
    case 'SET_BESTELLUNGEN':
      return { ...state, bestellungenRaw: action.payload };
    case 'SET_UMSATZ':
      return { ...state, umsatzRaw: action.payload };
    case 'SET_BESTAND':
      return { ...state, bestandRaw: action.payload };
    case 'SET_ARTIKEL_PROCESSED':
      return { ...state, artikelProcessed: action.payload };
    case 'SET_UPLOAD_STATUS':
      return { ...state, uploadStatus: { ...state.uploadStatus, [action.key]: action.status } };
    case 'SET_UPLOAD_ERROR':
      return { ...state, uploadErrors: { ...state.uploadErrors, [action.key]: action.error } };
    case 'SET_CONFIG':
      return { ...state, config: { ...state.config, ...action.payload } };
    case 'SET_OPTIMIZATION_STATUS':
      return { ...state, optimizationStatus: action.status };
    case 'SET_OPTIMIZATION_PROGRESS':
      return { ...state, optimizationProgress: action.payload };
    case 'SET_RESULT':
      return { ...state, result: action.payload };
    case 'SET_SECTION':
      return { ...state, activeSection: action.section };
    default:
      return state;
  }
}

const AppStateContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<Action>>(() => {});

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  return useContext(AppStateContext);
}

export function useAppDispatch() {
  return useContext(AppDispatchContext);
}

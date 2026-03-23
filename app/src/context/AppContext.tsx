import { createContext, useContext, useReducer, useCallback, type ReactNode, type Dispatch } from 'react';
import type { ArtikelData, BestellungData, BestandData, WTConfig, OptimizationResult, ArtikelProcessed, ThresholdConfig } from '../types';
import { DEFAULT_THRESHOLDS } from '../validation/thresholds';

export interface ApiStatus {
  hasStaticData: boolean;
  artikelCount?: number;
  bestellungenCount?: number;
  lastBestandUpload?: string;
}

export interface ApiData {
  artikel: ArtikelData[];
  bestellungen: BestellungData[];
  bestand: BestandData[];
}

export interface AppState {
  bestandRaw: BestandData[];
  artikelProcessed: ArtikelProcessed[];
  config: WTConfig;
  uploadStatus: {
    bestand: 'none' | 'loading' | 'valid' | 'error';
  };
  uploadErrors: Record<string, string>;
  optimizationStatus: 'idle' | 'running' | 'done' | 'error';
  optimizationProgress: { phase: number; phaseName: string; progress: number };
  result: OptimizationResult | null;
  activeSection: 'upload' | 'abc' | 'cooccurrence' | 'belegungsplan' | 'visualization' | 'ratio' | 'validation';
  validationThresholds: ThresholdConfig;
  apiStatus: ApiStatus | null;
  apiData: ApiData | null;
  apiLoading: boolean;
  apiError: string | null;
}

export type Action =
  | { type: 'SET_BESTAND'; payload: BestandData[] }
  | { type: 'SET_ARTIKEL_PROCESSED'; payload: ArtikelProcessed[] }
  | { type: 'SET_UPLOAD_STATUS'; key: keyof AppState['uploadStatus']; status: AppState['uploadStatus']['bestand'] }
  | { type: 'SET_UPLOAD_ERROR'; key: string; error: string }
  | { type: 'SET_CONFIG'; payload: Partial<WTConfig> }
  | { type: 'SET_OPTIMIZATION_STATUS'; status: AppState['optimizationStatus'] }
  | { type: 'SET_OPTIMIZATION_PROGRESS'; payload: AppState['optimizationProgress'] }
  | { type: 'SET_RESULT'; payload: OptimizationResult }
  | { type: 'SET_SECTION'; section: AppState['activeSection'] }
  | { type: 'SET_API_STATUS'; payload: ApiStatus }
  | { type: 'SET_API_DATA'; payload: ApiData }
  | { type: 'SET_API_LOADING'; payload: boolean }
  | { type: 'SET_API_ERROR'; payload: string | null }
  | { type: 'SET_VALIDATION_THRESHOLDS'; thresholds: Partial<ThresholdConfig> };

const DEFAULT_CONFIG: WTConfig = {
  anzahl_klein: 4145,
  anzahl_gross: 1111,
  gewicht_hard_kg: 24,
  gewicht_soft_kg: 20,
  hoehe_limit_mm: 320,
  teiler_breite_mm: 5,
  co_occurrence_schwellwert: 3,
  a_artikel_scatter_n: 3,
  warehouse_area_m2: 1480.65,
  min_segment_mm: 90,
};

const initialState: AppState = {
  bestandRaw: [],
  artikelProcessed: [],
  config: DEFAULT_CONFIG,
  uploadStatus: { bestand: 'none' },
  uploadErrors: {},
  optimizationStatus: 'idle',
  optimizationProgress: { phase: 0, phaseName: '', progress: 0 },
  result: null,
  activeSection: 'upload',
  validationThresholds: DEFAULT_THRESHOLDS,
  apiStatus: null,
  apiData: null,
  apiLoading: false,
  apiError: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
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
    case 'SET_API_STATUS':
      return { ...state, apiStatus: action.payload };
    case 'SET_API_DATA':
      return { ...state, apiData: action.payload };
    case 'SET_API_LOADING':
      return { ...state, apiLoading: action.payload };
    case 'SET_API_ERROR':
      return { ...state, apiError: action.payload };
    case 'SET_VALIDATION_THRESHOLDS':
      return { ...state, validationThresholds: { ...state.validationThresholds, ...action.thresholds } };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
  checkApiStatus: () => Promise<void>;
  uploadStaticData: (artikelFile: File, bestellungenFile: File) => Promise<void>;
  uploadBestandData: (bestandFile: File) => Promise<void>;
  loadApiData: () => Promise<ApiData>;
}

const AppStateContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<Action>>(() => {});
const AppActionsContext = createContext<Pick<AppContextValue, 'checkApiStatus' | 'uploadStaticData' | 'uploadBestandData' | 'loadApiData'>>({
  checkApiStatus: async () => {},
  uploadStaticData: async () => {},
  uploadBestandData: async () => {},
  loadApiData: async () => ({ artikel: [], bestellungen: [], bestand: [] }),
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const checkApiStatus = useCallback(async () => {
    dispatch({ type: 'SET_API_LOADING', payload: true });
    dispatch({ type: 'SET_API_ERROR', payload: null });
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiStatus = await res.json();
      dispatch({ type: 'SET_API_STATUS', payload: data });
    } catch {
      dispatch({ type: 'SET_API_ERROR', payload: 'Backend nicht erreichbar (Port 3001). Bitte starten: cd server && npm run dev' });
    } finally {
      dispatch({ type: 'SET_API_LOADING', payload: false });
    }
  }, []);

  const uploadStaticData = useCallback(async (artikelFile: File, bestellungenFile: File) => {
    dispatch({ type: 'SET_API_LOADING', payload: true });
    dispatch({ type: 'SET_API_ERROR', payload: null });
    try {
      const formData = new FormData();
      formData.append('artikel', artikelFile);
      formData.append('bestellungen', bestellungenFile);
      const res = await fetch('/api/upload/static', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      dispatch({
        type: 'SET_API_STATUS',
        payload: {
          hasStaticData: true,
          artikelCount: result.artikelCount,
          bestellungenCount: result.bestellungenCount,
        },
      });
    } catch (err) {
      dispatch({ type: 'SET_API_ERROR', payload: `Upload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` });
      throw err;
    } finally {
      dispatch({ type: 'SET_API_LOADING', payload: false });
    }
  }, []);

  const uploadBestandData = useCallback(async (bestandFile: File) => {
    dispatch({ type: 'SET_API_LOADING', payload: true });
    dispatch({ type: 'SET_API_ERROR', payload: null });
    try {
      const formData = new FormData();
      formData.append('bestand', bestandFile);
      const res = await fetch('/api/upload/bestand', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      // Refresh status after bestand upload
      const statusRes = await fetch('/api/status');
      if (statusRes.ok) {
        const status: ApiStatus = await statusRes.json();
        dispatch({ type: 'SET_API_STATUS', payload: status });
      }
    } catch (err) {
      dispatch({ type: 'SET_API_ERROR', payload: `Bestand-Upload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` });
      throw err;
    } finally {
      dispatch({ type: 'SET_API_LOADING', payload: false });
    }
  }, []);

  const loadApiData = useCallback(async (): Promise<ApiData> => {
    dispatch({ type: 'SET_API_LOADING', payload: true });
    dispatch({ type: 'SET_API_ERROR', payload: null });
    try {
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiData = await res.json();
      dispatch({ type: 'SET_API_DATA', payload: data });
      return data;
    } catch (err) {
      dispatch({ type: 'SET_API_ERROR', payload: `Daten laden fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` });
      throw err;
    } finally {
      dispatch({ type: 'SET_API_LOADING', payload: false });
    }
  }, []);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <AppActionsContext.Provider value={{ checkApiStatus, uploadStaticData, uploadBestandData, loadApiData }}>
          {children}
        </AppActionsContext.Provider>
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

export function useAppActions() {
  return useContext(AppActionsContext);
}

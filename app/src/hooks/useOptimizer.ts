import { useRef, useCallback } from 'react';
import { useAppDispatch } from '../context/AppContext';
import type { WorkerMessage } from '../workers/optimizer.worker';
import type { WTConfig, ArtikelData, BestellungData, UmsatzData, BestandData } from '../types';

export function useOptimizer() {
  const workerRef = useRef<Worker | null>(null);
  const dispatch = useAppDispatch();

  const startOptimization = useCallback((
    artikel: ArtikelData[],
    bestellungen: BestellungData[],
    umsatz: UmsatzData[],
    bestand: BestandData[],
    config: WTConfig
  ) => {
    if (workerRef.current) workerRef.current.terminate();

    workerRef.current = new Worker(
      new URL('../workers/optimizer.worker.ts', import.meta.url),
      { type: 'module' }
    );

    dispatch({ type: 'SET_OPTIMIZATION_STATUS', status: 'running' });

    workerRef.current.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        dispatch({
          type: 'SET_OPTIMIZATION_PROGRESS',
          payload: { phase: msg.phase!, phaseName: msg.phaseName ?? '', progress: msg.progress! },
        });
      } else if (msg.type === 'result') {
        dispatch({ type: 'SET_RESULT', payload: msg.result! });
        dispatch({ type: 'SET_OPTIMIZATION_STATUS', status: 'done' });
      } else if (msg.type === 'error') {
        dispatch({ type: 'SET_OPTIMIZATION_STATUS', status: 'error' });
        console.error('Worker error:', msg.error);
      }
    };

    workerRef.current.onerror = (err) => {
      dispatch({ type: 'SET_OPTIMIZATION_STATUS', status: 'error' });
      console.error('Worker error:', err);
    };

    workerRef.current.postMessage({ artikel, bestellungen, umsatz, bestand, config });
  }, [dispatch]);

  const stopOptimization = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    dispatch({ type: 'SET_OPTIMIZATION_STATUS', status: 'idle' });
  }, [dispatch]);

  return { startOptimization, stopOptimization };
}

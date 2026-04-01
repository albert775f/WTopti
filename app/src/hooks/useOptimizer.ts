import { useRef, useCallback } from 'react';
import { useAppDispatch } from '../context/AppContext';
import type { WorkerMessage } from '../workers/optimizer.worker';
import type { WTConfig, ArtikelData, BestellungData, BestandData } from '../types';

export function useOptimizer() {
  const workerRef = useRef<Worker | null>(null);
  const dispatch = useAppDispatch();

  const startOptimization = useCallback((data: {
    artikel: ArtikelData[];
    bestellungen: BestellungData[];
    bestand: BestandData[];
    config: WTConfig;
  }) => {
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
        // Persist run to server (fire-and-forget)
        const r = msg.result!;
        fetch('http://localhost:3001/api/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: data.config,
            stats: r.stats,
            metrics: r.validation_dashboard?.metrics ?? null,
            result: r,
          }),
        }).catch(err => console.warn('Failed to save run:', err));
      } else if (msg.type === 'error') {
        dispatch({ type: 'SET_OPTIMIZATION_STATUS', status: 'error' });
        console.error('Worker error:', msg.error);
      }
    };

    workerRef.current.onerror = (err) => {
      dispatch({ type: 'SET_OPTIMIZATION_STATUS', status: 'error' });
      console.error('Worker error:', err);
    };

    workerRef.current.postMessage(data);
  }, [dispatch]);

  const stopOptimization = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    dispatch({ type: 'SET_OPTIMIZATION_STATUS', status: 'idle' });
  }, [dispatch]);

  return { startOptimization, stopOptimization };
}

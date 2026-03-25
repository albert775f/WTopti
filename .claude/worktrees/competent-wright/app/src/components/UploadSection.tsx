import { useCallback, useState, type DragEvent } from 'react';
import { useAppState, useAppDispatch, useAppActions } from '../context/AppContext';
import type { WTConfig } from '../types';

interface DropZoneProps {
  label: string;
  accept?: string;
  file: File | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}

function DropZone({ label, file, onFile, disabled }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile, disabled]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  }, [disabled]);

  const hasFile = file !== null;
  const borderColor = hasFile
    ? 'border-green-500 bg-green-50'
    : dragOver
    ? 'border-blue-500 bg-blue-50'
    : disabled
    ? 'border-gray-200 bg-gray-50'
    : 'border-gray-300 bg-white';

  const icon = hasFile ? '✓' : '↑';
  const iconColor = hasFile ? 'text-green-600' : disabled ? 'text-gray-300' : 'text-gray-400';

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${borderColor} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onClick={() => {
        if (disabled) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,.xlsx,.xls';
        input.onchange = () => {
          if (input.files?.[0]) onFile(input.files[0]);
        };
        input.click();
      }}
    >
      <span className={`text-2xl ${iconColor}`}>{icon}</span>
      <p className="mt-1 text-sm font-medium text-gray-700">{label}</p>
      {hasFile ? (
        <p className="text-xs text-green-600">{file.name}</p>
      ) : (
        <p className="text-xs text-gray-500">CSV / XLSX / XLS</p>
      )}
    </div>
  );
}

function ConfigPanel() {
  const { config } = useAppState();
  const dispatch = useAppDispatch();

  const update = (partial: Partial<WTConfig>) => dispatch({ type: 'SET_CONFIG', payload: partial });

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Konfiguration</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <label className="block">
          <span className="text-gray-600">WT Klein</span>
          <input type="number" value={config.anzahl_klein}
            onChange={(e) => update({ anzahl_klein: +e.target.value })}
            className="mt-1 block w-full rounded border-gray-300 border px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-gray-600">WT Groß</span>
          <input type="number" value={config.anzahl_gross}
            onChange={(e) => update({ anzahl_gross: +e.target.value })}
            className="mt-1 block w-full rounded border-gray-300 border px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-gray-600">Gewicht Hard (kg)</span>
          <input type="number" value={config.gewicht_hard_kg}
            onChange={(e) => update({ gewicht_hard_kg: +e.target.value })}
            className="mt-1 block w-full rounded border-gray-300 border px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-gray-600">Gewicht Soft (kg)</span>
          <input type="number" value={config.gewicht_soft_kg}
            onChange={(e) => update({ gewicht_soft_kg: +e.target.value })}
            className="mt-1 block w-full rounded border-gray-300 border px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-gray-600">Höhenlimit (mm)</span>
          <input type="number" value={config.hoehe_limit_mm}
            onChange={(e) => update({ hoehe_limit_mm: +e.target.value })}
            className="mt-1 block w-full rounded border-gray-300 border px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-gray-600">Co-Occurrence Schwellwert</span>
          <input type="number" value={config.co_occurrence_schwellwert}
            onChange={(e) => update({ co_occurrence_schwellwert: +e.target.value })}
            className="mt-1 block w-full rounded border-gray-300 border px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-gray-600">A-Artikel Scatter (Kopien)</span>
          <input type="number" value={config.a_artikel_scatter_n} min={1} max={10}
            onChange={(e) => update({ a_artikel_scatter_n: Math.max(1, Math.min(10, +e.target.value)) })}
            className="mt-1 block w-full rounded border-gray-300 border px-2 py-1" />
          <span className="text-xs text-gray-400">Anzahl WTs auf die A-Artikel verteilt werden</span>
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Lagerfläche (m²)</span>
          <input type="number" step="0.01" value={config.warehouse_area_m2 ?? 1480.65}
            onChange={(e) => update({ warehouse_area_m2: +e.target.value })}
            className="mt-1 block w-full rounded border-gray-300 border px-2 py-1 text-sm" />
          <span className="text-xs text-gray-400">STOROJET Rack-Gesamtfläche</span>
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Min. Fachgröße (mm)</span>
          <input type="number" min={0} step={10} value={config.min_segment_mm ?? 90}
            onChange={(e) => update({ min_segment_mm: Math.max(0, +e.target.value) })}
            className="mt-1 block w-full rounded border-gray-300 border px-2 py-1 text-sm" />
          <span className="text-xs text-gray-400">Mindestbreite UND -tiefe jedes Fachs (Greifraumregel)</span>
        </label>
        <div className="block">
          <span className="text-gray-500 text-xs">Teilerbreite: <strong>5 mm</strong> (fest)</span>
        </div>
      </div>
    </div>
  );
}

export default function UploadSection({ onStartOptimization }: { onStartOptimization?: (data: { artikel: any[]; bestellungen: any[]; bestand: any[] }) => void }) {
  const state = useAppState();
  const { uploadStaticData, uploadBestandData, loadApiData } = useAppActions();

  const [artikelFile, setArtikelFile] = useState<File | null>(null);
  const [bestellungenFile, setBestellungenFile] = useState<File | null>(null);
  const [bestandFile, setBestandFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [showReupload, setShowReupload] = useState(false);

  const hasStaticData = state.apiStatus?.hasStaticData === true;

  const handleStaticUpload = useCallback(async () => {
    if (!artikelFile || !bestellungenFile) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      await uploadStaticData(artikelFile, bestellungenFile);
      setUploadMsg('Statische Daten erfolgreich hochgeladen!');
      setArtikelFile(null);
      setBestellungenFile(null);
      setShowReupload(false);
    } catch {
      setUploadMsg('Upload fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setUploading(false);
    }
  }, [artikelFile, bestellungenFile, uploadStaticData]);

  const handleStartOptimization = useCallback(async () => {
    if (!bestandFile) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      await uploadBestandData(bestandFile);
      const data = await loadApiData();
      setBestandFile(null);
      if (onStartOptimization) {
        onStartOptimization(data);
      }
    } catch {
      setUploadMsg('Fehler beim Starten der Optimierung.');
    } finally {
      setUploading(false);
    }
  }, [bestandFile, uploadBestandData, loadApiData, onStartOptimization]);

  const formatDate = (iso?: string) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">Daten-Upload</h2>

      {/* State A: No static data OR re-uploading */}
      {(!hasStaticData || showReupload) && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-base font-semibold text-gray-800 mb-1">
            Ersteinrichtung — Statische Daten
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Diese Dateien werden einmalig hochgeladen und persistent gespeichert.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <DropZone
              label="Artikelliste.xlsx"
              file={artikelFile}
              onFile={setArtikelFile}
              disabled={uploading}
            />
            <DropZone
              label="Bestellungen.xlsx"
              file={bestellungenFile}
              onFile={setBestellungenFile}
              disabled={uploading}
            />
          </div>
          {uploadMsg && (
            <p className={`mt-3 text-sm ${uploadMsg.includes('erfolgreich') ? 'text-green-600' : 'text-red-600'}`}>
              {uploadMsg}
            </p>
          )}
          <div className="flex gap-2 mt-4">
            <button
              disabled={!artikelFile || !bestellungenFile || uploading}
              className={`flex-1 py-2.5 rounded-lg text-white font-semibold transition-colors ${
                artikelFile && bestellungenFile && !uploading
                  ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                  : 'bg-gray-300 cursor-not-allowed'
              }`}
              onClick={handleStaticUpload}
            >
              {uploading ? 'Wird hochgeladen...' : 'Statische Daten hochladen und verarbeiten'}
            </button>
            {showReupload && (
              <button
                onClick={() => { setShowReupload(false); setUploadMsg(null); }}
                className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Abbrechen
              </button>
            )}
          </div>
        </div>
      )}

      {/* State B: Static data loaded */}
      {hasStaticData && !showReupload && (
        <div className="space-y-4">
          <div className="bg-green-50 rounded-lg border border-green-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-800">
                  Statische Daten geladen
                </p>
                <p className="text-sm text-green-700">
                  {state.apiStatus?.artikelCount?.toLocaleString('de-DE')} Artikel
                  {' · '}
                  {state.apiStatus?.bestellungenCount?.toLocaleString('de-DE')} Bestellungen
                </p>
              </div>
              <button
                onClick={() => setShowReupload(true)}
                className="text-xs text-green-700 hover:text-green-900 underline"
              >
                Neu hochladen
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-1">
              Bestandsliste hochladen
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {state.apiStatus?.lastBestandUpload
                ? `Letzte Bestandsliste: ${formatDate(state.apiStatus.lastBestandUpload)}`
                : 'Keine Bestandsliste geladen'}
            </p>
            <DropZone
              label="Bestandsliste (.xls / .xlsx)"
              file={bestandFile}
              onFile={setBestandFile}
              disabled={uploading}
            />
            {uploadMsg && (
              <p className={`mt-3 text-sm ${uploadMsg.includes('erfolgreich') ? 'text-green-600' : 'text-red-600'}`}>
                {uploadMsg}
              </p>
            )}
            {state.apiError && (
              <p className="mt-3 text-sm text-red-600">{state.apiError}</p>
            )}
            <button
              disabled={!bestandFile || uploading}
              className={`mt-4 w-full py-3 rounded-lg text-white font-semibold transition-colors ${
                bestandFile && !uploading
                  ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                  : 'bg-gray-300 cursor-not-allowed'
              }`}
              onClick={handleStartOptimization}
            >
              {uploading ? 'Wird verarbeitet...' : 'Optimierung starten'}
            </button>
          </div>
        </div>
      )}

      <ConfigPanel />
    </div>
  );
}

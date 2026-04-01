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

function ReadOnlyRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex items-start justify-between py-1.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <p className="text-xs text-gray-400 mt-0.5">{note}</p>
      </div>
      <span className="ml-4 text-xs font-mono text-gray-600 whitespace-nowrap">{value}</span>
    </div>
  );
}

function ConfigPanel() {
  const { config } = useAppState();
  const dispatch = useAppDispatch();

  const update = (partial: Partial<WTConfig>) => dispatch({ type: 'SET_CONFIG', payload: partial });

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-700">Konfiguration</h3>

      {/* Editable params */}
      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-gray-700">Griffpuffer (mm)</span>
          <input
            type="number" min={0} step={5}
            value={config.griff_puffer_mm ?? 0}
            onChange={(e) => update({ griff_puffer_mm: Math.max(0, +e.target.value) })}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <span className="text-xs text-gray-400">Freiraum zum Greifen auf mind. einer Seite</span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-700">Teilerbreite (mm)</span>
          <input
            type="number" min={0} step={1}
            value={config.teiler_breite_mm ?? 5}
            onChange={(e) => update({ teiler_breite_mm: Math.max(0, +e.target.value) })}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <span className="text-xs text-gray-400">Materialbreite des Zonenteilers — reduziert nutzbare Fachtiefe</span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-700">Lagerbestand-Multiplikator</span>
          <input
            type="number" min={0.1} max={5} step={0.1}
            value={config.stock_multiplier ?? 1.0}
            onChange={(e) => update({ stock_multiplier: Math.max(0.1, +e.target.value) })}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <span className="text-xs text-gray-400">1.0 = ein Spitzenmonat, 1.5 = 50% Puffer</span>
        </label>
      </div>

      {/* Read-only params */}
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Festwerte (nicht editierbar)</p>
        <div className="bg-gray-50 rounded border border-gray-100 px-3 py-1">
          <ReadOnlyRow
            label="Höhenlimit"
            value={`${config.hoehe_limit_mm} mm`}
            note="Max. Stapelhöhe pro Fach (entspricht WT-Rastermaß)"
          />
          <ReadOnlyRow
            label="Gewicht Hard"
            value={`${config.gewicht_hard_kg} kg`}
            note="Absolutes Gewichtslimit je WT — wird nie überschritten"
          />
          <ReadOnlyRow
            label="Gewicht Soft"
            value={`${config.gewicht_soft_kg} kg`}
            note="Zielgewicht je WT — leichte Überschreitung erlaubt"
          />
          <ReadOnlyRow
            label="Min. Fachgröße"
            value={`${config.min_segment_mm ?? 90} mm`}
            note="Mindestbreite und -tiefe eines Fachs (Greifraumregel)"
          />
          <ReadOnlyRow
            label="Affinity-Schwellwert"
            value={`P(B|A) ≥ ${config.affinity_threshold}`}
            note="Minimale bedingte Kaufwahrscheinlichkeit für Affinitätspaarung"
          />
          <ReadOnlyRow
            label="Min. Bestellungen Seed"
            value={`${config.affinity_min_orders_a}`}
            note="Seed-Artikel muss mind. so oft bestellt worden sein"
          />
          <ReadOnlyRow
            label="Min. aktive Monate"
            value={`${config.min_active_months ?? 3}`}
            note="Artikel mit Käufen in weniger Monaten werden ausgeschlossen"
          />
          <ReadOnlyRow
            label="Min. Co-Occurrence"
            value={`${config.affinity_min_count}`}
            note="Gemeinsame Bestellungen für gültige Affinitätsbeziehung"
          />
          <ReadOnlyRow
            label="Lagerfläche"
            value={`${config.warehouse_area_m2 ?? 1480.65} m²`}
            note="Derzeit nicht verwendet (Phase 5 entfernt)"
          />
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

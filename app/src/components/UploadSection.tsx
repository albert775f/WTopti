import { useCallback, useState, useMemo, DragEvent } from 'react';
import { useAppState, useAppDispatch } from '../context/AppContext';
import { parseFile, mapArtikel, mapBestellungen, mapUmsatz, mapBestand, validateHeaders } from '../utils/fileParser';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  ColumnDef,
} from '@tanstack/react-table';
import type { WTConfig } from '../types';

type FileType = 'artikel' | 'bestellungen' | 'umsatz' | 'bestand';

interface FileInfo {
  name: string;
  rows: number;
  preview: Record<string, unknown>[];
}

const FILE_LABELS: Record<FileType, string> = {
  artikel: 'Artikelliste',
  bestellungen: 'Bestellungen',
  umsatz: 'Artikelumsatz',
  bestand: 'Bestandsliste',
};

function PreviewTable({ data }: { data: Record<string, unknown>[] }) {
  const columns = useMemo(() => {
    if (data.length === 0) return [];
    const helper = createColumnHelper<Record<string, unknown>>();
    return Object.keys(data[0]).slice(0, 8).map((key) =>
      helper.accessor((row) => row[key], {
        id: key,
        header: key,
        cell: (info) => {
          const v = info.getValue();
          return v == null ? '' : String(v);
        },
      })
    ) as ColumnDef<Record<string, unknown>, unknown>[];
  }, [data]);

  const table = useReactTable({
    data: data.slice(0, 10),
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (data.length === 0) return null;

  return (
    <div className="mt-2 overflow-x-auto text-xs">
      <table className="min-w-full border border-gray-200">
        <thead className="bg-gray-50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="px-2 py-1 text-left font-medium text-gray-600 border-b">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b hover:bg-gray-50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-2 py-1 text-gray-700 max-w-[150px] truncate">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DropZone({ fileType, onFile }: { fileType: FileType; onFile: (file: File) => void }) {
  const { uploadStatus } = useAppState();
  const status = uploadStatus[fileType];
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const borderColor = status === 'valid'
    ? 'border-green-500 bg-green-50'
    : status === 'error'
    ? 'border-red-500 bg-red-50'
    : dragOver
    ? 'border-blue-500 bg-blue-50'
    : 'border-gray-300 bg-white';

  const icon = status === 'valid' ? '✓' : status === 'error' ? '✗' : status === 'loading' ? '⏳' : '↑';
  const iconColor = status === 'valid' ? 'text-green-600' : status === 'error' ? 'text-red-600' : 'text-gray-400';

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${borderColor}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onClick={() => {
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
      <p className="mt-1 text-sm font-medium text-gray-700">{FILE_LABELS[fileType]}</p>
      <p className="text-xs text-gray-500">CSV / XLSX</p>
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
        <div className="col-span-2 md:col-span-3">
          <span className="text-gray-600 text-sm">Teiler-Modus</span>
          <div className="flex items-center gap-4 mt-1">
            <label className="flex items-center gap-1">
              <input type="radio" name="teiler" checked={config.teiler_modus === 'percent'}
                onChange={() => update({ teiler_modus: 'percent' })} />
              <span className="text-sm">Pauschal {config.teiler_verlust_prozent}%</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="teiler" checked={config.teiler_modus === 'exact'}
                onChange={() => update({ teiler_modus: 'exact' })} />
              <span className="text-sm">Exakt ({config.teiler_breite_mm} mm)</span>
            </label>
          </div>
          {config.teiler_modus === 'percent' ? (
            <input type="number" value={config.teiler_verlust_prozent}
              onChange={(e) => update({ teiler_verlust_prozent: +e.target.value })}
              className="mt-1 w-24 rounded border-gray-300 border px-2 py-1 text-sm" />
          ) : (
            <input type="number" value={config.teiler_breite_mm}
              onChange={(e) => update({ teiler_breite_mm: +e.target.value })}
              className="mt-1 w-24 rounded border-gray-300 border px-2 py-1 text-sm" />
          )}
        </div>
      </div>
    </div>
  );
}

export default function UploadSection() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [files, setFiles] = useState<Record<FileType, FileInfo | null>>({
    artikel: null, bestellungen: null, umsatz: null, bestand: null,
  });
  const [activePreview, setActivePreview] = useState<FileType | null>(null);

  const handleFile = useCallback(async (fileType: FileType, file: File) => {
    dispatch({ type: 'SET_UPLOAD_STATUS', key: fileType, status: 'loading' });
    try {
      const rows = await parseFile(file);
      const { valid, missing } = validateHeaders(rows, fileType);

      if (!valid) {
        dispatch({ type: 'SET_UPLOAD_STATUS', key: fileType, status: 'error' });
        dispatch({ type: 'SET_UPLOAD_ERROR', key: fileType, error: `Fehlende Spalten: ${missing.join(', ')}` });
        return;
      }

      // Map and store data
      switch (fileType) {
        case 'artikel':
          dispatch({ type: 'SET_ARTIKEL', payload: mapArtikel(rows) });
          break;
        case 'bestellungen':
          dispatch({ type: 'SET_BESTELLUNGEN', payload: mapBestellungen(rows) });
          break;
        case 'umsatz':
          dispatch({ type: 'SET_UMSATZ', payload: mapUmsatz(rows) });
          break;
        case 'bestand':
          dispatch({ type: 'SET_BESTAND', payload: mapBestand(rows) });
          break;
      }

      setFiles((prev) => ({
        ...prev,
        [fileType]: { name: file.name, rows: rows.length, preview: rows.slice(0, 10) },
      }));
      dispatch({ type: 'SET_UPLOAD_STATUS', key: fileType, status: 'valid' });
    } catch (err) {
      dispatch({ type: 'SET_UPLOAD_STATUS', key: fileType, status: 'error' });
      dispatch({ type: 'SET_UPLOAD_ERROR', key: fileType, error: String(err) });
    }
  }, [dispatch]);

  const allValid = (Object.keys(state.uploadStatus) as FileType[]).every(
    (k) => state.uploadStatus[k] === 'valid'
  );

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">Daten-Upload</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(Object.keys(FILE_LABELS) as FileType[]).map((ft) => (
          <div key={ft}>
            <DropZone fileType={ft} onFile={(f) => handleFile(ft, f)} />
            {files[ft] && (
              <div className="mt-1 text-xs text-gray-500 flex items-center justify-between">
                <span>{files[ft]!.name} ({files[ft]!.rows} Zeilen)</span>
                <button
                  onClick={() => setActivePreview(activePreview === ft ? null : ft)}
                  className="text-blue-600 hover:underline"
                >
                  {activePreview === ft ? 'Ausblenden' : 'Vorschau'}
                </button>
              </div>
            )}
            {state.uploadErrors[ft] && state.uploadStatus[ft] === 'error' && (
              <p className="mt-1 text-xs text-red-600">{state.uploadErrors[ft]}</p>
            )}
          </div>
        ))}
      </div>

      {activePreview && files[activePreview] && (
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <h3 className="text-sm font-medium text-gray-700 mb-1">
            Vorschau: {FILE_LABELS[activePreview]}
          </h3>
          <PreviewTable data={files[activePreview]!.preview} />
        </div>
      )}

      <ConfigPanel />

      <button
        disabled={!allValid}
        className={`w-full py-3 rounded-lg text-white font-semibold transition-colors ${
          allValid
            ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
            : 'bg-gray-300 cursor-not-allowed'
        }`}
        onClick={() => {
          if (allValid) {
            dispatch({ type: 'SET_SECTION', section: 'abc' });
          }
        }}
      >
        Optimierung starten
      </button>
    </div>
  );
}

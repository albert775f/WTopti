import { useState, useMemo } from 'react';
import type { WT, BestellungData } from '../../types';

interface Props {
  wts: WT[];
  bestellungen: BestellungData[];
}

export default function OrderSimulator({ wts, bestellungen }: Props) {
  const [mode, setMode] = useState<'historic' | 'manual'>('historic');
  const [belegnummer, setBelegnummer] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [result, setResult] = useState<Array<{ artikel: string; wtIds: string[]; wtTyp: string }> | null>(null);

  const artikelToWTs = useMemo(() => {
    const m = new Map<string, { id: string; typ: string }[]>();
    for (const wt of wts) {
      for (const pos of wt.positionen) {
        if (!m.has(pos.artikelnummer)) m.set(pos.artikelnummer, []);
        m.get(pos.artikelnummer)!.push({ id: wt.id, typ: wt.typ });
      }
    }
    return m;
  }, [wts]);

  const bestellungMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const b of bestellungen) {
      if (!m.has(b.belegnummer)) m.set(b.belegnummer, new Set());
      m.get(b.belegnummer)!.add(b.artikelnummer);
    }
    return m;
  }, [bestellungen]);

  const belegnummern = useMemo(() => Array.from(bestellungMap.keys()).slice(0, 200).sort(), [bestellungMap]);

  const simulate = () => {
    let artikelList: string[];
    if (mode === 'historic') {
      artikelList = Array.from(bestellungMap.get(belegnummer) ?? []);
    } else {
      artikelList = manualInput.split('\n').map(s => s.trim()).filter(Boolean);
    }
    const rows = artikelList.map(artNr => {
      const wtsForArt = artikelToWTs.get(artNr) ?? [];
      return {
        artikel: artNr,
        wtIds: wtsForArt.map(w => w.id),
        wtTyp: wtsForArt[0]?.typ ?? 'N/A',
      };
    });
    setResult(rows);
  };

  const uniqueWTs = result ? new Set(result.flatMap(r => r.wtIds)).size : 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={mode === 'historic'} onChange={() => setMode('historic')} /> Historische Bestellung
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} /> Manuelle Eingabe
        </label>
      </div>

      {mode === 'historic' ? (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Beleg-Nr.:</label>
          <input
            list="belegnr-list"
            value={belegnummer}
            onChange={e => setBelegnummer(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-48"
            placeholder="Beleg-Nr. eingeben"
          />
          <datalist id="belegnr-list">
            {belegnummern.map(b => <option key={b} value={b} />)}
          </datalist>
          <button onClick={simulate} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Simulieren</button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            placeholder="Eine Artikelnummer pro Zeile..."
            className="w-full border rounded px-2 py-1 text-sm font-mono h-24"
          />
          <button onClick={simulate} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Simulieren</button>
        </div>
      )}

      {result && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">
            {result.length} Artikel → <span className={uniqueWTs <= 3 ? 'text-green-600' : uniqueWTs <= 6 ? 'text-yellow-600' : 'text-red-600'}>{uniqueWTs} verschiedene WTs</span>
          </p>
          <table className="w-full text-xs border border-gray-200 rounded overflow-hidden">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-600">
                <th className="py-1 px-2">Artikel-Nr.</th>
                <th className="py-1 px-2">WT-IDs</th>
                <th className="py-1 px-2">Typ</th>
              </tr>
            </thead>
            <tbody>
              {result.map((r, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-0.5 px-2 font-mono">{r.artikel}</td>
                  <td className="py-0.5 px-2">{r.wtIds.length > 0 ? r.wtIds.join(', ') : <span className="text-red-500">Nicht gefunden</span>}</td>
                  <td className="py-0.5 px-2">{r.wtTyp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

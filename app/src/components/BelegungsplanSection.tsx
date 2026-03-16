import { useMemo, useState } from 'react';
import { useAppState } from '../context/AppContext';
import type { BelegungsplanRow, WTTyp } from '../types';

interface GroupedWT {
  warentraeger_id: string;
  warentraeger_typ: WTTyp;
  gesamtgewicht_kg: number;
  flaeche_netto_pct: number;
  cluster_id: number;
  artikelCount: number;
  children: BelegungsplanRow[];
}

export default function BelegungsplanSection() {
  const { result } = useAppState();
  const [globalFilter, setGlobalFilter] = useState('');
  const [typFilter, setTypFilter] = useState<string>('all');
  const [abcFilter, setAbcFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    if (!result) return [];
    const map = new Map<string, GroupedWT>();
    for (const row of result.belegungsplan) {
      if (!map.has(row.warentraeger_id)) {
        map.set(row.warentraeger_id, {
          warentraeger_id: row.warentraeger_id,
          warentraeger_typ: row.warentraeger_typ,
          gesamtgewicht_kg: row.gesamtgewicht_kg,
          flaeche_netto_pct: row.flaeche_netto_pct,
          cluster_id: row.cluster_id,
          artikelCount: 0,
          children: [],
        });
      }
      const g = map.get(row.warentraeger_id)!;
      g.children.push(row);
      g.artikelCount = g.children.length;
    }
    return [...map.values()];
  }, [result]);

  const filtered = useMemo(() => {
    let data = grouped;
    if (typFilter !== 'all') {
      data = data.filter((g) => g.warentraeger_typ === typFilter);
    }
    if (abcFilter !== 'all') {
      data = data.filter((g) => g.children.some((c) => c.abc_klasse === abcFilter));
    }
    return data;
  }, [grouped, typFilter, abcFilter]);

  function exportCsv() {
    if (!result) return;
    const headers = ['WT-ID', 'Typ', 'Artikel', 'Bezeichnung', 'Stück', 'Gewicht (kg)', 'Fläche %', 'Cluster', 'ABC', 'Teiler'];
    const rows = result.belegungsplan.map((r) =>
      [r.warentraeger_id, r.warentraeger_typ, r.artikelnummer, r.bezeichnung,
       r.stueckzahl, r.gesamtgewicht_kg, r.flaeche_netto_pct, r.cluster_id, r.abc_klasse, r.anzahl_teiler]
    );
    const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'belegungsplan.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function getRowBg(gewicht: number): string {
    if (gewicht > 24) return 'bg-red-100';
    if (gewicht > 20) return 'bg-orange-100';
    return 'bg-green-50';
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <p>Keine Ergebnisse vorhanden. Bitte zuerst Optimierung starten.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">Belegungsplan</h2>
        <button onClick={exportCsv}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          CSV Export
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-lg p-3">
        <label className="text-sm text-gray-600">
          WT-Typ:
          <select value={typFilter} onChange={(e) => setTypFilter(e.target.value)}
            className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="all">Alle</option>
            <option value="KLEIN">Klein</option>
            <option value="GROSS">Groß</option>
          </select>
        </label>
        <label className="text-sm text-gray-600">
          ABC:
          <select value={abcFilter} onChange={(e) => setAbcFilter(e.target.value)}
            className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="all">Alle</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <input type="text" placeholder="Suche WT-ID / Artikel..."
          value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1 text-sm flex-1" />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600 border-b w-8"></th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 border-b">WT-ID</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 border-b">Typ</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 border-b">Artikel</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 border-b">Gewicht (kg)</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 border-b">Fläche %</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 border-b">Cluster</th>
            </tr>
          </thead>
          <tbody>
            {filtered
              .filter((g) => !globalFilter ||
                g.warentraeger_id.toLowerCase().includes(globalFilter.toLowerCase()) ||
                g.children.some((c) => c.artikelnummer.toLowerCase().includes(globalFilter.toLowerCase()))
              )
              .slice(0, 100)
              .map((g) => (
              <WTGroupRow key={g.warentraeger_id} group={g}
                expanded={!!expanded[g.warentraeger_id]}
                onToggle={() => setExpanded((e) => ({ ...e, [g.warentraeger_id]: !e[g.warentraeger_id] }))}
                getRowBg={getRowBg} />
            ))}
          </tbody>
        </table>
        {filtered.length > 100 && (
          <p className="text-center text-xs text-gray-400 py-2">Zeige 100 von {filtered.length} WTs</p>
        )}
      </div>
    </div>
  );
}

function WTGroupRow({ group, expanded, onToggle, getRowBg }: {
  group: GroupedWT;
  expanded: boolean;
  onToggle: () => void;
  getRowBg: (g: number) => string;
}) {
  return (
    <>
      <tr className={`border-b cursor-pointer hover:bg-gray-100 ${getRowBg(group.gesamtgewicht_kg)}`}
        onClick={onToggle}>
        <td className="px-3 py-2 text-gray-500">{expanded ? '▼' : '▶'}</td>
        <td className="px-3 py-2 font-mono font-semibold">{group.warentraeger_id}</td>
        <td className="px-3 py-2">
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
            group.warentraeger_typ === 'KLEIN' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
          }`}>
            {group.warentraeger_typ === 'KLEIN' ? 'K' : 'G'}
          </span>
        </td>
        <td className="px-3 py-2 text-gray-600">{group.artikelCount} Artikel</td>
        <td className="px-3 py-2 text-right font-mono">{group.gesamtgewicht_kg.toFixed(1)}</td>
        <td className="px-3 py-2 text-right font-mono">{group.flaeche_netto_pct.toFixed(1)}%</td>
        <td className="px-3 py-2 text-right">{group.cluster_id}</td>
      </tr>
      {expanded && group.children.map((c, i) => (
        <tr key={`${group.warentraeger_id}-${i}`} className="border-b bg-gray-50 text-xs">
          <td></td>
          <td className="px-3 py-1 pl-8 text-gray-400">└</td>
          <td className="px-3 py-1">
            <span className={`px-1.5 py-0.5 rounded text-xs font-bold text-white ${
              c.abc_klasse === 'A' ? 'bg-green-500' : c.abc_klasse === 'B' ? 'bg-yellow-500' : 'bg-gray-400'
            }`}>{c.abc_klasse}</span>
          </td>
          <td className="px-3 py-1 font-mono">{c.artikelnummer} – {c.bezeichnung}</td>
          <td className="px-3 py-1 text-right">{c.stueckzahl} Stk</td>
          <td className="px-3 py-1 text-right">{c.anzahl_teiler} Teiler</td>
          <td></td>
        </tr>
      ))}
    </>
  );
}

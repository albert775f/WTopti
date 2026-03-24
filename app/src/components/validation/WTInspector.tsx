import { useMemo, useState } from 'react';
import type { WT, WTPosition } from '../../types';

const AMPEL_COLORS = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' };
const ABC_COLORS: Record<string, string> = { A: '#22c55e', B: '#eab308', C: '#9ca3af' };

interface Props {
  wts: WT[];
  initialWTId?: string;
}

export default function WTInspector({ wts, initialWTId }: Props) {
  const [search, setSearch] = useState(initialWTId ?? '');
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (!initialWTId) return 0;
    const idx = wts.findIndex(w => w.id === initialWTId);
    return idx >= 0 ? idx : 0;
  });
  const [redFlagOnly, setRedFlagOnly] = useState(false);

  const filteredWTs = useMemo(() => {
    if (!redFlagOnly) return wts;
    return wts.filter(w =>
      w.gesamtgewicht_kg > 20 ||
      (w.positionen.length > 0 && w.flaeche_netto_pct < 30) ||
      w.positionen.length === 1
    );
  }, [wts, redFlagOnly]);

  const redFlagCount = useMemo(() =>
    wts.filter(w =>
      w.gesamtgewicht_kg > 20 ||
      (w.positionen.length > 0 && w.flaeche_netto_pct < 30) ||
      w.positionen.length === 1
    ).length,
  [wts]);

  const handleSearch = () => {
    if (!search.trim()) return;
    const q = search.toLowerCase();
    const idx = filteredWTs.findIndex(w =>
      w.id.toLowerCase().includes(q) ||
      w.positionen.some(p => p.artikelnummer.toLowerCase().includes(q))
    );
    if (idx >= 0) setCurrentIndex(idx);
  };

  const safeIndex = Math.min(currentIndex, Math.max(0, filteredWTs.length - 1));
  const wt = filteredWTs[safeIndex] as WT | undefined;

  const isKlein = wt?.typ === 'KLEIN';
  const svgW = 250;
  const svgH = isKlein ? 250 : 400;
  const scale = svgW / 500;

  const layoutRects = useMemo(() => {
    if (!wt) return [];
    const { grid_cols, zone_w_mm, zone_d_mm } = wt;
    return wt.positionen.map(pos => {
      const col = pos.zone_index % grid_cols;
      const row = Math.floor(pos.zone_index / grid_cols);
      return {
        x: col * (zone_w_mm + 5),
        y: row * (zone_d_mm + 5),
        w: zone_w_mm,
        h: zone_d_mm,
        pos,
      };
    });
  }, [wt]);

  const gewichtPct = wt ? (wt.gesamtgewicht_kg / 24) * 100 : 0;
  const gewichtColor = wt
    ? wt.gesamtgewicht_kg > 24 ? AMPEL_COLORS.red
    : wt.gesamtgewicht_kg > 20 ? AMPEL_COLORS.yellow
    : AMPEL_COLORS.green
    : AMPEL_COLORS.green;

  const ampels = [
    { label: 'Gewicht', ok: wt ? wt.gesamtgewicht_kg <= 24 : true },
    { label: 'Höhe', ok: true },
    { label: 'Fläche', ok: wt ? wt.flaeche_netto_pct <= 100 : true },
    { label: 'Constraints', ok: true },
  ];

  if (filteredWTs.length === 0) {
    return <div className="text-gray-400 text-sm text-center py-8">Keine WTs{redFlagOnly ? ' mit Auffälligkeiten' : ''} gefunden.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => setCurrentIndex(Math.max(0, safeIndex - 1))} disabled={safeIndex === 0}
          className="px-2 py-1 border rounded disabled:opacity-40 text-sm">◀</button>
        <span className="text-sm font-mono">
          {safeIndex + 1} / {filteredWTs.length}
          {wt && <span className="ml-2 text-gray-500">({wt.id})</span>}
        </span>
        <button onClick={() => setCurrentIndex(Math.min(filteredWTs.length - 1, safeIndex + 1))} disabled={safeIndex >= filteredWTs.length - 1}
          className="px-2 py-1 border rounded disabled:opacity-40 text-sm">▶</button>

        <div className="flex items-center gap-1 ml-4">
          <input type="text" placeholder="WT-ID / Artikel..." value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="border rounded px-2 py-1 text-sm w-36" />
          <button onClick={handleSearch} className="px-2 py-1 bg-blue-600 text-white rounded text-sm">Suche</button>
        </div>

        <button
          onClick={() => { setRedFlagOnly(!redFlagOnly); setCurrentIndex(0); }}
          className={`ml-auto px-3 py-1 rounded text-sm border ${redFlagOnly ? 'bg-red-100 border-red-300 text-red-700' : 'border-gray-300 text-gray-600'}`}
        >
          Red-Flag ({redFlagCount})
        </button>
      </div>

      {wt && (
        <div className="flex gap-4">
          {/* SVG */}
          <div className="flex-shrink-0">
            <div className="flex gap-3 text-xs text-gray-500 mb-1 flex-wrap">
              {ampels.map(a => (
                <span key={a.label} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: a.ok ? AMPEL_COLORS.green : AMPEL_COLORS.red }} />
                  {a.label}
                </span>
              ))}
            </div>
            <svg width={svgW} height={svgH} className="border border-gray-300 bg-gray-50 rounded">
              {layoutRects.map((r, i) => (
                <rect key={i}
                  x={r.x * scale} y={r.y * scale}
                  width={Math.max(1, r.w * scale)} height={Math.max(1, r.h * scale)}
                  fill={ABC_COLORS[r.pos.abc_klasse] ?? '#9ca3af'} stroke="#fff" strokeWidth={0.5} rx={1} opacity={0.85}
                />
              ))}
              {layoutRects.slice(1).map((r, i) => {
                const ty = (r.y - 2.5) * scale;
                return <line key={`t-${i}`} x1={0} y1={ty} x2={svgW} y2={ty} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,2" />;
              })}
            </svg>
            {/* Weight bar */}
            <div className="mt-2 w-full">
              <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                <span>Gewicht</span><span>{wt.gesamtgewicht_kg.toFixed(1)} / 24 kg</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="h-2 rounded-full" style={{ width: `${Math.min(100, gewichtPct)}%`, backgroundColor: gewichtColor }} />
              </div>
            </div>
          </div>

          {/* Article table */}
          <div className="flex-1 overflow-x-auto">
            <div className="text-xs text-gray-500 mb-1">
              <span className="font-semibold text-gray-700">{wt.id}</span>
              {' '}| {wt.typ} | Cluster {wt.cluster_id} | {wt.positionen.length} Typen | {wt.flaeche_netto_pct.toFixed(1)}% Fläche
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-1 pr-2">Kl.</th>
                  <th className="py-1 pr-2">Artikel-Nr.</th>
                  <th className="py-1 pr-2">Bezeichnung</th>
                  <th className="py-1 pr-2 text-right">Stk</th>
                  <th className="py-1 text-right">Ges. kg</th>
                </tr>
              </thead>
              <tbody>
                {wt.positionen.map((p, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-0.5 pr-2">
                      <span className={`px-1 rounded text-white text-xs font-bold ${p.abc_klasse === 'A' ? 'bg-green-500' : p.abc_klasse === 'B' ? 'bg-yellow-500' : 'bg-gray-400'}`}>{p.abc_klasse}</span>
                    </td>
                    <td className="py-0.5 pr-2 font-mono">{p.artikelnummer}</td>
                    <td className="py-0.5 pr-2 text-gray-600 truncate max-w-xs">{p.bezeichnung}</td>
                    <td className="py-0.5 pr-2 text-right">{p.stueckzahl}</td>
                    <td className="py-0.5 text-right">{(p.gewicht_kg * p.stueckzahl).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

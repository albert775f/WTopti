import { useMemo, useState } from 'react';
import { useAppState } from '../context/AppContext';
import type { WT, WTPosition } from '../types';

const CLUSTER_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];
const ABC_COLORS: Record<string, string> = { A: '#22c55e', B: '#eab308', C: '#9ca3af' };

type ColorMode = 'cluster' | 'abc';

export default function WTVisualization() {
  const { result } = useAppState();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>('abc');
  const [search, setSearch] = useState('');
  const [tooltip, setTooltip] = useState<{ x: number; y: number; pos: WTPosition } | null>(null);

  const wts = result?.wts ?? [];

  // Search: jump to first matching WT
  const handleSearch = () => {
    if (!search.trim()) return;
    const q = search.toLowerCase();
    const idx = wts.findIndex((wt) =>
      wt.id.toLowerCase().includes(q) ||
      wt.positionen.some((p) => p.artikelnummer.toLowerCase().includes(q))
    );
    if (idx >= 0) setCurrentIndex(idx);
  };

  const wt = wts[currentIndex] as WT | undefined;

  if (!result || wts.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <p>Keine Ergebnisse vorhanden. Bitte zuerst Optimierung starten.</p>
      </div>
    );
  }

  const isKlein = wt!.typ === 'KLEIN';
  const realDepth = isKlein ? 500 : 800;
  const svgW = 250;
  const svgH = isKlein ? 250 : 400;
  // Both KLEIN (500×500) and GROSS (500×800) map to svgW×svgH at scale 0.5
  const scale = svgW / 500;

  // Strip-aware layout: each position occupies strips along the depth axis
  const layoutRects = useMemo(() => {
    if (!wt) return [];
    const rects: { x: number; y: number; w: number; h: number; pos: WTPosition }[] = [];
    let curY = 0;

    for (let i = 0; i < wt.positionen.length; i++) {
      const pos = wt.positionen[i];

      // Use stored dimensions; fall back to sqrt approximation for legacy data
      const laenge = pos.laenge_mm ?? Math.sqrt(pos.grundflaeche_mm2);
      const breite = pos.breite_mm ?? Math.sqrt(pos.grundflaeche_mm2);
      const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);

      const slotsAcross = Math.max(1, Math.floor(500 / laenge));
      const capPerStrip = slotsAcross * maxStapel;
      const stripsNeeded = Math.max(1, Math.ceil(pos.stueckzahl / capPerStrip));

      // Teiler gap before each new article type (not before the first)
      if (i > 0) curY += 5;

      const rectW = Math.min(slotsAcross * laenge, 500);
      const rectH = stripsNeeded * breite;

      rects.push({ x: 0, y: curY, w: rectW, h: rectH, pos });
      curY += rectH;

      if (curY >= realDepth) break; // safety stop
    }
    return rects;
  }, [wt, realDepth]);

  function getColor(pos: WTPosition): string {
    if (colorMode === 'abc') return ABC_COLORS[pos.abc_klasse] ?? '#9ca3af';
    const clusterId = wt?.cluster_id ?? 0;
    return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
  }

  // Weight progress bar
  const gewichtPct = wt ? (wt.gesamtgewicht_kg / 24) * 100 : 0;
  const gewichtColor = wt
    ? wt.gesamtgewicht_kg > 24 ? '#ef4444'
    : wt.gesamtgewicht_kg > 20 ? '#f59e0b'
    : '#22c55e'
    : '#22c55e';

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">WT-Visualisierung</h2>

      {/* Controls */}
      <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-lg p-3">
        <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
          disabled={currentIndex === 0}
          className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40">←</button>
        <span className="text-sm font-mono">
          WT {currentIndex + 1} / {wts.length}
          {wt && <span className="ml-2 text-gray-500">({wt.id})</span>}
        </span>
        <button onClick={() => setCurrentIndex(Math.min(wts.length - 1, currentIndex + 1))}
          disabled={currentIndex >= wts.length - 1}
          className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40">→</button>

        <div className="ml-auto flex items-center gap-2">
          <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)}
            className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="abc">ABC-Klasse</option>
            <option value="cluster">Cluster</option>
          </select>
          <input type="text" placeholder="WT-ID / Artikel..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-40" />
          <button onClick={handleSearch}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Suche</button>
        </div>
      </div>

      {/* SVG */}
      {wt && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 relative">
          <div className="flex gap-4 text-xs text-gray-500 mb-2">
            <span>Typ: <strong>{wt.typ}</strong></span>
            <span>Gewicht: <strong>{wt.gesamtgewicht_kg.toFixed(1)} kg</strong></span>
            <span>Fläche: <strong>{wt.flaeche_netto_pct.toFixed(1)}%</strong></span>
            <span>Teiler: <strong>{wt.anzahl_teiler}</strong></span>
            <span>Cluster: <strong>{wt.cluster_id}</strong></span>
          </div>

          <svg width={svgW} height={svgH} className="border border-gray-300 bg-gray-50 rounded">
            {layoutRects.map((r, i) => (
              <rect key={i}
                x={r.x * scale} y={r.y * scale}
                width={Math.max(1, r.w * scale)} height={Math.max(1, r.h * scale)}
                fill={getColor(r.pos)} stroke="#fff" strokeWidth={0.5} rx={1}
                opacity={0.85}
                onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, pos: r.pos })}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}
            {/* Teiler lines at actual positions between article strips */}
            {layoutRects.slice(1).map((r, i) => {
              const teilerY = (r.y - 2.5) * scale;
              return <line key={`t-${i}`} x1={0} y1={teilerY} x2={svgW} y2={teilerY}
                stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,2" />;
            })}
          </svg>

          {/* Weight progress bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Gewicht</span>
              <span>{wt.gesamtgewicht_kg.toFixed(1)} / 24 kg</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, gewichtPct)}%`, backgroundColor: gewichtColor }} />
            </div>
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div className="fixed bg-gray-900 text-white text-xs px-3 py-2 rounded pointer-events-none z-50"
              style={{ left: tooltip.x + 10, top: tooltip.y - 40 }}>
              <p className="font-semibold">{tooltip.pos.bezeichnung}</p>
              <p>{tooltip.pos.artikelnummer} | {tooltip.pos.breite_mm ?? '?'}×{tooltip.pos.laenge_mm ?? '?'} mm</p>
              <p>{tooltip.pos.gewicht_kg.toFixed(2)} kg | {tooltip.pos.stueckzahl} Stk | {tooltip.pos.abc_klasse}</p>
            </div>
          )}
        </div>
      )}

      {/* Position list */}
      {wt && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Positionen auf {wt.id}</h3>
          <div className="space-y-1 text-sm">
            {wt.positionen.map((p, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold text-white ${
                  p.abc_klasse === 'A' ? 'bg-green-500' : p.abc_klasse === 'B' ? 'bg-yellow-500' : 'bg-gray-400'
                }`}>{p.abc_klasse}</span>
                <span className="font-mono">{p.artikelnummer}</span>
                <span className="text-gray-500 truncate flex-1">{p.bezeichnung}</span>
                <span className="text-gray-600">{p.stueckzahl} Stk</span>
                <span className="text-gray-600">{p.gewicht_kg.toFixed(2)} kg</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

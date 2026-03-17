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
  const scale = svgW / 500;

  // 2D zone layout: shelf-based packing
  const layoutRects = useMemo(() => {
    if (!wt) return [];
    const DIVIDER = 5; // mm
    const WT_W = 500;  // mm

    // Sort positions by zone area descending (largest zones first)
    const sorted = [...wt.positionen].sort((a, b) => {
      const aMaxStapel = Math.max(1, a.max_stapelhoehe ?? 1);
      const bMaxStapel = Math.max(1, b.max_stapelhoehe ?? 1);
      const aStacks = Math.ceil(a.stueckzahl / aMaxStapel);
      const bStacks = Math.ceil(b.stueckzahl / bMaxStapel);
      const aL = a.laenge_mm ?? Math.sqrt(a.grundflaeche_mm2);
      const bL = b.laenge_mm ?? Math.sqrt(b.grundflaeche_mm2);
      const aB = a.breite_mm ?? Math.sqrt(a.grundflaeche_mm2);
      const bB = b.breite_mm ?? Math.sqrt(b.grundflaeche_mm2);
      return (bStacks * bL * bB) - (aStacks * aL * aB);
    });

    const rects: { x: number; y: number; w: number; h: number; pos: WTPosition }[] = [];
    let curX = 0, curY = 0, shelfH = 0;

    for (const pos of sorted) {
      const laenge = pos.laenge_mm ?? Math.sqrt(pos.grundflaeche_mm2);
      const breite = pos.breite_mm ?? Math.sqrt(pos.grundflaeche_mm2);
      const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
      const stacksNeeded = Math.ceil(pos.stueckzahl / maxStapel);

      // Arrange stacks in a shelf: as many as fit across the WT width
      const maxAcross = Math.max(1, Math.floor(WT_W / laenge));
      const actualAcross = Math.min(stacksNeeded, maxAcross);
      const stackRows = Math.ceil(stacksNeeded / actualAcross);
      const zoneW = actualAcross * laenge;
      const zoneH = stackRows * breite;

      // If zone doesn't fit in current shelf, start a new shelf
      if (curX > 0 && curX + DIVIDER + zoneW > WT_W) {
        curY += shelfH + DIVIDER;
        curX = 0;
        shelfH = 0;
      }

      rects.push({ x: curX, y: curY, w: zoneW, h: zoneH, pos });
      curX += zoneW + DIVIDER;
      shelfH = Math.max(shelfH, zoneH);

      if (curY + zoneH >= realDepth) break;
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
          className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40">&#8592;</button>
        <span className="text-sm font-mono">
          WT {currentIndex + 1} / {wts.length}
          {wt && <span className="ml-2 text-gray-500">({wt.id})</span>}
        </span>
        <button onClick={() => setCurrentIndex(Math.min(wts.length - 1, currentIndex + 1))}
          disabled={currentIndex >= wts.length - 1}
          className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40">&#8594;</button>

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
            {/* Zone dividers: vertical within shelves, horizontal between shelves */}
            {layoutRects.map((r, i) => {
              const next = layoutRects[i + 1];
              if (!next) return null;
              const sameShelves = Math.abs(r.y - next.y) < 1;
              if (!sameShelves) {
                // Horizontal divider between shelves
                const lineY = (r.y + r.h + 2.5) * scale;
                return <line key={`d-${i}`} x1={0} y1={lineY} x2={svgW} y2={lineY}
                  stroke="#94a3b8" strokeWidth={0.5} strokeDasharray="3,2" />;
              }
              // Vertical divider between zones in same shelf
              const lineX = (r.x + r.w + 2.5) * scale;
              return <line key={`d-${i}`} x1={lineX} y1={r.y * scale} x2={lineX} y2={(r.y + r.h) * scale}
                stroke="#94a3b8" strokeWidth={0.5} strokeDasharray="3,2" />;
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
              <p>{tooltip.pos.artikelnummer} | {tooltip.pos.laenge_mm ?? '?'}x{tooltip.pos.breite_mm ?? '?'} mm</p>
              <p>{tooltip.pos.gewicht_kg.toFixed(2)} kg | {tooltip.pos.stueckzahl} Stk | h&le;{Math.max(1, tooltip.pos.max_stapelhoehe ?? 1)}x</p>
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

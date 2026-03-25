import { useMemo, useState } from 'react';
import { useAppState } from '../context/AppContext';
import type { WT, WTPosition } from '../types';

const CLUSTER_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];
const ABC_COLORS: Record<string, string> = { A: '#22c55e', B: '#eab308', C: '#9ca3af' };

type ColorMode = 'cluster' | 'abc';
const DIVIDER_MM = 5;

interface ZoneRect {
  x: number;     // mm
  y: number;     // mm
  w: number;     // zone_w_mm
  h: number;     // zone_d_mm
  pos: WTPosition | null;  // null = empty zone
}

export default function WTVisualization() {
  const { result } = useAppState();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>('abc');
  const [search, setSearch] = useState('');
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; pos: WTPosition; wtGewicht: number;
  } | null>(null);

  const wts = result?.wts ?? [];

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
  const wtD_mm = isKlein ? 500 : 800;
  const svgW = 250;
  const svgH = isKlein ? 250 : 400;
  const scale = svgW / 500;

  const zoneRects = useMemo((): ZoneRect[] => {
    if (!wt) return [];
    const { grid_cols, grid_rows, zone_w_mm, zone_d_mm } = wt;
    const zoneMap = new Map(wt.positionen.map(p => [p.zone_index, p]));
    const rects: ZoneRect[] = [];
    for (let row = 0; row < grid_rows; row++) {
      for (let col = 0; col < grid_cols; col++) {
        const idx = row * grid_cols + col;
        const x = col * (zone_w_mm + DIVIDER_MM);
        const y = row * (zone_d_mm + DIVIDER_MM);
        rects.push({ x, y, w: zone_w_mm, h: zone_d_mm, pos: zoneMap.get(idx) ?? null });
      }
    }
    return rects;
  }, [wt]);

  function getColor(pos: WTPosition): string {
    if (colorMode === 'abc') return ABC_COLORS[pos.abc_klasse] ?? '#9ca3af';
    const clusterId = wt?.cluster_id ?? 0;
    return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
  }

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

      {/* SVG + metrics */}
      {wt && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 relative">
          <div className="flex gap-4 text-xs text-gray-500 mb-2">
            <span>Typ: <strong>{wt.typ}</strong></span>
            <span>Gewicht: <strong>{wt.gesamtgewicht_kg.toFixed(1)} kg</strong></span>
            <span>Fläche: <strong>{wt.flaeche_netto_pct.toFixed(1)}%</strong></span>
            <span>Grid: <strong>{wt.grid_cols}×{wt.grid_rows}</strong></span>
            <span>Teiler: <strong>{wt.anzahl_teiler}</strong></span>
            <span>Cluster: <strong>{wt.cluster_id}</strong></span>
          </div>

          <p className="text-xs text-gray-400 mb-1">Draufsicht — 500 × {wtD_mm} mm</p>

          <svg width={svgW} height={svgH} className="border border-gray-300 bg-gray-50 rounded">
            {zoneRects.map((r, i) => (
              <g key={i}>
                <rect
                  x={r.x * scale} y={r.y * scale}
                  width={Math.max(1, r.w * scale)} height={Math.max(1, r.h * scale)}
                  fill={r.pos ? getColor(r.pos) : '#f1f5f9'}
                  stroke={r.pos ? '#fff' : '#94a3b8'}
                  strokeWidth={0.5}
                  strokeDasharray={r.pos ? undefined : '3,2'}
                  rx={1} opacity={r.pos ? 0.85 : 1}
                  onMouseEnter={r.pos ? (e) => setTooltip({
                    x: e.clientX, y: e.clientY, pos: r.pos!, wtGewicht: wt.gesamtgewicht_kg,
                  }) : undefined}
                  onMouseLeave={r.pos ? () => setTooltip(null) : undefined}
                  style={r.pos ? { cursor: 'pointer' } : undefined}
                />
                {r.pos && r.w * scale > 20 && r.h * scale > 12 && (
                  <text
                    x={(r.x + r.w / 2) * scale}
                    y={(r.y + r.h / 2) * scale}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={7} fill="rgba(0,0,0,0.6)" pointerEvents="none"
                  >
                    {r.pos.stueckzahl}
                  </text>
                )}
              </g>
            ))}
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

          {/* Legend */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-green-500 opacity-85"></span> A-Artikel
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-yellow-400 opacity-85"></span> B-Artikel
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-gray-400 opacity-85"></span> C-Artikel
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block border border-dashed border-gray-400 w-3 h-3 rounded-sm"></span> Freie Zone
            </span>
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div className="fixed bg-gray-900 text-white text-xs px-3 py-2 rounded pointer-events-none z-50 max-w-xs"
              style={{ left: tooltip.x + 12, top: tooltip.y - 60 }}>
              <p className="font-semibold truncate">{tooltip.pos.bezeichnung}</p>
              <p className="text-gray-300">
                {tooltip.pos.artikelnummer} · Zone {tooltip.pos.zone_index} · {tooltip.pos.breite_mm}×{tooltip.pos.laenge_mm}×{tooltip.pos.hoehe_mm} mm
              </p>
              <p className="text-blue-300 mt-0.5">{tooltip.pos.stueckzahl} Stk · max. {tooltip.pos.max_stapelhoehe} Stapel</p>
              <p className="text-gray-400 mt-0.5">WT gesamt: {tooltip.wtGewicht.toFixed(1)} kg</p>
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
                <span className="text-gray-400 text-xs">Z{p.zone_index}</span>
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

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
const MAX_HEIGHT_MM = 320;
const COMPACT_THRESHOLD = 30;

// ---- Stack layout within a uniform zone ----

interface StackLayout {
  fp1: number;       // footprint along zone width
  fp2: number;       // footprint along zone depth
  maxStapel: number; // items per stack
  gridCols: number;  // stacks across zone width
  gridRows: number;  // stacks across zone depth
  totalStacks: number;
}

function bestStackLayout(
  hoehe_mm: number, breite_mm: number, laenge_mm: number,
  zoneW: number, zoneD: number,
  stueckzahl: number,
): StackLayout | null {
  const dims: [number, number, number] = [hoehe_mm, breite_mm, laenge_mm];
  let best: StackLayout | null = null;
  let bestCap = -1;

  for (let i = 0; i < 3; i++) {
    const vert = dims[i];
    if (vert <= 0 || vert > MAX_HEIGHT_MM) continue;
    const maxStapel = Math.floor(MAX_HEIGHT_MM / vert);
    const fp = dims.filter((_, j) => j !== i) as [number, number];
    for (const [fp1, fp2] of [[fp[0], fp[1]], [fp[1], fp[0]]] as [number, number][]) {
      if (fp1 <= 0 || fp2 <= 0 || fp1 > zoneW || fp2 > zoneD) continue;
      const cols = Math.floor(zoneW / fp1);
      const rows = Math.floor(zoneD / fp2);
      const cap = cols * rows * maxStapel;
      if (cap > bestCap) {
        bestCap = cap;
        best = { fp1, fp2, maxStapel, gridCols: cols, gridRows: rows,
          totalStacks: Math.ceil(stueckzahl / maxStapel) };
      }
    }
  }
  return best;
}

// ---- Render primitives ----

interface StackRect {
  x: number; y: number; w: number; h: number;
  pos: WTPosition;
  stackIndex: number;  // -1 = compact summary
  stackItems: number;
  totalStacks: number;
  compact: boolean;
  layout: StackLayout;
  zoneW: number; zoneD: number;
}

interface ZoneBg {
  x: number; y: number; w: number; h: number;
  empty: boolean;
}

export default function WTVisualization() {
  const { result } = useAppState();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>('abc');
  const [search, setSearch] = useState('');
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; pos: WTPosition;
    stackInfo: string; wtGewicht: number;
    zoneW: number; zoneD: number;
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

  const { stackRects, zoneBgs } = useMemo(() => {
    if (!wt) return { stackRects: [] as StackRect[], zoneBgs: [] as ZoneBg[] };
    const { grid_cols, grid_rows, zone_w_mm, zone_d_mm } = wt;
    const zoneMap = new Map(wt.positionen.map(p => [p.zone_index, p]));
    const stacks: StackRect[] = [];
    const bgs: ZoneBg[] = [];

    for (let row = 0; row < grid_rows; row++) {
      for (let col = 0; col < grid_cols; col++) {
        const idx = row * grid_cols + col;
        const zoneX = col * (zone_w_mm + DIVIDER_MM);
        const zoneY = row * (zone_d_mm + DIVIDER_MM);
        const pos = zoneMap.get(idx) ?? null;

        bgs.push({ x: zoneX, y: zoneY, w: zone_w_mm, h: zone_d_mm, empty: !pos });
        if (!pos) continue;

        const layout = bestStackLayout(
          pos.hoehe_mm, pos.breite_mm, pos.laenge_mm,
          zone_w_mm, zone_d_mm, pos.stueckzahl,
        );

        const compact = !layout || layout.totalStacks > COMPACT_THRESHOLD;
        const safeLayout: StackLayout = layout ?? {
          fp1: zone_w_mm, fp2: zone_d_mm, maxStapel: 1,
          gridCols: 1, gridRows: 1, totalStacks: pos.stueckzahl,
        };

        if (compact) {
          stacks.push({
            x: zoneX, y: zoneY, w: zone_w_mm, h: zone_d_mm,
            pos, stackIndex: -1, stackItems: pos.stueckzahl,
            totalStacks: safeLayout.totalStacks,
            compact: true, layout: safeLayout, zoneW: zone_w_mm, zoneD: zone_d_mm,
          });
        } else {
          let remaining = pos.stueckzahl;
          for (let r = 0; r < safeLayout.gridRows && remaining > 0; r++) {
            for (let c = 0; c < safeLayout.gridCols && remaining > 0; c++) {
              const stackItems = Math.min(remaining, safeLayout.maxStapel);
              remaining -= stackItems;
              stacks.push({
                x: zoneX + c * safeLayout.fp1,
                y: zoneY + r * safeLayout.fp2,
                w: safeLayout.fp1, h: safeLayout.fp2,
                pos,
                stackIndex: r * safeLayout.gridCols + c,
                stackItems,
                totalStacks: safeLayout.totalStacks,
                compact: false, layout: safeLayout, zoneW: zone_w_mm, zoneD: zone_d_mm,
              });
            }
          }
        }
      }
    }
    return { stackRects: stacks, zoneBgs: bgs };
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
            <span>Zonen: <strong>{wt.positionen.length}/{wt.zone_count}</strong></span>
            <span>Grid: <strong>{wt.grid_cols}×{wt.grid_rows}</strong></span>
            <span>Teiler: <strong>{wt.anzahl_teiler}</strong></span>
            <span>Cluster: <strong>{wt.cluster_id}</strong></span>
          </div>

          <p className="text-xs text-gray-400 mb-1">Draufsicht — 500 × {wtD_mm} mm</p>

          <svg width={svgW} height={svgH} className="border border-gray-300 bg-gray-50 rounded">
            {/* Zone backgrounds — show free space within occupied zones + empty zones */}
            {zoneBgs.map((z, i) => (
              <rect key={`bg-${i}`}
                x={z.x * scale} y={z.y * scale}
                width={Math.max(1, z.w * scale)} height={Math.max(1, z.h * scale)}
                fill={z.empty ? '#f1f5f9' : '#e5e7eb'}
                stroke="#94a3b8" strokeWidth={0.5}
                strokeDasharray={z.empty ? '3,2' : undefined}
              />
            ))}

            {/* Stack rects */}
            {stackRects.map((r, i) => (
              <rect key={`s-${i}`}
                x={r.x * scale} y={r.y * scale}
                width={Math.max(1, r.w * scale)} height={Math.max(1, r.h * scale)}
                fill={getColor(r.pos)}
                stroke="#fff" strokeWidth={r.compact ? 0 : 0.5}
                rx={1} opacity={0.85}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => setTooltip({
                  x: e.clientX, y: e.clientY,
                  pos: r.pos,
                  wtGewicht: wt.gesamtgewicht_kg,
                  zoneW: r.zoneW, zoneD: r.zoneD,
                  stackInfo: r.compact
                    ? `${r.totalStacks} Stapel (${r.layout.gridCols}×${r.layout.gridRows}) · ${r.stackItems} Stk`
                    : `Stapel ${r.stackIndex + 1}/${r.totalStacks} · ${r.stackItems} Stk · ≤${Math.floor(MAX_HEIGHT_MM / r.layout.maxStapel)} mm hoch`,
                })}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}

            {/* Compact zone labels */}
            {stackRects.filter(r => r.compact).map((r, i) => {
              const cx = (r.x + r.zoneW / 2) * scale;
              const cy = (r.y + r.zoneD / 2) * scale;
              return (
                <g key={`lbl-${i}`} pointerEvents="none">
                  <text x={cx} y={cy - 5} textAnchor="middle" dominantBaseline="middle"
                    fontSize={9} fill="#fff" fontWeight="bold">
                    {r.totalStacks} Stapel
                  </text>
                  <text x={cx} y={cy + 7} textAnchor="middle" dominantBaseline="middle"
                    fontSize={8} fill="rgba(255,255,255,0.8)">
                    ({r.layout.gridCols}×{r.layout.gridRows})
                  </text>
                </g>
              );
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
              <span className="inline-block border border-dashed border-gray-400 w-3 h-3"></span> Freie Zone
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 bg-gray-200 border border-gray-300"></span> Freiraum in Zone
            </span>
            <span className="text-gray-400">□ = 1 Stapel (von oben greifbar)</span>
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div className="fixed bg-gray-900 text-white text-xs px-3 py-2 rounded pointer-events-none z-50 max-w-xs"
              style={{ left: tooltip.x + 12, top: tooltip.y - 60 }}>
              <p className="font-semibold truncate">{tooltip.pos.bezeichnung}</p>
              <p className="text-gray-300">
                {tooltip.pos.artikelnummer} · {tooltip.pos.laenge_mm}×{tooltip.pos.breite_mm}×{tooltip.pos.hoehe_mm} mm
              </p>
              <p className="text-blue-300 mt-0.5">{tooltip.stackInfo}</p>
              <p className="text-gray-400 mt-0.5">
                Zone {tooltip.pos.zone_index} · {tooltip.zoneW}×{tooltip.zoneD} mm · WT {tooltip.wtGewicht.toFixed(1)} kg
              </p>
            </div>
          )}
        </div>
      )}

      {/* Position list */}
      {wt && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Positionen auf {wt.id}</h3>
          <div className="space-y-1 text-sm">
            {wt.positionen.map((p, i) => {
              const stacks = Math.ceil(p.stueckzahl / Math.max(1, p.max_stapelhoehe));
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-bold text-white ${
                    p.abc_klasse === 'A' ? 'bg-green-500' : p.abc_klasse === 'B' ? 'bg-yellow-500' : 'bg-gray-400'
                  }`}>{p.abc_klasse}</span>
                  <span className="font-mono">{p.artikelnummer}</span>
                  <span className="text-gray-500 truncate flex-1">{p.bezeichnung}</span>
                  <span className="text-gray-400 text-xs">Z{p.zone_index}</span>
                  <span className="text-gray-600">{p.stueckzahl} Stk</span>
                  <span className="text-gray-400 text-xs">{stacks} Sta</span>
                  <span className="text-gray-600">{p.gewicht_kg.toFixed(2)} kg</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

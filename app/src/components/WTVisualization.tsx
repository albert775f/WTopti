import { useMemo, useState } from 'react';
import { useAppState } from '../context/AppContext';
import type { WT, WTPosition } from '../types';

const CLUSTER_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];
const ABC_COLORS: Record<string, string> = { A: '#22c55e', B: '#eab308', C: '#9ca3af' };

type ColorMode = 'cluster' | 'abc';

// Stacks above this threshold are rendered as a single rect with grid overlay
const COMPACT_THRESHOLD = 30;

/**
 * Mirrors phase3's zoneLayout: tries both footprint orientations, picks min depth.
 * Returns effective dims (eL = along WT width, eB = along WT depth) and zone bounds.
 */
function pickZoneLayout(
  laenge: number, breite: number, stacksNeeded: number, wtW: number,
): { eL: number; eB: number; actualAcross: number; stackRows: number; zoneW: number; zoneH: number } {
  const n = Math.max(1, stacksNeeded);
  // Orientation 1: laenge along width
  const a1 = laenge <= wtW ? Math.max(1, Math.min(n, Math.floor(wtW / laenge))) : 0;
  const h1 = a1 > 0 ? Math.ceil(n / a1) * breite : Infinity;
  // Orientation 2: breite along width (rotated)
  const a2 = breite <= wtW ? Math.max(1, Math.min(n, Math.floor(wtW / breite))) : 0;
  const h2 = a2 > 0 ? Math.ceil(n / a2) * laenge : Infinity;
  if (a2 > 0 && h2 <= h1) {
    return { eL: breite, eB: laenge, actualAcross: a2, stackRows: Math.ceil(n / a2), zoneW: a2 * breite, zoneH: h2 };
  }
  if (a1 > 0) {
    return { eL: laenge, eB: breite, actualAcross: a1, stackRows: Math.ceil(n / a1), zoneW: a1 * laenge, zoneH: h1 };
  }
  return { eL: laenge, eB: breite, actualAcross: 1, stackRows: n, zoneW: laenge, zoneH: n * breite };
}

interface LayoutRect {
  x: number;
  y: number;
  w: number;           // effective footprint width (laenge_mm)
  h: number;           // effective footprint depth (breite_mm)
  pos: WTPosition;
  stackIndex: number;  // 0-based; -1 = compact zone summary
  stackItems: number;  // items in this specific stack (last stack may be partial)
  totalStacks: number;
  compact: boolean;
  zoneW: number;       // full zone width mm
  zoneH: number;       // full zone depth mm
  gridCols: number;    // stacks per row
  gridRows: number;    // rows of stacks
}

interface ZoneInfo {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function WTVisualization() {
  const { result } = useAppState();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>('abc');
  const [search, setSearch] = useState('');
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    pos: WTPosition;
    stackInfo: string;
    wtGewicht: number;
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
  const realDepth = isKlein ? 500 : 800;
  const svgW = 250;
  const svgH = isKlein ? 250 : 400;
  const scale = svgW / 500;

  // Compute per-stack rects and zone bounds for dividers
  const { stackRects, zones } = useMemo(() => {
    if (!wt) return { stackRects: [] as LayoutRect[], zones: [] as ZoneInfo[] };
    const DIVIDER = 5;
    const WT_W = 500;

    // Pre-compute zone dimensions (using same orientation logic as phase3's zoneLayout).
    const withDims = wt.positionen.map(pos => {
      const laenge = pos.laenge_mm ?? Math.sqrt(pos.grundflaeche_mm2);
      const breite = pos.breite_mm ?? Math.sqrt(pos.grundflaeche_mm2);
      const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
      const stacksNeeded = Math.ceil(pos.stueckzahl / maxStapel);
      const { eL, eB, actualAcross, stackRows, zoneW, zoneH } =
        pickZoneLayout(laenge, breite, stacksNeeded, WT_W);
      return { pos, eL, eB, maxStapel, stacksNeeded, actualAcross, stackRows, zoneW, zoneH };
    });

    // Sort ascending by zone height (shallowest first).
    // Placing short zones early leaves maximum depth for tall zones — avoids
    // the case where a single tall zone (e.g. 780/800mm) pushes all other
    // positions out of the visible WT area.
    withDims.sort((a, b) => a.zoneH - b.zoneH);

    const rects: LayoutRect[] = [];
    const zoneList: ZoneInfo[] = [];
    let curX = 0, curY = 0, shelfH = 0;

    for (const { pos, eL, eB, maxStapel, stacksNeeded, actualAcross, stackRows, zoneW, zoneH } of withDims) {
      // Wrap to new shelf if zone doesn't fit beside current zones
      if (curX > 0 && curX + DIVIDER + zoneW > WT_W) {
        curY += shelfH + DIVIDER;
        curX = 0;
        shelfH = 0;
      }

      // Skip (don't stop) if zone overflows WT depth — continue to try remaining zones
      if (curY + zoneH > realDepth) continue;

      zoneList.push({ x: curX, y: curY, w: zoneW, h: zoneH });

      const compact = stacksNeeded > COMPACT_THRESHOLD;

      if (compact) {
        rects.push({
          x: curX, y: curY, w: zoneW, h: zoneH,
          pos, stackIndex: -1, stackItems: pos.stueckzahl, totalStacks: stacksNeeded,
          compact: true, zoneW, zoneH, gridCols: actualAcross, gridRows: stackRows,
        });
      } else {
        let remaining = pos.stueckzahl;
        for (let row = 0; row < stackRows; row++) {
          const stacksThisRow = row < stackRows - 1
            ? actualAcross
            : stacksNeeded - row * actualAcross;
          for (let col = 0; col < stacksThisRow; col++) {
            const stackItems = Math.min(remaining, maxStapel);
            remaining = Math.max(0, remaining - stackItems);
            rects.push({
              x: curX + col * eL,
              y: curY + row * eB,
              w: eL, h: eB,
              pos,
              stackIndex: row * actualAcross + col,
              stackItems,
              totalStacks: stacksNeeded,
              compact: false, zoneW, zoneH, gridCols: actualAcross, gridRows: stackRows,
            });
          }
        }
      }

      curX += zoneW + DIVIDER;
      shelfH = Math.max(shelfH, zoneH);
    }

    return { stackRects: rects, zones: zoneList };
  }, [wt, realDepth]);

  function getColor(pos: WTPosition): string {
    if (colorMode === 'abc') return ABC_COLORS[pos.abc_klasse] ?? '#9ca3af';
    const clusterId = wt?.cluster_id ?? 0;
    return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
  }

  // Effective vertical dimension upper bound: max_stapelhoehe = floor(320/vert_mm)
  function effHeight(pos: WTPosition): string {
    const s = Math.max(1, pos.max_stapelhoehe ?? 1);
    return `≤${Math.floor(320 / s)}mm`;
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
            <span>Teiler: <strong>{wt.anzahl_teiler}</strong></span>
            <span>Cluster: <strong>{wt.cluster_id}</strong></span>
          </div>

          {/* Top-down view label */}
          <p className="text-xs text-gray-400 mb-1">Draufsicht — 500 × {realDepth} mm</p>

          <svg width={svgW} height={svgH} className="border border-gray-300 bg-gray-50 rounded">
            {/* Stack rectangles */}
            {stackRects.map((r, i) => (
              <rect key={i}
                x={r.x * scale} y={r.y * scale}
                width={Math.max(1, r.w * scale)} height={Math.max(1, r.h * scale)}
                fill={getColor(r.pos)}
                stroke="#fff" strokeWidth={r.compact ? 0 : 0.5}
                rx={1} opacity={0.85}
                onMouseEnter={(e) => setTooltip({
                  x: e.clientX, y: e.clientY,
                  pos: r.pos,
                  wtGewicht: wt.gesamtgewicht_kg,
                  stackInfo: r.compact
                    ? `${r.totalStacks} Stapel (${r.gridCols}×${r.gridRows}) · ${r.stackItems} Stk`
                    : `Stapel ${r.stackIndex + 1}/${r.totalStacks} · ${r.stackItems} Stk · ${effHeight(r.pos)} hoch`,
                })}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}

            {/* Compact zone labels */}
            {stackRects.filter(r => r.compact).map((r, i) => {
              const cx = (r.x + r.zoneW / 2) * scale;
              const cy = (r.y + r.zoneH / 2) * scale;
              return (
                <g key={`lbl-${i}`} pointerEvents="none">
                  <text x={cx} y={cy - 5}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={9} fill="#fff" fontWeight="bold">
                    {r.totalStacks} Stapel
                  </text>
                  <text x={cx} y={cy + 7}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={8} fill="rgba(255,255,255,0.8)">
                    ({r.gridCols}×{r.gridRows})
                  </text>
                </g>
              );
            })}

            {/* Zone dividers: dashed lines at article-zone boundaries */}
            {zones.map((z, i) => {
              const next = zones[i + 1];
              if (!next) return null;
              const sameShelves = Math.abs(z.y - next.y) < 1;
              if (!sameShelves) {
                const lineY = (z.y + z.h + 2.5) * scale;
                const shelfMaxX = Math.max(z.x + z.w, next.x + next.w) * scale;
                return <line key={`d-${i}`} x1={0} y1={lineY} x2={shelfMaxX} y2={lineY}
                  stroke="#94a3b8" strokeWidth={1} strokeDasharray="3,2" />;
              }
              const lineX = (z.x + z.w + 2.5) * scale;
              return <line key={`d-${i}`} x1={lineX} y1={z.y * scale} x2={lineX} y2={(z.y + z.h) * scale}
                stroke="#94a3b8" strokeWidth={1} strokeDasharray="3,2" />;
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
              <span className="inline-block border border-dashed border-gray-400 w-6 h-0 mt-1.5"></span>
              Teiler (5mm)
            </span>
            <span className="text-gray-400">□ = 1 Stapel (von oben greifbar)</span>
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div className="fixed bg-gray-900 text-white text-xs px-3 py-2 rounded pointer-events-none z-50 max-w-xs"
              style={{ left: tooltip.x + 12, top: tooltip.y - 60 }}>
              <p className="font-semibold truncate">{tooltip.pos.bezeichnung}</p>
              <p className="text-gray-300">
                {tooltip.pos.artikelnummer} · {tooltip.pos.laenge_mm ?? '?'}×{tooltip.pos.breite_mm ?? '?'} mm Grundfläche
              </p>
              <p className="text-blue-300 mt-0.5">{tooltip.stackInfo}</p>
              <p className="text-gray-400 mt-0.5">
                WT gesamt: {tooltip.pos.stueckzahl} Stk · {tooltip.wtGewicht.toFixed(1)} kg
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
              const maxStapel = Math.max(1, p.max_stapelhoehe ?? 1);
              const stacks = Math.ceil(p.stueckzahl / maxStapel);
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-bold text-white ${
                    p.abc_klasse === 'A' ? 'bg-green-500' : p.abc_klasse === 'B' ? 'bg-yellow-500' : 'bg-gray-400'
                  }`}>{p.abc_klasse}</span>
                  <span className="font-mono">{p.artikelnummer}</span>
                  <span className="text-gray-500 truncate flex-1">{p.bezeichnung}</span>
                  <span className="text-gray-600">{p.stueckzahl} Stk</span>
                  <span className="text-gray-400 text-xs">{stacks} Stapel</span>
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

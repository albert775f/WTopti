import { useMemo, useState } from 'react';
import { useAppState } from '../context/AppContext';

interface CoOccPair {
  artA: string;
  artB: string;
  count: number;
}

const MAX_DISPLAY = 30;

export default function CoOccurrenceSection() {
  const { result, artikelProcessed } = useAppState();
  const [minScore, setMinScore] = useState(1);
  const [abcFilters, setAbcFilters] = useState({ A: true, B: true, C: true });

  const abcMap = useMemo(() => {
    const m = new Map<string, 'A' | 'B' | 'C'>();
    for (const a of artikelProcessed) m.set(a.artikelnummer, a.abc_klasse);
    return m;
  }, [artikelProcessed]);

  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of artikelProcessed) m.set(a.artikelnummer, a.bezeichnung);
    return m;
  }, [artikelProcessed]);

  // Build co-occurrence from belegungsplan (articles sharing same WT)
  const coOccPairs = useMemo(() => {
    if (!result) return [];
    const pairCount = new Map<string, number>();

    // Group articles by WT
    const wtArticles = new Map<string, string[]>();
    for (const row of result.belegungsplan) {
      const arts = wtArticles.get(row.warentraeger_id) ?? [];
      if (!arts.includes(row.artikelnummer)) arts.push(row.artikelnummer);
      wtArticles.set(row.warentraeger_id, arts);
    }

    for (const arts of wtArticles.values()) {
      for (let i = 0; i < arts.length; i++) {
        for (let j = i + 1; j < arts.length; j++) {
          const key = [arts[i], arts[j]].sort().join('|');
          pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        }
      }
    }

    const pairs: CoOccPair[] = [];
    for (const [key, count] of pairCount) {
      const [artA, artB] = key.split('|');
      pairs.push({ artA, artB, count });
    }
    return pairs.sort((a, b) => b.count - a.count);
  }, [result]);

  const filteredPairs = useMemo(() => {
    return coOccPairs
      .filter((p) => p.count >= minScore)
      .filter((p) => {
        const abcA = abcMap.get(p.artA);
        const abcB = abcMap.get(p.artB);
        return (abcA ? abcFilters[abcA] : true) && (abcB ? abcFilters[abcB] : true);
      })
      .slice(0, MAX_DISPLAY);
  }, [coOccPairs, minScore, abcFilters, abcMap]);

  // Get unique articles for the heatmap grid
  const articles = useMemo(() => {
    const set = new Set<string>();
    for (const p of filteredPairs) { set.add(p.artA); set.add(p.artB); }
    return [...set].sort();
  }, [filteredPairs]);

  const maxCount = useMemo(() => Math.max(1, ...filteredPairs.map((p) => p.count)), [filteredPairs]);

  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  if (!result) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <p>Keine Ergebnisse vorhanden. Bitte zuerst Optimierung starten.</p>
      </div>
    );
  }

  const cellSize = articles.length > 0 ? Math.min(24, Math.floor(600 / articles.length)) : 24;
  const labelWidth = 80;
  const svgW = labelWidth + articles.length * cellSize;
  const svgH = labelWidth + articles.length * cellSize;

  // Build lookup
  const pairMap = new Map<string, number>();
  for (const p of filteredPairs) {
    pairMap.set(`${p.artA}|${p.artB}`, p.count);
    pairMap.set(`${p.artB}|${p.artA}`, p.count);
  }

  function getColor(count: number): string {
    if (count === 0) return '#f9fafb';
    const t = count / maxCount;
    const r = Math.round(255 - t * (255 - 30));
    const g = Math.round(255 - t * (255 - 58));
    const b = Math.round(255 - t * (255 - 95));
    return `rgb(${r},${g},${b})`;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">Co-Occurrence Heatmap</h2>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-lg p-3">
        <span className="text-sm text-gray-600">ABC-Filter:</span>
        {(['A', 'B', 'C'] as const).map((cls) => (
          <label key={cls} className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={abcFilters[cls]}
              onChange={(e) => setAbcFilters((f) => ({ ...f, [cls]: e.target.checked }))} />
            {cls}
          </label>
        ))}
        <span className="text-sm text-gray-600 ml-4">Min. Score:</span>
        <input type="range" min={1} max={Math.max(10, maxCount)} value={minScore}
          onChange={(e) => setMinScore(+e.target.value)}
          className="w-32" />
        <span className="text-sm text-gray-700 font-mono">{minScore}</span>
      </div>

      {articles.length === 0 ? (
        <p className="text-gray-400 text-center py-8">Keine Paare mit Score ≥ {minScore}</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg p-4 overflow-x-auto relative">
          <svg width={svgW} height={svgH} className="block">
            {/* Column labels */}
            {articles.map((art, i) => (
              <text key={`cl-${i}`} x={labelWidth + i * cellSize + cellSize / 2}
                y={labelWidth - 4} textAnchor="end" fontSize={9}
                transform={`rotate(-45, ${labelWidth + i * cellSize + cellSize / 2}, ${labelWidth - 4})`}
                className="fill-gray-600">
                {art.length > 8 ? art.slice(0, 8) + '…' : art}
              </text>
            ))}
            {/* Row labels */}
            {articles.map((art, i) => (
              <text key={`rl-${i}`} x={labelWidth - 4}
                y={labelWidth + i * cellSize + cellSize / 2 + 3}
                textAnchor="end" fontSize={9} className="fill-gray-600">
                {art.length > 8 ? art.slice(0, 8) + '…' : art}
              </text>
            ))}
            {/* Cells */}
            {articles.map((artA, ri) =>
              articles.map((artB, ci) => {
                const count = artA === artB ? 0 : (pairMap.get(`${artA}|${artB}`) ?? 0);
                return (
                  <rect key={`${ri}-${ci}`}
                    x={labelWidth + ci * cellSize} y={labelWidth + ri * cellSize}
                    width={cellSize - 1} height={cellSize - 1}
                    fill={getColor(count)} rx={2}
                    onMouseEnter={(e) => {
                      if (count > 0) {
                        setTooltip({
                          x: e.clientX, y: e.clientY,
                          text: `${artA} × ${artB}: ${count} gemeinsame WTs`,
                        });
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    className="cursor-pointer"
                  />
                );
              })
            )}
          </svg>
          {tooltip && (
            <div className="fixed bg-gray-900 text-white text-xs px-2 py-1 rounded pointer-events-none z-50"
              style={{ left: tooltip.x + 10, top: tooltip.y - 30 }}>
              {tooltip.text}
            </div>
          )}
        </div>
      )}

      {/* Top pairs list */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Top Co-Occurrence Paare</h3>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {filteredPairs.slice(0, 20).map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-gray-400 text-right">{i + 1}.</span>
              <span className="font-mono">{p.artA}</span>
              <span className="text-gray-400">×</span>
              <span className="font-mono">{p.artB}</span>
              <span className="ml-auto font-semibold text-blue-700">{p.count}</span>
              <span className="text-xs text-gray-400">
                {nameMap.get(p.artA)?.slice(0, 15)} / {nameMap.get(p.artB)?.slice(0, 15)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

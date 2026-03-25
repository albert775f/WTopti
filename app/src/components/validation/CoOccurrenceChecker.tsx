import { useMemo } from 'react';
import type { WT } from '../../types';
import { buildArtToFirstWT, getSortedPairs } from '../../utils/wtMaps';

type CoOccurrenceMatrix = Record<string, Record<string, number>>;

interface Props {
  wts: WT[];
  coMatrix: CoOccurrenceMatrix;
  artikelBezeichnungen: Map<string, string>;
}

export default function CoOccurrenceChecker({ wts, coMatrix, artikelBezeichnungen }: Props) {
  const { pairs, artToWT, artToCluster } = useMemo(() => {
    const artToWT = buildArtToFirstWT(wts);
    const artToCluster = new Map<string, number>();
    for (const wt of wts) {
      for (const pos of wt.positionen) {
        if (!artToCluster.has(pos.artikelnummer)) {
          artToCluster.set(pos.artikelnummer, wt.cluster_id);
        }
      }
    }

    const allPairs = getSortedPairs(coMatrix, 50);
    return { pairs: allPairs, artToWT, artToCluster };
  }, [wts, coMatrix]);

  const sameWTCount = pairs.filter(p => artToWT.get(p.a) && artToWT.get(p.a) === artToWT.get(p.b)).length;

  const getPlacementStatus = (p: { a: string; b: string }) => {
    const wtA = artToWT.get(p.a);
    const wtB = artToWT.get(p.b);
    if (wtA && wtA === wtB) return 'same';
    if (artToCluster.get(p.a) !== undefined && artToCluster.get(p.a) === artToCluster.get(p.b)) return 'cluster';
    return 'different';
  };

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        <span className="text-green-600 font-semibold">{sameWTCount}</span> von {pairs.length} Paaren auf gleichem WT
        ({pairs.length > 0 ? Math.round(sameWTCount / pairs.length * 100) : 0}%)
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Artikel A</th>
              <th className="py-1 pr-2">Artikel B</th>
              <th className="py-1 pr-2 text-right">Score</th>
              <th className="py-1">Platzierung</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => {
              const status = getPlacementStatus(p);
              const badge = status === 'same'
                ? <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">Gleicher WT</span>
                : status === 'cluster'
                ? <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded">Gleicher Cluster</span>
                : <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">Verschiedene Cluster</span>;
              return (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-0.5 pr-2 text-gray-400">{i + 1}</td>
                  <td className="py-0.5 pr-2">
                    <span className="font-mono">{p.a}</span>
                    <span className="text-gray-400 ml-1">{(artikelBezeichnungen.get(p.a) ?? '').slice(0, 20)}</span>
                  </td>
                  <td className="py-0.5 pr-2">
                    <span className="font-mono">{p.b}</span>
                    <span className="text-gray-400 ml-1">{(artikelBezeichnungen.get(p.b) ?? '').slice(0, 20)}</span>
                  </td>
                  <td className="py-0.5 pr-2 text-right font-medium">{p.score}</td>
                  <td className="py-0.5">{badge}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

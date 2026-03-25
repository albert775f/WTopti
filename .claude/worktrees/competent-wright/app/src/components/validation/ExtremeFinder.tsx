import type { ExtremesResult, ExtremeEntry } from '../../types';

interface Props {
  extremes: ExtremesResult;
  onSelectWT?: (wtId: string) => void;
}

interface CategoryCard {
  key: keyof ExtremesResult;
  title: string;
}

const CATEGORIES: CategoryCard[] = [
  { key: 'largestArticle', title: 'Größter Artikel (Grundfläche)' },
  { key: 'heaviestArticle', title: 'Schwerster Artikel' },
  { key: 'highestStock', title: 'Höchster Bestand' },
  { key: 'mostOrdered', title: 'Meistbestellt' },
  { key: 'topCoOccPair', title: 'Top Co-Occ. Paare' },
  { key: 'fullestWTs', title: 'Vollste WTs (Gewicht)' },
  { key: 'emptiestWTs', title: 'Leerste WTs (Fläche)' },
  { key: 'mostArticleTypes', title: 'Meiste Artikel-Typen/WT' },
];

function EntryRow({ entry, onSelectWT }: { entry: ExtremeEntry; onSelectWT?: (id: string) => void }) {
  return (
    <div
      className={`flex items-center gap-2 py-0.5 text-xs ${entry.targetWTId && onSelectWT ? 'cursor-pointer hover:bg-blue-50' : ''}`}
      onClick={() => entry.targetWTId && onSelectWT?.(entry.targetWTId)}
    >
      <span className="text-gray-400 w-4 text-right">{entry.rank}.</span>
      <span className="text-gray-500 font-mono truncate" style={{ maxWidth: 90 }} title={entry.key}>{entry.key}</span>
      <span className="text-gray-700 truncate flex-1" title={entry.label}>{entry.label.slice(0, 20)}</span>
      <span className="font-medium text-gray-900 whitespace-nowrap">
        {typeof entry.value === 'number' && entry.value > 9999
          ? entry.value.toLocaleString('de-DE')
          : entry.value.toLocaleString('de-DE', { maximumFractionDigits: 2 })} {entry.unit}
      </span>
    </div>
  );
}

export default function ExtremeFinder({ extremes, onSelectWT }: Props) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {CATEGORIES.map(cat => (
        <div key={cat.key} className="bg-white border border-gray-200 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">{cat.title}</h4>
          <div className="space-y-0.5">
            {(extremes[cat.key] as ExtremeEntry[]).map(entry => (
              <EntryRow key={entry.rank} entry={entry} onSelectWT={onSelectWT} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

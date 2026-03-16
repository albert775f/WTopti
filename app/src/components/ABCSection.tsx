import { useMemo, useState } from 'react';
import { useAppState } from '../context/AppContext';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table';
import type { ArtikelProcessed } from '../types';

const ABC_COLORS: Record<string, string> = { A: '#22c55e', B: '#eab308', C: '#9ca3af' };

export default function ABCSection() {
  const { artikelProcessed } = useAppState();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [abcFilter, setAbcFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    if (abcFilter === 'all') return artikelProcessed;
    return artikelProcessed.filter((a) => a.abc_klasse === abcFilter);
  }, [artikelProcessed, abcFilter]);

  const stats = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0 };
    let totalBestand = 0;
    let totalUmsatz = 0;
    for (const a of artikelProcessed) {
      counts[a.abc_klasse]++;
      totalBestand += a.bestand;
      totalUmsatz += a.umsatz_gesamt;
    }
    return { total: artikelProcessed.length, counts, totalBestand, totalUmsatz };
  }, [artikelProcessed]);

  const top50 = useMemo(() =>
    [...artikelProcessed]
      .sort((a, b) => b.umsatz_gesamt - a.umsatz_gesamt)
      .slice(0, 50)
      .map((a) => ({
        name: a.artikelnummer,
        umsatz: a.umsatz_gesamt,
        abc: a.abc_klasse,
      })),
    [artikelProcessed]
  );

  const pieData = useMemo(() => {
    const groups = { A: { count: 0, bestand: 0, umsatz: 0 }, B: { count: 0, bestand: 0, umsatz: 0 }, C: { count: 0, bestand: 0, umsatz: 0 } };
    for (const a of artikelProcessed) {
      groups[a.abc_klasse].count++;
      groups[a.abc_klasse].bestand += a.bestand;
      groups[a.abc_klasse].umsatz += a.umsatz_gesamt;
    }
    return {
      count: Object.entries(groups).map(([k, v]) => ({ name: k, value: v.count })),
      bestand: Object.entries(groups).map(([k, v]) => ({ name: k, value: v.bestand })),
      umsatz: Object.entries(groups).map(([k, v]) => ({ name: k, value: v.umsatz })),
    };
  }, [artikelProcessed]);

  const columnHelper = createColumnHelper<ArtikelProcessed>();
  const columns = useMemo(() => [
    columnHelper.accessor('artikelnummer', { header: 'Artikelnr.' }),
    columnHelper.accessor('bezeichnung', { header: 'Bezeichnung' }),
    columnHelper.accessor('abc_klasse', {
      header: 'ABC',
      cell: (info) => (
        <span className="px-2 py-0.5 rounded text-xs font-bold text-white"
          style={{ backgroundColor: ABC_COLORS[info.getValue()] }}>
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor('umsatz_gesamt', {
      header: 'Umsatz (Stk)',
      cell: (info) => info.getValue().toLocaleString('de-DE'),
    }),
    columnHelper.accessor('bestand', {
      header: 'Bestand',
      cell: (info) => info.getValue().toLocaleString('de-DE'),
    }),
    columnHelper.accessor('grundflaeche_mm2', {
      header: 'Grundfläche (mm²)',
      cell: (info) => info.getValue().toLocaleString('de-DE'),
    }),
  ], [columnHelper]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  if (artikelProcessed.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <p>Keine Daten vorhanden. Bitte zuerst Dateien hochladen und Optimierung starten.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">ABC-Analyse</h2>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Artikel gesamt" value={stats.total}
          sub={`A: ${stats.counts.A} | B: ${stats.counts.B} | C: ${stats.counts.C}`} />
        <KpiCard label="Gesamtbestand" value={stats.totalBestand.toLocaleString('de-DE')} />
        <KpiCard label="Gesamtumsatz (Stk)" value={stats.totalUmsatz.toLocaleString('de-DE')} />
        <KpiCard label="Ø Umsatz/Artikel"
          value={stats.total > 0 ? Math.round(stats.totalUmsatz / stats.total).toLocaleString('de-DE') : '0'} />
      </div>

      {/* Bar Chart: Top 50 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Top 50 nach Gesamtumsatz</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={top50}>
            <XAxis dataKey="name" tick={false} />
            <YAxis />
            <Tooltip formatter={(v) => Number(v).toLocaleString('de-DE')} />
            <Bar dataKey="umsatz">
              {top50.map((entry, i) => (
                <Cell key={i} fill={ABC_COLORS[entry.abc]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pie Charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(['count', 'bestand', 'umsatz'] as const).map((key) => (
          <div key={key} className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2 capitalize">
              {key === 'count' ? 'Artikelanzahl' : key === 'bestand' ? 'Bestand' : 'Umsatz'}
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData[key]} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  outerRadius={70} label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  {pieData[key].map((entry, i) => (
                    <Cell key={i} fill={ABC_COLORS[entry.name]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip formatter={(v) => Number(v).toLocaleString('de-DE')} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <input
            type="text"
            placeholder="Suche..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1"
          />
          <select
            value={abcFilter}
            onChange={(e) => setAbcFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="all">Alle</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id}
                      className="px-3 py-2 text-left font-medium text-gray-600 border-b cursor-pointer select-none"
                      onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted() as string] ?? ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b hover:bg-gray-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 text-gray-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
          <span>
            Seite {table.getState().pagination.pageIndex + 1} von {table.getPageCount()}
            {' '}({filtered.length} Artikel)
          </span>
          <div className="flex gap-2">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40">
              Zurück
            </button>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40">
              Weiter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

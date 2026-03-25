import { useAppState, useAppDispatch } from '../context/AppContext';
import { KLEIN_FLOOR_M2, GROSS_FLOOR_M2 } from '../algorithm/phase3';
import { WAREHOUSE_AREA_M2 } from '../algorithm/phase5';

function fmt(n: number) { return n.toLocaleString('de-DE'); }
function fmtArea(n: number) { return n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

function AreaBar({ usedM2, totalM2 }: { usedM2: number; totalM2: number }) {
  const pct = Math.min(100, (usedM2 / totalM2) * 100);
  const color = pct > 95 ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-blue-500';
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

interface CardProps {
  label: string;
  badge?: string;
  badgeColor?: string;
  klein: number;
  gross: number;
  areaM2: number;
  areaFreeM2: number;
  areaFreePct: number;
  highlight?: boolean;
}

function RatioCard({ label, badge, badgeColor = 'bg-blue-100 text-blue-700', klein, gross, areaM2, areaFreeM2, areaFreePct, highlight }: CardProps) {
  return (
    <div className={`rounded-lg border p-4 space-y-3 ${highlight ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-800">{label}</span>
        {badge && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{badge}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="space-y-1">
          <p className="text-xs text-gray-500 uppercase tracking-wide">KLEIN-WTs</p>
          <p className="text-2xl font-bold text-gray-800">{fmt(klein)}</p>
          <p className="text-xs text-gray-400">500×500mm · {fmtArea(klein * KLEIN_FLOOR_M2)} m²</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-gray-500 uppercase tracking-wide">GROSS-WTs</p>
          <p className="text-2xl font-bold text-gray-800">{fmt(gross)}</p>
          <p className="text-xs text-gray-400">500×800mm · {fmtArea(gross * GROSS_FLOOR_M2)} m²</p>
        </div>
      </div>

      <div className="border-t pt-3 space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Fläche belegt</span>
          <span className="font-medium">{fmtArea(areaM2)} m²</span>
        </div>
        <AreaBar usedM2={areaM2} totalM2={WAREHOUSE_AREA_M2} />
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Fläche frei</span>
          <span className={`font-semibold ${areaFreeM2 < 0 ? 'text-red-600' : 'text-green-700'}`}>
            {fmtArea(areaFreeM2)} m² ({areaFreePct.toFixed(1)}%)
          </span>
        </div>
      </div>
    </div>
  );
}

export default function WTRatioSection() {
  const { result } = useAppState();
  const dispatch = useAppDispatch();
  const rec = result?.wt_recommendation;

  if (!result || !rec) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <p>Keine Ergebnisse vorhanden. Bitte zuerst Optimierung starten.</p>
      </div>
    );
  }

  const kleinDelta = rec.optimal_klein - rec.current_klein;
  const grossDelta = rec.gross_delta;
  const isAlreadyOptimal = kleinDelta === 0 && grossDelta === 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-800">WT-Verhältnis-Optimierung</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Lagerfläche gesamt: <strong>{fmtArea(WAREHOUSE_AREA_M2)} m²</strong> (fest)
          &ensp;·&ensp; 1 KLEIN = {KLEIN_FLOOR_M2} m² &ensp;·&ensp; 1 GROSS = {GROSS_FLOOR_M2} m²
        </p>
      </div>

      {/* Two-card comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RatioCard
          label="Aktuell"
          badge={`${fmt(rec.current_klein + rec.current_gross)} WTs gesamt`}
          badgeColor="bg-gray-100 text-gray-600"
          klein={rec.current_klein}
          gross={rec.current_gross}
          areaM2={rec.current_area_m2}
          areaFreeM2={rec.current_area_free_m2}
          areaFreePct={rec.current_area_free_pct}
        />
        <RatioCard
          label="Optimales Verhältnis"
          badge={isAlreadyOptimal ? 'bereits optimal' : `${fmt(rec.optimal_klein + rec.optimal_gross)} WTs gesamt`}
          badgeColor={isAlreadyOptimal ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}
          klein={rec.optimal_klein}
          gross={rec.optimal_gross}
          areaM2={rec.optimal_area_m2}
          areaFreeM2={rec.optimal_area_free_m2}
          areaFreePct={rec.optimal_area_free_pct}
          highlight={!isAlreadyOptimal && rec.optimal_fits}
        />
      </div>

      {/* Delta row */}
      {!isAlreadyOptimal && (
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Differenz Optimal → Aktuell</p>
          <div className="flex flex-wrap gap-4 text-sm">
            {kleinDelta !== 0 && (
              <span className={kleinDelta < 0 ? 'text-green-700 font-semibold' : 'text-amber-600 font-semibold'}>
                KLEIN: {kleinDelta > 0 ? '+' : ''}{fmt(kleinDelta)}
              </span>
            )}
            {grossDelta !== 0 && (
              <span className={grossDelta > 0 ? 'text-green-700 font-semibold' : 'text-amber-600 font-semibold'}>
                GROSS: {grossDelta > 0 ? '+' : ''}{fmt(grossDelta)}
              </span>
            )}
            {rec.area_saved_m2 !== 0 && (
              <span className={rec.area_saved_m2 > 0 ? 'text-green-700' : 'text-gray-500'}>
                Fläche: {rec.area_saved_m2 > 0 ? '−' : '+'}{fmtArea(Math.abs(rec.area_saved_m2))} m²
              </span>
            )}
          </div>
        </div>
      )}

      {/* Recommendation text */}
      <div className={`rounded-lg border p-4 text-sm ${rec.optimal_fits ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-red-50 border-red-200 text-red-900'}`}>
        {rec.empfehlung}
      </div>

      {/* Article breakdown */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Artikel-Verteilung (analytisch)</p>
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div className="bg-gray-50 rounded p-3">
            <p className="text-2xl font-bold text-amber-600">{fmt(rec.articles_must_gross)}</p>
            <p className="text-xs text-gray-500 mt-1">Zwingend GROSS<br/>(passt nicht auf KLEIN)</p>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <p className="text-2xl font-bold text-blue-600">{fmt(rec.articles_prefer_gross)}</p>
            <p className="text-xs text-gray-500 mt-1">Bevorzugt GROSS<br/>(spart Fläche)</p>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <p className="text-2xl font-bold text-gray-700">{fmt(rec.articles_on_klein)}</p>
            <p className="text-xs text-gray-500 mt-1">Optimal KLEIN<br/>(spart Fläche)</p>
          </div>
        </div>
      </div>

      {/* Top GROSS examples */}
      {rec.top_gross_examples.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Top Artikel: Warum GROSS?</p>
          <p className="text-xs text-gray-400">Größte Flächeneinsparung durch GROSS statt KLEIN</p>
          <div className="space-y-2 mt-2">
            {rec.top_gross_examples.map((c, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs flex items-center justify-center font-bold flex-shrink-0">
                  {i + 1}
                </span>
                <span className="font-mono text-xs text-gray-400 flex-shrink-0">{c.artikelnummer}</span>
                <span className="flex-1 truncate text-gray-700">{c.bezeichnung}</span>
                <span className="text-gray-400 text-xs flex-shrink-0">{fmt(c.n_klein)}K → {fmt(c.n_gross)}G</span>
                <span className="text-green-700 font-semibold text-xs flex-shrink-0">−{fmtArea(c.area_saving)} m²</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Apply button */}
      {!isAlreadyOptimal && rec.optimal_fits && (
        <button
          onClick={() => dispatch({ type: 'SET_CONFIG', payload: { anzahl_klein: rec.optimal_klein, anzahl_gross: rec.optimal_gross } })}
          className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition-colors"
        >
          Optimales Verhältnis als Konfiguration übernehmen
          &ensp;({fmt(rec.optimal_klein)} KLEIN / {fmt(rec.optimal_gross)} GROSS)
        </button>
      )}
    </div>
  );
}

import type { ValidationDashboardData } from '../../types';

interface Props {
  data: ValidationDashboardData;
  onExport: () => void;
  onExportValidation: () => void;
}

export default function StatusBar({ data, onExport, onExportValidation }: Props) {
  const failCount = data.hardChecks.filter(c => c.status === 'FAIL').length;

  const bgColor = data.status === 'PASSED' ? 'bg-green-50 border-green-300'
    : data.status === 'WARNING' ? 'bg-yellow-50 border-yellow-300'
    : 'bg-red-50 border-red-300';

  const textColor = data.status === 'PASSED' ? 'text-green-800'
    : data.status === 'WARNING' ? 'text-yellow-800'
    : 'text-red-800';

  const icon = data.status === 'PASSED' ? '✔' : data.status === 'WARNING' ? '⚠' : '✖';

  const statusText = data.status === 'PASSED'
    ? 'Alle 8 Checks bestanden — Export freigegeben'
    : data.status === 'WARNING'
    ? `Alle Checks bestanden — ${data.warnings.length} Warnung${data.warnings.length !== 1 ? 'en' : ''}`
    : `${failCount} Check${failCount !== 1 ? 's' : ''} fehlgeschlagen — Export gesperrt`;

  const handleExport = () => {
    if (data.status === 'FAILED') return;
    if (data.status === 'WARNING') {
      if (!window.confirm(`${data.warnings.join('\n')}\n\nTrotzdem exportieren?`)) return;
    }
    onExport();
  };

  return (
    <div className={`border rounded-lg p-4 ${bgColor}`}>
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-3 ${textColor}`}>
          <span className="text-2xl">{icon}</span>
          <div>
            <p className="font-semibold">{statusText}</p>
            {data.warnings.length > 0 && (
              <ul className="text-sm mt-1 space-y-0.5">
                {data.warnings.map((w, i) => <li key={i}>• {w}</li>)}
              </ul>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onExportValidation}
            className="px-3 py-1.5 text-sm border border-gray-400 text-gray-700 rounded hover:bg-gray-100"
          >
            Validierungsbericht CSV
          </button>
          <button
            onClick={handleExport}
            disabled={data.status === 'FAILED'}
            className={`px-4 py-1.5 text-sm text-white rounded font-medium ${
              data.status === 'FAILED'
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
            title={data.status === 'FAILED' ? 'Export gesperrt — Checks fehlgeschlagen' : undefined}
          >
            Belegungsplan exportieren
          </button>
        </div>
      </div>
    </div>
  );
}

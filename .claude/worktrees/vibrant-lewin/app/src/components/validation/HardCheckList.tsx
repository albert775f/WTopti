import { useState } from 'react';
import type { HardCheckResult } from '../../types';

interface Props { checks: HardCheckResult[] }

export default function HardCheckList({ checks }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {checks.map(check => (
        <div key={check.id} className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 text-left"
            onClick={() => check.status === 'FAIL' && setExpanded(expanded === check.id ? null : check.id)}
          >
            <span className={`text-lg ${check.status === 'PASS' ? 'text-green-500' : 'text-red-500'}`}>
              {check.status === 'PASS' ? '✔' : '✖'}
            </span>
            <span className="font-medium text-sm flex-1">{check.id}: {check.name}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${
              check.status === 'PASS' ? 'bg-green-500' : 'bg-red-500'
            }`}>
              {check.status}
            </span>
            {check.status === 'FAIL' && (
              <>
                <span className="text-xs text-gray-500 ml-2">{check.errorCount} Fehler</span>
                <span className="text-gray-400 ml-1">{expanded === check.id ? '▲' : '▼'}</span>
              </>
            )}
          </button>
          {expanded === check.id && check.details.length > 0 && (
            <div className="bg-red-50 border-t border-red-200 p-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-1 pr-3">Key</th>
                    <th className="py-1 pr-3">Erwartet</th>
                    <th className="py-1 pr-3">Tatsächlich</th>
                    <th className="py-1">Meldung</th>
                  </tr>
                </thead>
                <tbody>
                  {check.details.slice(0, 100).map((d, i) => (
                    <tr key={i} className="border-t border-red-100">
                      <td className="py-0.5 pr-3 font-mono">{d.key}</td>
                      <td className="py-0.5 pr-3">{d.expected}</td>
                      <td className="py-0.5 pr-3 text-red-700">{d.actual}</td>
                      <td className="py-0.5">{d.message}</td>
                    </tr>
                  ))}
                  {check.details.length > 100 && (
                    <tr><td colSpan={4} className="py-1 text-gray-500 italic">... und {check.details.length - 100} weitere</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import type { ValidationDashboardData, BestellungData, WTConfig, WT } from '../../types';
import StatusBar from './StatusBar';
import HardCheckList from './HardCheckList';
import MetricGrid from './MetricGrid';
import ComparisonChart from './ComparisonChart';
import PickHistogram from './PickHistogram';
import ExtremeFinder from './ExtremeFinder';
import WTInspector from './WTInspector';
import OrderSimulator from './OrderSimulator';
import CoOccurrenceChecker from './CoOccurrenceChecker';
import { exportValidationCSV } from '../../validation/exportCSV';

type CoOccurrenceMatrix = Record<string, Record<string, number>>;

interface Props {
  data: ValidationDashboardData;
  wts: WT[];
  bestellungen: BestellungData[];
  config: WTConfig;
  coMatrix: CoOccurrenceMatrix;
  artikelBezeichnungen: Map<string, string>;
  onExportBelegungsplan: () => void;
}

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
      >
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export default function ValidationDashboard({
  data, wts, bestellungen, config, coMatrix, artikelBezeichnungen, onExportBelegungsplan
}: Props) {
  const [inspectorWTId, setInspectorWTId] = useState<string | undefined>();

  const handleExportValidation = () => {
    const csv = exportValidationCSV(data, config);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'validierungsbericht.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSelectWT = (wtId: string) => {
    setInspectorWTId(wtId);
    document.getElementById('wt-inspector-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="space-y-4">
      <StatusBar
        data={data}
        onExport={onExportBelegungsplan}
        onExportValidation={handleExportValidation}
      />

      <Section title="Automatische Checks (C1–C8)">
        <HardCheckList checks={data.hardChecks} />
      </Section>

      <Section title="Qualitätsmetriken (M1–M10)">
        <div className="space-y-4">
          <MetricGrid metrics={data.metrics} />
          <ComparisonChart metrics={data.metrics} />
          {data.orderSimulation && <PickHistogram simulation={data.orderSimulation} />}
        </div>
      </Section>

      <Section title="Extremfall-Finder" defaultOpen={false}>
        <ExtremeFinder extremes={data.extremes} onSelectWT={handleSelectWT} />
      </Section>

      <Section title="WT-Inspektor" defaultOpen={false}>
        <div id="wt-inspector-section">
          <WTInspector wts={wts} initialWTId={inspectorWTId} />
        </div>
      </Section>

      <Section title="Bestellsimulator" defaultOpen={false}>
        <OrderSimulator wts={wts} bestellungen={bestellungen} />
      </Section>

      <Section title="Co-Occurrence-Prüfer" defaultOpen={false}>
        <CoOccurrenceChecker wts={wts} coMatrix={coMatrix} artikelBezeichnungen={artikelBezeichnungen} />
      </Section>
    </div>
  );
}

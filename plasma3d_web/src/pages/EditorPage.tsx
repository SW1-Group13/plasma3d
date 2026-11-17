import { useState } from 'react';
import { useBudgetStore } from '@/entities/budget/store';
import { structuralApi } from '@/entities/structural/api';
import type { StructuralAnalysis } from '@/entities/structural/types';
import type { ModelSummary } from '@/entities/model3D/three/Modelo3D';
import { EditorViewer } from '@/widgets/viewer3d/EditorViewer';
import { BudgetDialog } from '@/features/budget/ui/BudgetDialog';
import { PricesDialog } from '@/features/budget/ui/PricesDialog';
import { RiskDialog } from '@/features/risk/ui/RiskDialog';
import { toast } from '@/shared/ui/toast';

export function EditorPage() {
  const generateBudget = useBudgetStore((s) => s.generate);

  const [budgetOpen, setBudgetOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [analysis, setAnalysis] = useState<StructuralAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);

  async function handleBudget(summary: ModelSummary) {
    setBudgetOpen(true);
    try {
      await generateBudget(summary);
    } catch {
      toast.error('Error', 'No se pudo generar el presupuesto.');
    }
  }

  async function handleAnalyze(file: File) {
    setAnalyzing(true);
    setAnalysisOpen(true);
    setAnalysis(null);
    try {
      const response = await structuralApi.analyze(file);
      setAnalysis(response);
      toast.success('Análisis listo', 'Se generó el análisis estructural.');
    } catch {
      setAnalysisOpen(false);
      toast.error('Error', 'No se pudo analizar el modelo.');
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      <EditorViewer
        onBudget={handleBudget}
        onOpenPrices={() => setPricesOpen(true)}
        onAnalyze={handleAnalyze}
      />

      <RiskDialog
        open={analysisOpen}
        onOpenChange={setAnalysisOpen}
        analysis={analysis}
        loading={analyzing}
      />

      <BudgetDialog
        open={budgetOpen}
        onClose={() => setBudgetOpen(false)}
        onOpenPrices={() => setPricesOpen(true)}
      />
      <PricesDialog open={pricesOpen} onClose={() => setPricesOpen(false)} />
    </>
  );
}

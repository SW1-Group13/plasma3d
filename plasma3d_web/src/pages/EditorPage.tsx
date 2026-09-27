import { useState } from 'react';
import { useBudgetStore } from '@/entities/budget/store';
import { structuralApi } from '@/entities/structural/api';
import type { StructuralAnalysis } from '@/entities/structural/types';
import type { ModelSummary } from '@/entities/model3D/three/Modelo3D';
import { EditorViewer } from '@/widgets/viewer3d/EditorViewer';
import { BudgetDialog } from '@/features/budget/ui/BudgetDialog';
import { PricesDialog } from '@/features/budget/ui/PricesDialog';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Spinner } from '@/shared/ui/spinner';
import { toast } from '@/shared/ui/toast';

export function EditorPage() {
  const generateBudget = useBudgetStore((s) => s.generate);

  const [budgetOpen, setBudgetOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [analysis, setAnalysis] = useState<StructuralAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

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
    try {
      const response = await structuralApi.analyze(file);
      setAnalysis(response);
      toast.success('Analisis listo', 'Se genero el analisis estructural.');
    } catch {
      toast.error('Error', 'No se pudo analizar el modelo.');
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Editor 3D</h1>
        <p className="text-sm text-slate-500">
          Selecciona una pieza y usa el gizmo o los campos para mover, rotar y escalar.
        </p>
      </div>

      <EditorViewer
        onBudget={handleBudget}
        onOpenPrices={() => setPricesOpen(true)}
        onAnalyze={handleAnalyze}
      />

      {(analyzing || analysis) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Analisis estructural
              {analyzing && <Spinner className="h-4 w-4" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyzing ? (
              <p className="text-sm text-slate-500">Analizando modelo...</p>
            ) : (
              analysis && (
                <div className="flex flex-col gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Riesgo global:</span>
                    <Badge className="bg-amber-100 text-amber-800">
                      {analysis.analisis.resumen_general.nivel_riesgo_global}
                    </Badge>
                  </div>
                  <p className="text-slate-700">{analysis.analisis.resumen_general.comentario}</p>

                  {analysis.analisis.recomendaciones.length > 0 && (
                    <div>
                      <h4 className="mb-1 font-medium text-slate-800">Recomendaciones</h4>
                      <ul className="list-disc space-y-1 pl-5 text-slate-600">
                        {analysis.analisis.recomendaciones.map((rec, index) => (
                          <li key={index}>
                            {rec.para_elemento}: {rec.cambiar_de} → {rec.cambiar_a} ({rec.razon})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            )}
          </CardContent>
        </Card>
      )}

      <BudgetDialog open={budgetOpen} onClose={() => setBudgetOpen(false)} />
      <PricesDialog open={pricesOpen} onClose={() => setPricesOpen(false)} />
    </div>
  );
}

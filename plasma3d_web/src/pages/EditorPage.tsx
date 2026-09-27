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
import { SparklesIcon } from '@/shared/ui/icons';
import { toast } from '@/shared/ui/toast';

function riskColor(level: string): string {
  const l = level?.toLowerCase() ?? '';
  if (l.includes('alto')) return 'border-danger/40 bg-danger/10 text-danger';
  if (l.includes('medio')) return 'border-warning/40 bg-warning/10 text-warning';
  return 'border-success/40 bg-success/10 text-success';
}

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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Editor 3D</h1>
        <p className="mt-1 text-sm text-muted">
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
              <SparklesIcon width={18} height={18} className="text-accent" />
              Analisis estructural
              {analyzing && <Spinner className="h-4 w-4 text-muted" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyzing ? (
              <p className="text-sm text-muted">Analizando modelo...</p>
            ) : (
              analysis && (
                <div className="flex flex-col gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted">Riesgo global:</span>
                    <Badge className={riskColor(analysis.analisis.resumen_general.nivel_riesgo_global)}>
                      {analysis.analisis.resumen_general.nivel_riesgo_global}
                    </Badge>
                  </div>
                  {analysis.analisis.resumen_general.comentario && (
                    <p className="text-foreground/80">{analysis.analisis.resumen_general.comentario}</p>
                  )}

                  {analysis.analisis.recomendaciones.length > 0 && (
                    <div>
                      <h4 className="mb-2 font-medium text-foreground">Recomendaciones</h4>
                      <ul className="flex flex-col gap-1.5 text-muted">
                        {analysis.analisis.recomendaciones.map((rec, index) => (
                          <li key={index} className="flex gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            <span>
                              <span className="text-foreground">{rec.para_elemento}</span>: {rec.cambiar_de} →
                              {' '}
                              {rec.cambiar_a} ({rec.razon})
                            </span>
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

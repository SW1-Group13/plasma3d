import type { StructuralAnalysis } from '@/entities/structural/types';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { AlertTriangleIcon, SparklesIcon } from '@/shared/ui/icons';
import { Spinner } from '@/shared/ui/spinner';

function riskColor(level?: string): string {
  const l = (level ?? '').toLowerCase();
  if (l.includes('crítico') || l.includes('critico') || l.includes('alto')) {
    return 'border-danger/40 bg-danger/10 text-danger';
  }
  if (l.includes('medio')) {
    return 'border-warning/40 bg-warning/10 text-warning';
  }
  return 'border-success/40 bg-success/10 text-success';
}

interface RiskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: StructuralAnalysis | null;
  loading: boolean;
  planId?: number | null;
}

export function RiskDialog({
  open,
  onOpenChange,
  analysis,
  loading,
  planId,
}: RiskDialogProps) {
  const analisis = analysis?.analisis;
  const nivel = analisis?.resumen_general?.nivel_riesgo_global;
  const fuente = analysis?.fuente;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon width={18} height={18} className="text-accent" />
            Riesgo estructural
          </DialogTitle>
          <DialogDescription>
            {planId
              ? `Modelo #${planId}`
              : analysis?.nombre_archivo ?? 'Analizando modelo...'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-3 py-8 text-sm text-muted">
            <Spinner className="h-5 w-5 text-primary" /> Analizando con IA...
          </div>
        ) : !analisis ? (
          <p className="py-6 text-sm text-muted">
            No se pudo obtener el análisis. Inténtalo de nuevo.
          </p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Riesgo global:</span>
              <Badge className={riskColor(nivel)}>{nivel ?? 'bajo'}</Badge>
              {fuente && (
                <Badge className="border-border bg-surface-2 text-muted">
                  {fuente === 'gemini' ? 'IA Gemini' : 'Motor de reglas'}
                </Badge>
              )}
            </div>

            {analisis.resumen_general.comentario && (
              <p className="text-foreground/80">
                {analisis.resumen_general.comentario}
              </p>
            )}

            {analisis.elementos_mal_hechos.length > 0 && (
              <section>
                <h4 className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <AlertTriangleIcon width={15} height={15} className="text-warning" />
                  Hallazgos
                </h4>
                <ul className="flex flex-col gap-2">
                  {analisis.elementos_mal_hechos.map((item, index) => (
                    <li
                      key={`${item.tipo}-${index}`}
                      className="rounded-lg border border-border bg-surface-2/60 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium capitalize text-foreground">
                          {item.tipo}
                        </span>
                        <Badge className={riskColor(item.nivel_riesgo)}>
                          {item.nivel_riesgo ?? 'medio'}
                        </Badge>
                      </div>
                      {item.problema && (
                        <p className="mt-1 text-muted">{item.problema}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {analisis.recomendaciones.length > 0 && (
              <section>
                <h4 className="mb-2 font-medium text-foreground">
                  Recomendaciones
                </h4>
                <ul className="flex flex-col gap-1.5 text-muted">
                  {analisis.recomendaciones.map((rec, index) => (
                    <li key={`${rec.para_elemento}-${index}`} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>
                        <span className="capitalize text-foreground">
                          {rec.para_elemento}
                        </span>
                        : {rec.cambiar_de} → {rec.cambiar_a}
                        {rec.razon ? ` (${rec.razon})` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {analisis.elementos_bien_hechos.length > 0 && (
              <details className="rounded-lg border border-border bg-surface-2/40 p-3">
                <summary className="cursor-pointer text-muted">
                  Elementos correctos ({analisis.elementos_bien_hechos.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-muted">
                  {analisis.elementos_bien_hechos.map((item, index) => (
                    <li key={`${item.tipo}-${index}`}>
                      <span className="capitalize text-foreground">{item.tipo}</span>
                      : {item.cantidad} · {item.material_usado}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

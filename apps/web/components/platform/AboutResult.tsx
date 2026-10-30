"use client";

import * as Dialog from "radix-ui/dialog";
import { CircleHelp, X } from "lucide-react";
import { formatNumber, type AnalysisResult } from "../analysis-types";

export default function AboutResult({ result }: { result: AnalysisResult }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="text-button result-help">
          <CircleHelp size={15} />
          Sobre o resultado
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content result-about-dialog">
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">
              Sobre o resultado
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Método de classificação e limites de interpretação.
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                className="icon-button dialog-close"
                aria-label="Fechar explicação"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>
          <div className="result-explanation">
            <h3>Classificação</h3>
            <p>
              {result.method === "rf_purified_multiclass_2.0"
                ? "Random Forest com referência de uso do solo MapBiomas."
                : result.method}
            </p>
            <p>{result.limitations}</p>
            <h3>NDVI</h3>
            <p>
              Mediana do índice nos pixels válidos da imagem. O índice de
              vegetação sozinho não comprova a presença de café.
            </p>
            <details>
              <summary>Dados técnicos</summary>
              <dl className="detail-values">
                <div>
                  <dt>Método</dt>
                  <dd>{result.method}</dd>
                </div>
                <div>
                  <dt>Pixels válidos</dt>
                  <dd>{formatNumber(result.valid_pixels, 0)}</dd>
                </div>
              </dl>
            </details>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import type { ReactNode } from "react";
import type { SimulationOutcome } from "@/lib/domain/contracts";
import type { View } from "@/components/layout/navigation";
import { IntegrationPanel } from "@/components/lab/integration-panel";
import { ResetPanel } from "@/components/lab/reset-panel";
import { ScenarioControls } from "@/components/lab/scenario-controls";

interface LabViewProps {
  outcome: SimulationOutcome;
  onOutcomeChange: (outcome: SimulationOutcome) => void;
  connectedChainId: number;
  busy: string | null;
  onNetworkChange: (chainId: number) => void;
  onChangeView: (view: View) => void;
  reconciliationPanel: ReactNode;
  confirmReset: boolean;
  onConfirmResetChange: (confirm: boolean) => void;
  onReset: () => void;
}

/** Aba "Laboratório" (somente modo simulado): cenários, rede, reinício e notas de integração. */
export function LabView({
  outcome,
  onOutcomeChange,
  connectedChainId,
  busy,
  onNetworkChange,
  onChangeView,
  reconciliationPanel,
  confirmReset,
  onConfirmResetChange,
  onReset,
}: LabViewProps) {
  return (
    <div className="laboratory-layout">
      <ScenarioControls
        outcome={outcome}
        onOutcomeChange={onOutcomeChange}
        connectedChainId={connectedChainId}
        busy={busy}
        onNetworkChange={onNetworkChange}
        onTryTransfer={() => onChangeView("transfers")}
      />
      <div className="side-panels">
        {reconciliationPanel}
        <ResetPanel
          confirmReset={confirmReset}
          busy={busy}
          onAskConfirm={() => onConfirmResetChange(true)}
          onCancel={() => onConfirmResetChange(false)}
          onReset={onReset}
        />
      </div>
      <IntegrationPanel/>
    </div>
  );
}

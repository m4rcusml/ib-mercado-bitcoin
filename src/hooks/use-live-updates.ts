import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BridgeState } from "@/lib/domain/contracts";
import { callApi } from "@/lib/client/api";
import { OPEN_STATUSES } from "@/lib/client/bridge-view";

interface LiveUpdatesOptions {
  activeEmail: string | undefined;
  hasProcessing: boolean;
  privyMode: boolean;
  setState: Dispatch<SetStateAction<BridgeState | null>>;
  setError: Dispatch<SetStateAction<string>>;
}

/**
 * Atualizações em tempo real: SSE em `/api/events` e polling de fallback.
 * No modo simulado o polling de `/api/simulation/advance` continua, pois é ele que avança a simulação.
 */
export function useLiveUpdates({ activeEmail, hasProcessing, privyMode, setState, setError }: LiveUpdatesOptions) {
  // SSE: o servidor empurra o estado da conta a cada mudança (worker de reconciliação ou outra aba).
  const [sseLive, setSseLive] = useState(false);
  useEffect(() => {
    if (!activeEmail || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    source.onopen = () => setSseLive(true);
    source.onerror = () => setSseLive(false); // o EventSource reconecta sozinho; o polling assume enquanto isso
    source.addEventListener("state", (event) => {
      try { setState(JSON.parse((event as MessageEvent<string>).data) as BridgeState); setSseLive(true); }
      catch { /* evento malformado: mantém o estado atual */ }
    });
    return () => { source.close(); setSseLive(false); };
  }, [activeEmail, setState]);

  useEffect(() => {
    // No modo Privy o worker do servidor reconcilia e o SSE entrega; polling só como fallback.
    // No modo simulado o polling continua, pois é ele que avança a simulação.
    if (!hasProcessing || !activeEmail || (privyMode && sseLive)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const interval = privyMode ? 4000 : 1000;
    // Modo simulado avança a simulação; modo Privy apenas pede reconciliação/estado ao servidor.
    const fetchNext = () => privyMode
      ? callApi<BridgeState>("/api/reconciliation/advance", { method: "POST", signal: controller.signal })
        .catch((err: unknown) => {
          if (controller.signal.aborted) throw err;
          return callApi<BridgeState>("/api/state", { signal: controller.signal });
        })
      : callApi<BridgeState>("/api/simulation/advance", { method: "POST", signal: controller.signal });
    const advance = async () => {
      try {
        const next = await fetchNext();
        if (controller.signal.aborted) return;
        setState(next);
        if (next.transactions.some((tx) => OPEN_STATUSES.has(tx.status))) timer = setTimeout(advance, interval);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Não foi possível atualizar a operação.");
          timer = setTimeout(advance, 3000);
        }
      }
    };
    timer = setTimeout(advance, interval);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [hasProcessing, activeEmail, privyMode, sseLive, setState, setError]);
}

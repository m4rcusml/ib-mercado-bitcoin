import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeState } from "@/lib/domain/contracts";
import { callApi } from "@/lib/client/api";

/**
 * Estado da conta (`/api/state`), mensagens de erro/aviso, ação em andamento (`busy`) e o
 * helper `perform`, que envia um POST e aplica o novo estado devolvido pelo servidor.
 */
export function useBridgeState() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const controllers = useRef(new Set<AbortController>());

  useEffect(() => {
    const activeControllers = controllers.current;
    return () => { activeControllers.forEach((controller) => controller.abort()); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    callApi<BridgeState>("/api/state", { signal: controller.signal })
      .then(setState)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError("Não foi possível carregar a conta. Verifique se o servidor local está disponível.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  const requestReload = useCallback(() => setReload((value) => value + 1), []);

  const perform = useCallback(async (key: string, url: string, body?: object, extraHeaders?: Record<string, string>) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy(key); setError(""); setNotice("");
    try {
      const next = await callApi<BridgeState>(url, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers: extraHeaders,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setState(next);
      return next;
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Não foi possível concluir a ação.");
      return null;
    } finally {
      controllers.current.delete(controller);
      if (!controller.signal.aborted) setBusy(null);
    }
  }, []);

  return {
    state,
    setState,
    loading,
    requestReload,
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    /** Controladores de requisições em andamento, abortados ao desmontar a página. */
    controllers,
    perform,
  };
}

export type Perform = ReturnType<typeof useBridgeState>["perform"];

import { useState } from "react";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { callApi } from "@/lib/client/api";
import type { Perform } from "@/hooks/use-bridge-state";

export type LoginStep = "email" | "code";

interface LoginFlowOptions {
  perform: Perform;
  controllers: RefObject<Set<AbortController>>;
  setBusy: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

/** Login de demonstração em dois passos: pedir código (`/api/auth/request-code`) e entrar (`/api/auth/login`). */
export function useLoginFlow({ perform, controllers, setBusy, setError, setNotice }: LoginFlowOptions) {
  const [email, setEmail] = useState("equipe@demo.local");
  const [loginStep, setLoginStep] = useState<LoginStep>("email");
  const [code, setCode] = useState("");

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy("request-code"); setError("");
    try {
      await callApi<{ demoCode: string }>("/api/auth/request-code", {
        method: "POST",
        body: JSON.stringify({ email }),
        signal: controller.signal,
      });
      setLoginStep("code"); setNotice("Código de demonstração pronto. Nenhum e-mail é enviado neste ambiente.");
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Não foi possível preparar o acesso.");
    } finally {
      controllers.current.delete(controller);
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (await perform("login", "/api/auth/login", { email, code })) { setNotice("Você entrou na conta de demonstração."); setCode(""); }
  }

  return { email, setEmail, loginStep, setLoginStep, code, setCode, requestCode, login };
}

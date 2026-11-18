import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

/** Copia o endereço da wallet para a área de transferência e mantém o retorno "copiado" por 2,2 s. */
export function useCopyAddress(address: string | null | undefined, setError: Dispatch<SetStateAction<string>>) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione e copie o endereço exibido.");
    }
  }

  return { copied, copyAddress };
}

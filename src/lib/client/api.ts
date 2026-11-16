/** Cliente HTTP da interface. Não importar módulos de servidor (ledger, chain, clients) aqui. */

/** Mensagens da PoC para códigos do servidor; demais erros usam a mensagem enviada pela API. */
export const apiErrorMessages: Record<string, string> = {
  INVALID_PRIVY_TOKEN: "Sua sessão Privy expirou ou é inválida. Conecte a wallet novamente.",
  EMBEDDED_WALLET_NOT_FOUND: "A embedded wallet Privy ainda não foi criada para este login. Aguarde alguns segundos e tente conectar de novo.",
  WALLET_ALREADY_LINKED: "Esta embedded wallet já está vinculada a outra conta de demonstração. Entre com outra conta Privy.",
  PENDING_TRANSACTION: "Há uma operação em andamento. Aguarde a conclusão antes de trocar a wallet.",
  MISSING_CONFIG: "A PoC Sepolia não está configurada no servidor. Avise a equipe responsável pelo ambiente.",
  INVALID_TX_HASH: "A wallet devolveu um hash inválido. Nada foi registrado; tente assinar novamente.",
  INVALID_USER_OP_HASH: "O bundler devolveu um userOpHash inválido. Nada foi registrado; tente assinar novamente.",
  DUPLICATE_USER_OP_HASH: "Este userOpHash já está vinculado a outra transferência e não pode ser reutilizado.",
  SMART_ACCOUNT_MISMATCH: "Smart account divergente do servidor. Entre com a mesma conta Privy usada na vinculação.",
  TRANSFER_NOT_FOUND: "Esta transferência não foi encontrada. Atualize a página.",
  INVALID_TRANSFER_STATUS: "Esta transferência não está mais aguardando assinatura. Atualize a página para ver o estado atual.",
  DUPLICATE_TX_HASH: "Este hash já está vinculado a outra transferência e não pode ser reutilizado.",
  WALLET_LINK_REQUIRED: "No modo Sepolia, conecte a wallet pela Privy.",
  SIMULATION_DISABLED: "Controles de simulação não estão disponíveis no modo Sepolia.",
};

export async function callApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code: unknown = data?.error?.code;
    throw new Error(
      (typeof code === "string" ? apiErrorMessages[code] : undefined)
        ?? data?.error?.message
        ?? "Não foi possível concluir a solicitação. Tente novamente.",
    );
  }
  return data as T;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.WALLET_PROVIDER !== "privy") return;
  await import("./lib/wallet/privy-wallet-provider.ts");
  const { getLedger } = await import("./lib/domain/ledger.ts");
  await getLedger().initialize();
}

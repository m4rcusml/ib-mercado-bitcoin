"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";
import { PrivyProvider, toViemAccount, usePrivy, useWallets } from "@privy-io/react-auth";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { createPublicClient, encodeFunctionData, formatEther, hexToBigInt, http, isAddress } from "viem";
import type { Address, PublicClient, Transport } from "viem";
import { createBundlerClient, toCoinbaseSmartAccount } from "viem/account-abstraction";
import { sepolia } from "viem/chains";
import { COINBASE_SMART_ACCOUNT_VERSION, SEPOLIA_CHAIN_ID, SignerError, toSignerError } from "./signer";
import type { Hex, PrivySigner, SignatureRequest, SmartAccountStatus, SmartAccountTarget } from "./signer";

/** ABI mínima: somente `transfer`. Não importar de `src/lib/chain` (server-only). */
const erc20TransferAbi = [{
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;

type GasPriceTier = { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };
type RawRequest = (args: { method: string; params: unknown[] }) => Promise<unknown>;

/**
 * Transporte para o proxy JSON-RPC autenticado da aplicação (`POST /api/rpc`).
 * A sessão é o cookie HttpOnly `mb_demo_session`, enviado automaticamente na mesma origem.
 * Nenhuma chave de RPC/bundler chega ao navegador.
 */
function proxyTransport(): Transport {
  return http(`${window.location.origin}/api/rpc`, {
    fetchOptions: { credentials: "same-origin", cache: "no-store" },
    retryCount: 1,
    timeout: 30_000,
  });
}

let sharedPublicClient: PublicClient | null = null;
function publicClient(): PublicClient {
  sharedPublicClient ??= createPublicClient({ chain: sepolia, transport: proxyTransport() }) as PublicClient;
  return sharedPublicClient;
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

function validate(request: SignatureRequest, target: SmartAccountTarget): { token: Address; to: Address; amount: bigint } {
  if (request.chainId !== SEPOLIA_CHAIN_ID) throw new SignerError("wrong_chain");
  if (request.entryPoint && request.entryPoint !== "0.6") throw new SignerError("invalid_request");
  if (!isAddress(request.token) || !isAddress(request.to) || !/^\d{1,78}$/.test(request.amountUnits)) throw new SignerError("invalid_request");
  if (!isAddress(target.smartAccount) || !isAddress(target.ownerAddress)) throw new SignerError("invalid_request");
  if (request.smartAccount && !sameAddress(request.smartAccount, target.smartAccount)) throw new SignerError("smart_account_mismatch");
  if (request.ownerAddress && !sameAddress(request.ownerAddress, target.ownerAddress)) throw new SignerError("owner_mismatch");
  const amount = BigInt(request.amountUnits);
  if (amount <= 0n) throw new SignerError("invalid_request");
  return { token: request.token, to: request.to, amount };
}

async function readStatus(address: string): Promise<SmartAccountStatus> {
  if (!isAddress(address)) throw new SignerError("invalid_request");
  try {
    const client = publicClient();
    const [balanceWei, code] = await Promise.all([client.getBalance({ address }), client.getCode({ address })]);
    return { address, balanceWei, balanceEth: formatEther(balanceWei), deployed: !!code && code !== "0x" };
  } catch (error) { throw toSignerError(error); }
}

async function sendUserOperation(wallet: ConnectedWallet, request: SignatureRequest, target: SmartAccountTarget): Promise<Hex> {
  const { token, to, amount } = validate(request, target);
  const client = publicClient();
  if (await client.getChainId() !== SEPOLIA_CHAIN_ID) throw new SignerError("wrong_chain");

  // 1. EOA embedded Privy como dona/assinante (assina o hash da UserOperation sem prefixo).
  const owner = await toViemAccount({ wallet });
  if (!sameAddress(owner.address, target.ownerAddress)) throw new SignerError("owner_mismatch");

  // 2. Coinbase Smart Account (EntryPoint v0.6). O endereço precisa ser o mesmo derivado pelo servidor.
  const account = await toCoinbaseSmartAccount({ client, owners: [owner], version: COINBASE_SMART_ACCOUNT_VERSION });
  if (!sameAddress(account.address, target.smartAccount)) throw new SignerError("smart_account_mismatch");

  // 3. Sem paymaster: a própria smart account paga o gas. Recusa antes de pedir assinatura se não há ETH.
  const balance = await client.getBalance({ address: account.address });
  if (balance === 0n) throw new SignerError("no_eth");

  // 4. Bundler (Pimlico via proxy). Preço de gas do bundler (tier "fast"), com fallback para o RPC.
  const bundlerClient = createBundlerClient({
    account,
    client,
    chain: sepolia,
    transport: proxyTransport(),
    userOperation: {
      async estimateFeesPerGas({ bundlerClient: bundler }) {
        try {
          const prices = await (bundler.request as unknown as RawRequest)({ method: "pimlico_getUserOperationGasPrice", params: [] }) as { fast?: GasPriceTier } | null;
          if (prices?.fast?.maxFeePerGas && prices.fast.maxPriorityFeePerGas) {
            return { maxFeePerGas: hexToBigInt(prices.fast.maxFeePerGas), maxPriorityFeePerGas: hexToBigInt(prices.fast.maxPriorityFeePerGas) };
          }
        } catch { /* bundler sem o método: usa o RPC */ }
        const fees = await client.estimateFeesPerGas();
        return { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
      },
    },
  });

  // 5. Envia e devolve o hash imediatamente; quem observa o receipt é o servidor.
  const data = encodeFunctionData({ abi: erc20TransferAbi, functionName: "transfer", args: [to, amount] });
  return await bundlerClient.sendUserOperation({ calls: [{ to: token, data, value: 0n }] });
}

function SignerBridge({ onSigner }: { onSigner: (signer: PrivySigner | null) => void }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const embedded = wallets.find((wallet: ConnectedWallet) => wallet.walletClientType === "privy") ?? null;
  const embeddedRef = useRef(embedded);
  useEffect(() => { embeddedRef.current = embedded; }, [embedded]);
  // As funções do Privy mudam de identidade a cada render; mantê-las em ref evita
  // recriar o signer (e o loop setSigner -> re-render -> novo signer).
  const actionsRef = useRef({ login, logout, getAccessToken, authenticated });
  useEffect(() => { actionsRef.current = { login, logout, getAccessToken, authenticated }; });

  const ownerAddress = embedded?.address ?? null;
  const isReady = ready && walletsReady;
  const signer = useMemo<PrivySigner>(() => ({
    ready: isReady,
    authenticated,
    ownerAddress,
    login: () => actionsRef.current.login(),
    logout: async () => { await actionsRef.current.logout(); },
    getAccessToken: () => actionsRef.current.getAccessToken(),
    getSmartAccountStatus: readStatus,
    async sendUserOperation(request, target) {
      if (!actionsRef.current.authenticated) throw new SignerError("not_authenticated");
      const wallet = embeddedRef.current;
      if (!wallet) throw new SignerError("no_wallet");
      try { return await sendUserOperation(wallet, request, target); }
      catch (error) { throw toSignerError(error); }
    },
  }), [isReady, authenticated, ownerAddress]);

  useEffect(() => { onSigner(signer); }, [signer, onSigner]);
  useEffect(() => () => onSigner(null), [onSigner]);
  return null;
}

/**
 * Provider Privy para a PoC Sepolia. Só é carregado (via import dinâmico) quando o
 * servidor informa `mode === "privy"` e um `privyAppId` público. Não recebe segredos.
 */
// Constante de módulo: um objeto novo a cada render faria o PrivyProvider reinicializar.
const PRIVY_CONFIG = {
  loginMethods: ["email"],
  defaultChain: sepolia,
  supportedChains: [sepolia],
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
  appearance: { theme: "light" },
} satisfies ComponentProps<typeof PrivyProvider>["config"];

export default function PrivyRoot({ appId, onSigner, children }: { appId: string; onSigner: (signer: PrivySigner | null) => void; children?: ReactNode }) {
  return <PrivyProvider appId={appId} config={PRIVY_CONFIG}>
    <SignerBridge onSigner={onSigner}/>
    {children}
  </PrivyProvider>;
}

#!/usr/bin/env bash
# Implanta o Mock USDC (SOMENTE Sepolia/testnet) com Foundry e cunha saldo
# para a tesouraria. A conta da tesouraria é a deployer, portanto vira owner.
#
# Uso (WSL/Linux, na raiz do repo):  bash scripts/poc/deploy-mock-usdc.sh [quantidade_mUSDC] [token_existente]
#   Com token_existente, não implanta outro contrato: só cunha para a tesouraria.
# Requer: forge e cast no PATH; ALCHEMY_RPC_URL, TREASURY_ADDRESS e
# TREASURY_PRIVATE_KEY em .env.local ou .env. Nenhum segredo é impresso.
set -euo pipefail

AMOUNT="${1:-1000}"  # mUSDC inteiros a cunhar (padrão: 1.000)

# foundryup instala em ~/.foundry/bin, que nem sempre está no PATH do shell.
export PATH="$HOME/.foundry/bin:$PATH"

for file in .env.local .env; do
  if [[ -f "$file" ]]; then
    # Exporta só as variáveis necessárias, sem sobrescrever o ambiente atual.
    while IFS='=' read -r key value; do
      key="${key//[[:space:]]/}"
      case "$key" in
        ALCHEMY_RPC_URL|TREASURY_ADDRESS|TREASURY_PRIVATE_KEY)
          value="${value%$'\r'}"; value="${value%\"}"; value="${value#\"}"
          if [[ -z "${!key:-}" ]]; then export "$key=$value"; fi ;;
      esac
    done < <(grep -E '^[[:space:]]*(ALCHEMY_RPC_URL|TREASURY_ADDRESS|TREASURY_PRIVATE_KEY)[[:space:]]*=' "$file" || true)
  fi
done

for var in ALCHEMY_RPC_URL TREASURY_ADDRESS TREASURY_PRIVATE_KEY; do
  if [[ -z "${!var:-}" ]]; then echo "ERRO: $var ausente em .env/.env.local" >&2; exit 1; fi
done
command -v forge >/dev/null || { echo "ERRO: forge não encontrado. Instale o Foundry (veja README)." >&2; exit 1; }

CHAIN_ID="$(cast chain-id --rpc-url "$ALCHEMY_RPC_URL")"
if [[ "$CHAIN_ID" != "11155111" ]]; then
  echo "ERRO: o RPC não é Sepolia (chainId $CHAIN_ID). Abortando." >&2; exit 1
fi

DERIVED="$(cast wallet address --private-key "$TREASURY_PRIVATE_KEY")"
if [[ "${DERIVED,,}" != "${TREASURY_ADDRESS,,}" ]]; then
  echo "ERRO: TREASURY_PRIVATE_KEY não corresponde a TREASURY_ADDRESS." >&2; exit 1
fi

BALANCE="$(cast balance "$TREASURY_ADDRESS" --rpc-url "$ALCHEMY_RPC_URL")"
if [[ "$BALANCE" == "0" ]]; then
  echo "ERRO: a tesouraria não tem ETH Sepolia para gas. Use um faucet." >&2; exit 1
fi

EXISTING="${2:-}"  # opcional: endereço de um MockUSDC já implantado (só cunha)
if [[ -n "$EXISTING" ]]; then
  if [[ ! "$EXISTING" =~ ^0x[0-9a-fA-F]{40}$ ]]; then echo "ERRO: endereço do token inválido." >&2; exit 1; fi
  if [[ "$(cast code "$EXISTING" --rpc-url "$ALCHEMY_RPC_URL")" == "0x" ]]; then
    echo "ERRO: não há contrato em $EXISTING na Sepolia." >&2; exit 1
  fi
  TOKEN="$EXISTING"
  echo "Usando MockUSDC existente: $TOKEN"
else
  echo "Implantando MockUSDC na Sepolia a partir de $TREASURY_ADDRESS..."
  OUTPUT="$(forge create contracts/MockUSDC.sol:MockUSDC \
    --rpc-url "$ALCHEMY_RPC_URL" --private-key "$TREASURY_PRIVATE_KEY" --broadcast --json 2>&1)" || {
    echo "ERRO: forge create falhou:" >&2; echo "$OUTPUT" | grep -iv "private" >&2; exit 1; }
  # Tolera espaços no JSON ("deployedTo": "0x...").
  TOKEN="$(echo "$OUTPUT" | grep -o '"deployedTo"[[:space:]]*:[[:space:]]*"0x[0-9a-fA-F]\{40\}"' | grep -o '0x[0-9a-fA-F]\{40\}' || true)"
  if [[ -z "$TOKEN" ]]; then echo "ERRO: não foi possível ler o endereço implantado; confira o explorer da tesouraria." >&2; exit 1; fi
  echo "MockUSDC implantado em: $TOKEN"
fi

UNITS="${AMOUNT}000000"  # 6 decimais
echo "Cunhando $AMOUNT mUSDC para a tesouraria..."
cast send "$TOKEN" "mint(address,uint256)" "$TREASURY_ADDRESS" "$UNITS" \
  --rpc-url "$ALCHEMY_RPC_URL" --private-key "$TREASURY_PRIVATE_KEY" >/dev/null

echo
echo "Pronto. Adicione ao .env:"
echo "MOCK_USDC_ADDRESS=$TOKEN"
echo "Explorer: https://sepolia.etherscan.io/address/$TOKEN"
echo "Depois rode: npm run diagnose:sepolia"

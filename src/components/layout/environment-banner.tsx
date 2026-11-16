import { Icon } from "@/components/icon";

/** Faixa que identifica o ambiente: testnet Sepolia (modo Privy) ou simulação local. */
export function EnvironmentBanner({ privyMode }: { privyMode: boolean }) {
  if (privyMode) {
    return (
      <div className="simulation-banner" role="note">
        <Icon name="info" size={15}/>
        <span><strong>Testnet Sepolia — ativos de teste, não é produto oficial.</strong> As transferências usam Mock USDC sem valor e não representam o Mercado Bitcoin.</span>
        <span className="local-indicator"><span/> Sepolia</span>
      </div>
    );
  }
  return (
    <div className="simulation-banner">
      <Icon name="info" size={15}/>
      <span><strong>Ambiente de simulação.</strong> Nenhum ativo real ou conexão com a blockchain.</span>
      <span className="local-indicator"><span/> Local</span>
    </div>
  );
}

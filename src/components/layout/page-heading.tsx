import type { View } from "@/components/layout/navigation";

interface PageHeadingProps {
  title: string | undefined;
  view: View;
  privyMode: boolean;
  wrongNetwork: boolean;
}

function subtitle(view: View, privyMode: boolean) {
  if (view === "overview") return "Sua conta e sua wallet, conectadas por novas possibilidades.";
  if (view === "transfers") return "Movimente Mock USDC entre seus dois ambientes.";
  if (view === "activity") return privyMode ? "Acompanhe o caminho de cada transferência na Sepolia." : "Acompanhe o caminho de cada transferência simulada.";
  return "Controle os cenários e valide a integração da sua equipe.";
}

export function PageHeading({ title, view, privyMode, wrongNetwork }: PageHeadingProps) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle(view, privyMode)}</p>
      </div>
      <span className={`network-pill ${wrongNetwork ? "network-wrong" : ""}`}>
        <span/>
        {wrongNetwork ? "Rede incompatível" : privyMode ? "Sepolia · testnet" : "Sepolia · simulada"}
      </span>
    </div>
  );
}

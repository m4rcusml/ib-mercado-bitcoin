export function PageFooter({ privyMode }: { privyMode: boolean }) {
  return (
    <footer className="page-footer">
      <span>MB Wallet Bridge <span>·</span> Projeto acadêmico Inteli Blockchain</span>
      <span>{privyMode ? "PoC independente em testnet. Sem ativos reais." : "Simulador independente. Sem ativos reais."}</span>
    </footer>
  );
}

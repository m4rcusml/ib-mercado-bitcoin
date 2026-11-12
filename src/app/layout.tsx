import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MB Wallet Bridge | Simulador acadêmico",
  description: "Ambiente local de demonstração para explorar a comunicação entre uma conta custodial e uma wallet pessoal. Nenhum ativo real.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}

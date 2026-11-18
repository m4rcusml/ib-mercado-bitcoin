import { Icon } from "@/components/icon";
import type { NavigationItem, View } from "@/components/layout/navigation";

interface SidebarProps {
  items: NavigationItem[];
  view: View;
  onChangeView: (view: View) => void;
  /** Navegação bloqueada enquanto não há usuário autenticado. */
  disabled: boolean;
  privyMode: boolean;
}

export function Sidebar({ items, view, onChangeView, disabled, privyMode }: SidebarProps) {
  return (
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="MB Wallet Bridge, início">
        <span className="brand-symbol">mb<span/></span>
        <span className="brand-name">wallet<br/><strong>bridge</strong></span>
      </a>
      <div className="workspace-label"><span className="workspace-dot"/> Espaço de demonstração</div>
      <nav aria-label="Navegação principal">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${view === item.id ? "active" : ""}`}
            onClick={() => onChangeView(item.id)}
            aria-current={view === item.id ? "page" : undefined}
            disabled={disabled}
          >
            <Icon name={item.icon} size={19}/>
            <span>{item.title}</span>
            {view === item.id ? <span className="nav-indicator"/> : null}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <Icon name="code" size={20}/>
          <strong>Construído para explorar</strong>
          <p>Uma base para conectar custódia e autonomia.</p>
          <span>Inteli Blockchain × MB</span>
        </div>
        <div className="academic-tag"><span/> {privyMode ? "PoC acadêmica · Sepolia" : "Simulador acadêmico"}</div>
      </div>
    </aside>
  );
}

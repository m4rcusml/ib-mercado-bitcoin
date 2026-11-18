import { Icon } from "@/components/icon";

interface TopbarProps {
  /** Título exibido no breadcrumb. */
  title: string | undefined;
  userEmail: string | null;
  busy: boolean;
  onLogout: () => void;
}

export function Topbar({ title, userEmail, busy, onLogout }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-breadcrumb">Minha conta <Icon name="chevron" size={13}/><strong>{title}</strong></div>
      <div className="account-menu">
        {userEmail ? (
          <>
            <span className="user-email">{userEmail}</span>
            <span className="avatar">{userEmail.slice(0, 2).toUpperCase()}</span>
            <button className="icon-button logout-button" title="Sair da conta" aria-label="Sair da conta" disabled={busy} onClick={onLogout}>
              <Icon name="logout" size={18}/>
            </button>
          </>
        ) : (
          <span className="demo-account"><Icon name="shield" size={15}/> Conta de demonstração</span>
        )}
      </div>
    </header>
  );
}

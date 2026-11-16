import { Icon } from "@/components/icon";

export function LoadingState() {
  return (
    <div className="loading-state" aria-busy="true" aria-label="Carregando conta">
      <div className="skeleton skeleton-title"/>
      <div className="loading-columns">
        <div className="skeleton skeleton-card"/>
        <div className="skeleton skeleton-card"/>
      </div>
      <div className="skeleton skeleton-content"/>
      <p>Preparando seu ambiente de demonstração…</p>
    </div>
  );
}

export function ConnectionState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="connection-state">
      <Icon name="refresh" size={32}/>
      <h1>Vamos tentar novamente?</h1>
      <p>O ambiente local ainda não respondeu.</p>
      <button className="button primary" onClick={onRetry}>Recarregar conta</button>
    </div>
  );
}

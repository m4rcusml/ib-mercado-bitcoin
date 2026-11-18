import type { FormEvent } from "react";
import { Icon } from "@/components/icon";
import type { LoginStep } from "@/hooks/use-login-flow";

interface LoginPanelProps {
  loginStep: LoginStep;
  email: string;
  code: string;
  busy: boolean;
  onEmailChange: (email: string) => void;
  onCodeChange: (code: string) => void;
  onRequestCode: (event: FormEvent) => void;
  onLogin: (event: FormEvent) => void;
  onChangeEmail: () => void;
}

/** Formulário de acesso à demonstração: e-mail → código local. */
export function LoginPanel({
  loginStep,
  email,
  code,
  busy,
  onEmailChange,
  onCodeChange,
  onRequestCode,
  onLogin,
  onChangeEmail,
}: LoginPanelProps) {
  return (
    <section className="login-panel panel">
      <div className="login-panel-heading">
        <h2>{loginStep === "email" ? "Entre na demonstração" : "Confirme seu acesso"}</h2>
        <p>
          {loginStep === "email"
            ? "Use um e-mail para criar seu espaço local de testes."
            : <>Conta de demonstração para <strong>{email}</strong>.</>}
        </p>
      </div>
      {loginStep === "email" ? (
        <form onSubmit={onRequestCode}>
          <label htmlFor="email">Seu e-mail</label>
          <div className="email-field">
            <Icon name="mail" size={18}/>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              disabled={busy}
            />
          </div>
          <button className="button primary full-width" disabled={busy} type="submit">
            {busy ? "Preparando acesso…" : "Continuar com e-mail"}
            <Icon name="arrow" size={18}/>
          </button>
        </form>
      ) : (
        <form onSubmit={onLogin}>
          <label htmlFor="code">Código de demonstração</label>
          <input
            className="code-input"
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            placeholder="000000"
            autoFocus
            value={code}
            onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, ""))}
            disabled={busy}
          />
          <div className="demo-code">
            <span>Use o código local</span>
            <strong>123456</strong>
            <small>Nenhum e-mail é enviado.</small>
          </div>
          <button className="button primary full-width" type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Entrando…" : "Entrar na conta"}
            <Icon name="arrow" size={18}/>
          </button>
          <button className="text-button change-email" type="button" onClick={onChangeEmail}>Usar outro e-mail</button>
        </form>
      )}
      <p className="login-disclaimer"><Icon name="shield" size={16}/> Acesso demonstrativo. Não use dados pessoais ou credenciais reais.</p>
    </section>
  );
}

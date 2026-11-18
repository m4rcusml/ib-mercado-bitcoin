import { Icon } from "@/components/icon";

interface FlashMessagesProps {
  error: string;
  notice: string;
  onDismissError: () => void;
  onDismissNotice: () => void;
}

/** Mensagem de erro (alerta) e aviso de sucesso (região `aria-live`). */
export function FlashMessages({ error, notice, onDismissError, onDismissNotice }: FlashMessagesProps) {
  return (
    <>
      {error ? (
        <div className="message message-error" role="alert">
          <Icon name="info" size={18}/>
          <span>{error}</span>
          <button type="button" aria-label="Fechar mensagem de erro" onClick={onDismissError}><Icon name="close" size={16}/></button>
        </div>
      ) : null}
      <div aria-live="polite" aria-atomic="true">
        {notice ? (
          <div className="message message-success">
            <Icon name="check" size={18}/>
            <span>{notice}</span>
            <button type="button" aria-label="Fechar aviso" onClick={onDismissNotice}><Icon name="close" size={16}/></button>
          </div>
        ) : null}
      </div>
    </>
  );
}

import { Icon } from "@/components/icon";

/** Apresentação da jornada conta ↔ wallet exibida ao lado do formulário de acesso. */
export function LoginStory() {
  return (
    <section className="login-story">
      <span className="story-icon"><Icon name="transfer" size={30}/></span>
      <h1>Da conta à wallet.<br/>Uma jornada conectada.</h1>
      <p>Explore a ponte entre uma conta custodial e uma wallet pessoal em um ambiente feito para sua equipe desenvolver.</p>
      <div className="login-bridge">
        <div>
          <span className="bridge-endpoint"><Icon name="account" size={25}/></span>
          <strong>Conta MB</strong>
          <small>Custódia simulada</small>
        </div>
        <span className="bridge-connection">
          <span/>
          <Icon name="transfer" size={22}/>
          <span/>
        </span>
        <div>
          <span className="bridge-endpoint wallet-endpoint"><Icon name="wallet" size={25}/></span>
          <strong>Sua wallet</strong>
          <small>Autocustódia simulada</small>
        </div>
      </div>
      <div className="login-facts">
        <span><Icon name="check" size={15}/> Mock USDC nos dois sentidos</span>
        <span><Icon name="check" size={15}/> Saldos separados e reconciliados</span>
        <span><Icon name="check" size={15}/> Sem extensão, seed ou ativos reais</span>
      </div>
    </section>
  );
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ============================================================================
 *  MOCK USDC — SOMENTE TESTNET (Sepolia). NÃO É USDC. SEM VALOR ECONÔMICO.
 * ============================================================================
 *  Token ERC-20 mínimo usado pela PoC do MB Wallet Bridge. Qualquer pessoa com
 *  a chave do `owner` pode emitir saldo arbitrário; nunca implante em mainnet
 *  nem trate este token como ativo real.
 *
 *  Como implantar (sem nova dependência no projeto):
 *
 *  Opção A — Remix (https://remix.ethereum.org):
 *    1. Cole este arquivo, compile com solc 0.8.24+.
 *    2. Em "Deploy & Run", escolha "Injected Provider" (MetaMask na Sepolia).
 *    3. Faça o deploy; o owner será a conta conectada.
 *    4. Chame mint(TREASURY_ADDRESS, 1000000000) para 1.000 mUSDC (6 decimais).
 *    5. Copie o endereço para MOCK_USDC_ADDRESS em .env.local.
 *
 *  Opção B — Foundry (instalado fora do projeto):
 *    forge create contracts/MockUSDC.sol:MockUSDC \
 *      --rpc-url "$ALCHEMY_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
 *    cast send <TOKEN> "mint(address,uint256)" "$TREASURY_ADDRESS" 1000000000 \
 *      --rpc-url "$ALCHEMY_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
 *
 *  Depois, valide com `npm run diagnose:sepolia`.
 */
contract MockUSDC {
    string public constant name = "Mock USDC";
    string public constant symbol = "mUSDC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    address public immutable owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error NotOwner();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor() {
        owner = msg.sender;
    }

    /// @notice Emissão restrita ao owner. Apenas para financiar contas de teste.
    function mint(address to, uint256 value) external {
        if (msg.sender != owner) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

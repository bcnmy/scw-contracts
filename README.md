![Solidity](https://img.shields.io/badge/Solidity-0.8.17-blue.svg) ![Hardhat](https://img.shields.io/badge/Framework-Hardhat-brightgreen.svg) ![Foundry](https://img.shields.io/badge/Framework-Foundry-orange.svg) ![Test Coverage](https://img.shields.io/badge/Coverage-45%25-red.svg)

# Biconomy Smart Account: Leading Implementation of Account Abstraction 🌐

Biconomy Smart Account is a smart contract wallet focused on implementing Account Abstraction. It builds on the core concepts of Gnosis and Argent safes and is compliant with [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) and [ERC-6900](https://eips.ethereum.org/EIPS/eip-6900).

<p align="center"><img src="./assets/readme/biconomy-account-abstraction.png" width="550" alt="Biconomy Account Abstraction Banner"></p>

## 📜 Smart Contracts

- **BaseSmartAccount.sol**: An abstract contract implementing the EIP4337 IWallet interface.
- **Proxy.sol**: A lightweight proxy upgradeable through the UUPS pattern.
- **SmartAccountFactory.sol**: This factory contract manages the deployment of Smart Account (Account Abstraction).
- **SmartAccount.sol**: The primary implementation contract for a Smart Account (Account Abstraction).
- **EntryPoint.sol**: Implements the EIP4337 Entry Point contract.
- **StakeManager.sol**: A stake manager for wallet and paymaster deposits/stakes.
- **Executor.sol**: A helper contract facilitating calls and delegate calls to dapp contracts.
- **FallbackManager.sol**: Manages a fallback handler for delegate calls.
- **ModuleManager.sol**: Adopts the Gnosis Safe module manager pattern.
- **DefaultCallbackHandler.sol**: Handles hooks to respond to token receipts.
- **MultiSend.sol & MultiSendCallOnly.sol**: Facilitates batching multiple transactions into one.
- **VerifyingSingletonPaymaster.sol**: A paymaster that uses an external service for transaction validation.
- **PaymasterHelpers.sol**: A library essential for decoding paymaster data and context.

## 🛠️ Prerequisites

- Node.js
- Yarn or npm
- Hardhat

## 🚀 How to Run the Project

Before diving in, place a mnemonic in a `.secret` file at the root.
**Remember**: Never commit this file or share it publicly.

## Setup

**Setup**: Clone the repository and install dependencies.

   ```shell
   git clone https://github.com/bcnmy/scw-contracts.git
   cd scw-contracts
   npm install
   ```

**Configuration**: Create a `.secret` file at the root to store your mnemonic.
   **Note**: Never commit this file.
   `shell
    echo "your mnemonic here" > .secret
    `

### 🛠️ Development Commands

Below are the commands you can use for various tasks:

### 🧪 Testing

Run regular tests:

```shell
npx hardhat test
```

For Bundler Integration Tests, first install `realpath`:

```shell
brew install coreutils
```

Then, run the Bundler Integration Tests:

```shell
yarn bundler-test
```

### 📦 Compilation & Deployment

Compile contracts:

```shell
npx hardhat compile
```

Clean the environment:

```shell
npx hardhat clean
```

Start a local Ethereum node:

```shell
npx hardhat node
```

Deploy contracts:

```shell
npx hardhat run scripts/deploy.ts
TS_NODE_FILES=true npx ts-node scripts/deploy.ts
```

### 📈 Analysis & Reporting

Display available accounts:

```shell
npx hardhat accounts
```

Get help on Hardhat commands:

```shell
npx hardhat help
```

Test with gas report:

```shell
REPORT_GAS=true npx hardhat test
```

Generate code coverage report:

```shell
npx hardhat coverage
```

### 🧹 Code Quality & Formatting

Lint JavaScript and TypeScript files:

```shell
npx eslint '**/*.{js,ts}'
```

Automatically fix linting issues:

```shell
npx eslint '**/*.{js,ts}' --fix
```

Check formatting for JSON, Solidity, and Markdown files:

```shell
npx prettier '**/*.{json,sol,md}' --check
```

Automatically format files:

```shell
npx prettier '**/*.{json,sol,md}' --write
```

Lint Solidity contracts:

```shell
npx solhint 'contracts/**/*.sol'
```

Automatically fix issues in Solidity contracts:

```shell
npx solhint 'contracts/**/*.sol' --fix
```

---

This format separates the description from the command, making it clearer and more readable.

## 🔍 Etherscan Verification

To verify on Etherscan, deploy a contract to an Ethereum network supported by Etherscan, like Ropsten. Set up your `.env` file, deploy your contract, and then verify:

```shell
hardhat run --network goerli scripts/deploy.ts
npx hardhat verify --network goerli DEPLOYED_CONTRACT_ADDRESS "Hello, Hardhat!"
```

## ⚡ Performance Optimizations

Boost your tests and scripts' speed by setting the `TS_NODE_TRANSPILE_ONLY` environment variable to `1` in Hardhat's environment. More details are available in the [documentation](https://hardhat.org/guides/typescript.html#performance-optimizations).

---

## 🤝 Contributing

Biconomy Smart Account is an open-source project. Contributions are welcome. If you're interested in contributing, please check our [contribution guidelines](./CONTRIBUTING.md) and feel free to submit pull requests or raise issues.

## 📜 License

This project is licensed under the MIT License. See the [LICENSE.md](./LICENSE.md) file for details.
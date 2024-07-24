# MELD Lending & Borrowing Protocol

## Introduction

The MELD Lending & Borrowing Protocol is a decentralized finance (DeFi) platform that enables users to lend and borrow cryptocurrencies in a secure and efficient manner. Built on the principles of transparency and decentralization, the protocol leverages smart contracts to automate the process of lending and borrowing, ensuring trustless and permissionless interactions. MELD aims to provide users with a seamless experience, offering competitive interest rates, robust security measures, and a variety of supported assets. Whether you're a lender seeking to earn interest on your crypto holdings or a borrower looking for liquidity without selling your assets, the MELD protocol provides a comprehensive solution to meet your financial needs in the ever-evolving DeFi landscape.

## Installation

Run `npm install` or `yarn install` to install the dependencies.

## Configuration

The network configuration is in the `hardhat.config.ts` file. You can add or modify networks there. There is a `.sample.env` file that you can use as a template to create a `.env` file with the private keys of the accounts you want to interact with the different networks. You can also configure a different RPC URL for each network.

The protocol configuration is inside the `markets` folder. You can add or modify the markets there. Currently there is only one market, 'meld'. Inside it there is one folder for each environment: dev (for local development), kanazawa (for the Kanazawa testnet) and meld (for the MELD mainnet). The configuration for each environment consists of the following files:

- `index.ts`: The main configuration file. It contains general configuration of the protocol, as well as the supported token addresses, and information for the price oracles.
- `rateStrategies.ts`: The configuration for the rate strategies that are used in the protocol. This is used to determine the borrow rate slopes for variable and stable borrow rates.
- `reserveConfigs.ts`: The configuration for the reserves that are used in the protocol. This is used to determine the reserve factors, the LTV, the interest rate strategies, and the liquidation thresholds for each reserve, supply and borrow cap, determine if the yield boost is enabled, etc.

## Deployment

There are specific scripts to deploy the protocol to each network.

- `npx deploy:localhost` or `yarn deploy:localhost` to deploy the protocol to a local network. It also creates a file with the deployment info in `deployments/localhost/protocol.json`
- `npx deploy:kanazawa` or `yarn deploy:kanazawa` to deploy the protocol to the Kanazawa testnet. It also creates a file with the deployment info in `deployments/kanazawa/protocol.json`. It also verifies the contracts in the [Kanazawa explorer](https://testnet.meldscan.io/)
- `npx deploy:meld` or `yarn deploy:meld` to deploy the protocol to the MELD mainnet. It also creates a file with the deployment info in `deployments/meld/protocol.json`. It also verifies the contracts in the [MELD explorer](https://meldscan.io/)

The deployment scripts use the configuration in the `markets` folder to deploy the protocol with the specified configuration. Be sure to have the `.env` file with the private keys of the accounts you want to use to deploy the protocol.

Calling these scripts will export three filesin the folder `./deployments/<network>/Protocol/<datetime>/`:

- `addresses.json`: contains the address of the deployed contracts
- `deployment.json`: contains the deployment information such as network, chainId, commit hash, datetime and information of every contract (address, transaction hash, abi, args, abi)
- `supportedTokens.json`: contains the addresses of the supported tokens of the protocol, including the address of each token and the addresses of the cloned contracts (MToken, StableDebtToken, VariableDebtToken, YieldBoostStaking, YieldBoostStorage)

## Verify the contracts

The deployed contracts can be verified using the following scripts:

- `npx verify:kanazawa` or `yarn verify:kanazawa` to verify the contracts in the kanazawa testnet in the [Kanazawa explorer](https://testnet.meldscan.io/)
- `npx verify:meld` or `yarn verify:meld` to verify the contracts in the MELD mainnet in the [MELD explorer](https://meldscan.io/)

The verification scripts use the last deployment info in the `deployments` folder to verify the contracts. A specific deployment file can be verified by passing the path to the file as an argument to the script. Example:

```bash
yarn verify:kanazawa --deploymentfile ./deployments/kanazawa/Protocol/2024-05-23T15-02-35.727Z/deployment.json
```

## Other scripts

There are other scripts that can be used to interact with the protocol. In the `tasks/config.ts` file there are some tasks that can be used to interact with the protocol. These inlcude role management, get reserves and their configuration, and creating new reserves, as well as modifying their configuration.

## Overall architecture

The architecture of the smart contracts of the protocol is fairly complex and has the following main components that interact with each other:

### Addresses Provider

The Addresses Provider is a contract that stores the addresses of the main contracts of the protocol. The addresses can be updated, except some of them that are immutable.

The Addresses Provider also controls the Pausability of the protocol. From this contract, the protocol can be paused (and unpaused), preventing any interaction with the protocol.

This contract also manages the roles for the protocol, to control who can perform certain actions, using the AccessControlEnumberable from OpenZeppelin. Some of the roles are also immutable, so they can't be changed.

| Role                             | Description                                                                                                           | Immutable | Destroyable |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| `POOL_ADMIN_ROLE`                | Used for setting the configuration of the different reserves and protocol, as well as adding support for new reserves | ✘         | ✘           |
| `LENDING_POOL_CONFIGURATOR_ROLE` | Granted to the LendingPoolConfigurator contract                                                                       | ✔        | ✘           |
| `LENDING_POOL_ROLE`              | Granted to the LendingPool contract                                                                                   | ✔        | ✘           |
| `ORACLE_MANAGEMENT_ROLE`         | Used to manage the price oracle and rate oracle contracts                                                             | ✘         | ✔          |
| `BNKR_NFT_MINTER_BURNER_ROLE`    | Used to mint and burn MeldBanker NFTs                                                                                 | ✘         | ✔          |
| `YB_REWARDS_SETTER_ROLE`         | Used to set rewards in the YieldBoost contracts                                                                       | ✘         | ✘           |
| `GENIUS_LOAN_ROLE`               | Used to withdraw, borrow and claimed rewards using genius loan                                                        | ✘         | ✔          |
| `PAUSER_ROLE`                    | Used to pause the protocol                                                                                            | ✘         | ✔          |
| `UNPAUSER_ROLE`                  | Used to unpause the protocol                                                                                          | ✘         | ✔          |
| `DESTROYER_ROLE`                 | Used to destroy roles to prevent them being used anymore                                                              | ✘         | ✘           |

### Lending Pool

The Lending Pool is the main contract of the protocol. It is the one that users interact with to lend and borrow assets. It also contains some functions to configure the reserves. This is the list of user actions that can be performed in the Lending Pool:

- Deposit: Deposit an asset into the protocol to start earning interest.
- Withdraw: Withdraw an asset from the protocol.
- Borrow: Borrow an asset from the protocol.
- Repay: Repay a borrowed asset.
- Liquidate: Liquidate a position that is below the liquidation threshold.
- FlashLoan: Borrow a list of assets and repay them in the same transaction.
- Use reserve as collateral: The user can set a reserve as collateral to borrow more assets.
- Enable genius loan: The user can enable the genius loan to allow the protocol to borrow and repay assets on behalf of the user.

In order to not get over the contract size limit, most of the logic of the Lending Pool is implemented in libraries.

The LendingPool contract is upgradeable using UUPSUpgradeable from OpenZeppelin so its implementation is accessed through a proxy. Its implementation can be upgraded by the protocol administrators during the first 6 months after deployment. After that, the contract the upgradeability can be disabled and the contract can't be upgraded anymore.

### Tokens

There are several tokens that are created in the protocol, for each supported token (reserve).

- MTokens: These are the tokens that are minted when a user deposits an asset into the protocol. They represent the user's share of the pool. They can be transferred, and are burned when the user withdraws the asset.
- StableDebtTokens: These are the tokens that are minted when a user borrows an asset from the protocol with a stable rate. They represent the user's debt. They cannot be transferred and are burned when the user repays the debt.
- VariableDebtTokens: These are the tokens that are minted when a user borrows an asset from the protocol with a variable rate. They represent the user's debt. They cannot be transferred and are burned when the user repays the debt.

### Lending Pool Configurator

The LendingPoolConfigurator is a contract that is used to create the reserves, configure them and the protocol. This contract is no use for the users, only for the protocol administrators.

The LendingPoolConfigurator contract is upgradeable using UUPSUpgradeable from OpenZeppelin so its implementation is accessed through a proxy. Its implementation can be upgraded by the protocol administrators during the first 6 months after deployment. After that, the contract the upgradeability can be disabled and the contract can't be upgraded anymore.

### Data provider

The MeldProtocolDataProvider is a contract that is used to get the data of the protocol. The contract provides information about the reserves, the users, the configuration of the protocol, the addresses of the tokens, YieldBoost, etc.

### Yield boost

The yield boost is a novel mechanism for distributing extra yield to some assets in the protocol. It's an epoch-based distribution system that automatically tracks the balance of assets supplied and borrowed to give the rewards to the users.

The rewards distribution can be influenced by locking a Meld Banker NFT along with your position, giving you some boosts for the distribution of rewards. Only one NFT can be active by the same user at once

The yield comes from staking the assets bridged from other networks into the MELD network, and is distributed depending on the nature of the asset's yield.

### Oracles

Oracles are a key part of the protocol. They are used to have a source of truth for asset price and stable borrow rates.

Our system consists of an agregator for each type of asset (price and rate) that connect to the different providers to fetch the data, ensuring robustness and validity of the data used in the protocol.Each adapter of external protocols transforms the data of said oracle in a common format that gets returned into the main protocol when requested.

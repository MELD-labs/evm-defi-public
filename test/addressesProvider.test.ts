import { ethers } from "hardhat";
import { ZeroAddress, ZeroHash } from "ethers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  createTokensImplementations,
  deployContracts,
  deployLibraries,
  deployMockTokens,
  loadPoolConfigForEnv,
} from "./helpers/utils/utils";
import { IMeldConfiguration, ProtocolErrors } from "./helpers/types";
import { PoolConfiguration } from "./helpers/types";

import { expect } from "chai";

import { ADDRESSES_PROVIDER_IDS } from "./helpers/constants";

describe("AddressesProvider", function () {
  async function deployProtocolAndGetSignersFixture() {
    const [
      deployer,
      poolAdmin,
      oracleAdmin,
      pauser,
      unpauser,
      rando,
      bankerAdmin,
      roleDestroyer,
      geniusLoanExecutor,
    ] = await ethers.getSigners();

    // Get pool configuration values
    const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

    const { ReservesConfig } = poolConfig as IMeldConfiguration;

    const contracts = await deployContracts(
      false,
      ReservesConfig,
      deployer,
      poolAdmin,
      oracleAdmin,
      bankerAdmin,
      pauser,
      unpauser,
      roleDestroyer
    ); // addressesProviderSetters == false

    return {
      ...contracts,
      deployer,
      poolAdmin,
      oracleAdmin,
      pauser,
      unpauser,
      rando,
      roleDestroyer,
      geniusLoanExecutor,
    };
  }

  async function justAddressProviderFixture() {
    // Note: This fixture is needed because the MeldStakingStorage contract needs to be added
    // to the addresses provider in any case for the YieldBoostFactory to work. So this is a minimal fixture
    // that only deploys the addresses provider so the MeldStakingStorage contract can be added to it.
    const [deployer, rando] = await ethers.getSigners();

    const AddressesProvider =
      await ethers.getContractFactory("AddressesProvider");
    const addressesProvider = await AddressesProvider.deploy(deployer);

    return { addressesProvider, deployer, rando };
  }

  async function deployMinimalFixture() {
    const [deployer, rando] = await ethers.getSigners();

    // Have to deploy AddressesProvider separately to test the event because deployContracts calls setMeldBankerNFT. The LendingPool constructor requires the MeldBankerNFT address to be set.
    const AddressesProvider =
      await ethers.getContractFactory("AddressesProvider");
    const addressesProvider = await AddressesProvider.deploy(deployer);

    const {
      reserveLogic,
      validationLogic,
      genericLogic,
      liquidationLogic,
      borrowLogic,
      depositLogic,
      flashLoanLogic,
      withdrawLogic,
      repayLogic,
      yieldBoostLogic,
    } = await deployLibraries();

    const LendingPool = await ethers.getContractFactory("LendingPool", {
      libraries: {
        ReserveLogic: reserveLogic,
        ValidationLogic: validationLogic,
        GenericLogic: genericLogic,
        LiquidationLogic: liquidationLogic,
        BorrowLogic: borrowLogic,
        DepositLogic: depositLogic,
        FlashLoanLogic: flashLoanLogic,
        WithdrawLogic: withdrawLogic,
        RepayLogic: repayLogic,
        YieldBoostLogic: yieldBoostLogic,
      },
    });

    const lendingPool = await LendingPool.deploy();
    await lendingPool.initialize(addressesProvider);

    const LendingPoolConfigurator = await ethers.getContractFactory(
      "LendingPoolConfigurator"
    );
    const lendingPoolConfigurator = await LendingPoolConfigurator.deploy();

    const {
      mTokenImplAddress,
      stableDebtTokenImplAddress,
      variableDebtTokenImplAddress,
    } = await createTokensImplementations();
    await lendingPoolConfigurator.initialize(
      addressesProvider,
      lendingPool,
      mTokenImplAddress,
      stableDebtTokenImplAddress,
      variableDebtTokenImplAddress
    );

    return {
      addressesProvider,
      lendingPool,
      lendingPoolConfigurator,
      deployer,
      rando,
    };
  }

  async function meldBankerNftFixture() {
    const minFixtureVars = await deployMinimalFixture();

    await minFixtureVars.addressesProvider.setLendingPool(
      minFixtureVars.lendingPool
    );

    const MeldBankerNFT = await ethers.getContractFactory("MeldBankerNFT");
    const meldBankerNft = await MeldBankerNFT.deploy(
      minFixtureVars.addressesProvider
    );
    return {
      ...minFixtureVars,
      meldBankerNft,
    };
  }

  context("Roles", function () {
    context("Role IDs", function () {
      it("Should return the correct role IDs", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const roles = [
          "POOL_ADMIN_ROLE",
          "LENDING_POOL_CONFIGURATOR_ROLE",
          "LENDING_POOL_ROLE",
          "ORACLE_MANAGEMENT_ROLE",
          "BNKR_NFT_MINTER_BURNER_ROLE",
          "YB_REWARDS_SETTER_ROLE",
          "GENIUS_LOAN_ROLE",
          "PAUSER_ROLE",
          "UNPAUSER_ROLE",
          "DESTROYER_ROLE",
        ];

        for (const role of roles) {
          expect(await addressesProvider[role]()).to.be.equal(
            ethers.keccak256(ethers.toUtf8Bytes(role))
          );
        }
        expect(await addressesProvider.PRIMARY_ADMIN_ROLE()).to.be.equal(
          ethers.ZeroHash
        );
        expect(await addressesProvider.DEFAULT_ADMIN_ROLE()).to.be.equal(
          ethers.ZeroHash
        );
      });
    }); // End of Role IDs
    context("Roles management", function () {
      context("Happy Flow Test Cases", function () {
        it("Should grant and revoke roles correctly", async function () {
          const { addressesProvider, rando } = await loadFixture(
            deployProtocolAndGetSignersFixture
          );

          const roles = [
            await addressesProvider.POOL_ADMIN_ROLE(),
            await addressesProvider.ORACLE_MANAGEMENT_ROLE(),
            await addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE(),
            await addressesProvider.YB_REWARDS_SETTER_ROLE(),
            await addressesProvider.GENIUS_LOAN_ROLE(),
            await addressesProvider.PAUSER_ROLE(),
            await addressesProvider.UNPAUSER_ROLE(),
            await addressesProvider.DESTROYER_ROLE(),
          ];

          // Omitting LENDING_POOL_CONFIGURATOR_ROLE and LENDING_POOL_ROLE

          for (const role of roles) {
            await addressesProvider.grantRole(role, rando.address);
            expect(await addressesProvider.hasRole(role, rando.address)).to.be
              .true;

            await addressesProvider.revokeRole(role, rando.address);
            expect(await addressesProvider.hasRole(role, rando.address)).to.be
              .false;
          }
        });
      }); // End of Roles management Happy Flow Test Cases

      context("Error Test Cases", function () {
        it("Should revert if the caller is not the primary admin", async function () {
          const { addressesProvider, rando } = await loadFixture(
            deployProtocolAndGetSignersFixture
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

          await expect(
            addressesProvider
              .connect(rando)
              .grantRole(
                await addressesProvider.POOL_ADMIN_ROLE(),
                rando.address
              )
          ).to.revertedWith(expectedException);

          await expect(
            addressesProvider
              .connect(rando)
              .revokeRole(
                await addressesProvider.POOL_ADMIN_ROLE(),
                rando.address
              )
          ).to.revertedWith(expectedException);
        });

        it("Should revert if the account is the zero address", async function () {
          const { addressesProvider } = await loadFixture(
            deployProtocolAndGetSignersFixture
          );

          await expect(
            addressesProvider.grantRole(
              await addressesProvider.GENIUS_LOAN_ROLE(),
              ZeroAddress
            )
          ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });

        it("Should revert if the role is immutable", async function () {
          const { addressesProvider, deployer } = await loadFixture(
            deployProtocolAndGetSignersFixture
          );

          await expect(
            addressesProvider.grantRole(
              await addressesProvider.LENDING_POOL_ROLE(),
              deployer.address
            )
          ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ROLE);

          await expect(
            addressesProvider.revokeRole(
              await addressesProvider.LENDING_POOL_ROLE(),
              deployer.address
            )
          ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ROLE);

          await expect(
            addressesProvider.grantRole(
              await addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE(),
              deployer.address
            )
          ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ROLE);

          await expect(
            addressesProvider.revokeRole(
              await addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE(),
              deployer.address
            )
          ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ROLE);
        });

        it("Should revert if the last admin is removed", async function () {
          const { addressesProvider, deployer } = await loadFixture(
            deployProtocolAndGetSignersFixture
          );

          await expect(
            addressesProvider.revokeRole(
              await addressesProvider.PRIMARY_ADMIN_ROLE(),
              deployer.address
            )
          ).to.revertedWith(ProtocolErrors.AP_CANNOT_REMOVE_LAST_ADMIN);

          await expect(
            addressesProvider.renounceRole(
              await addressesProvider.PRIMARY_ADMIN_ROLE(),
              deployer.address
            )
          ).to.revertedWith(ProtocolErrors.AP_CANNOT_REMOVE_LAST_ADMIN);
        });
      }); // End of Roles management Error Test Cases
    }); // End of Roles management
  }); // End of Roles

  context("setAddressForId()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when address is first set", async function () {
        const { meldProtocolDataProvider, addressesProvider, deployer } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PROTOCOL_DATA_PROVIDER
        );

        await expect(
          addressesProvider.setAddressForId(
            id,
            await meldProtocolDataProvider.getAddress()
          )
        )
          .to.emit(addressesProvider, "AddressSet")
          .withArgs(
            deployer.address,
            id,
            ZeroAddress,
            await meldProtocolDataProvider.getAddress()
          );
      });

      it("Should emit the correct event when new address is set", async function () {
        const { priceOracleAggregator, addressesProvider, deployer, rando } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PRICE_ORACLE
        );

        await addressesProvider.setAddressForId(
          id,
          await priceOracleAggregator.getAddress()
        );

        await expect(
          addressesProvider.setAddressForId(id, await rando.getAddress())
        )
          .to.emit(addressesProvider, "AddressSet")
          .withArgs(
            deployer.address,
            id,
            await priceOracleAggregator.getAddress(),
            await rando.getAddress()
          );
      });

      it("Should update state correctly", async function () {
        const { meldProtocolDataProvider, addressesProvider } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PROTOCOL_DATA_PROVIDER
        );
        await addressesProvider.setAddressForId(
          id,
          await meldProtocolDataProvider.getAddress()
        );

        expect(await addressesProvider.getAddressForId(id)).to.be.equal(
          await meldProtocolDataProvider.getAddress()
        );
      });
    }); // End of setAddressForId() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if id is empty bytes", async function () {
        const { lendingPool, addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider.setAddressForId(
            ZeroHash,
            await lendingPool.getAddress()
          )
        ).to.revertedWith(ProtocolErrors.AP_INVALID_ADDRESS_ID);
      });

      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PROTOCOL_DATA_PROVIDER
        );
        await expect(
          addressesProvider.setAddressForId(id, ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, lendingPool, rando } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL
        );
        await expect(
          addressesProvider
            .connect(rando)
            .setAddressForId(id, await lendingPool.getAddress())
        ).to.revertedWith(expectedException);
      });
    }); // End of setAddressForId() Error Test Cases
  }); // End of setAddressForId()

  context("getAddress()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const {
          meldProtocolDataProvider,
          lendingPoolConfigurator,
          addressesProvider,
        } = await loadFixture(deployProtocolAndGetSignersFixture);

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PROTOCOL_DATA_PROVIDER
        );

        const id2 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL_CONFIGURATOR
        );

        await addressesProvider.setAddressForId(
          id1,
          await meldProtocolDataProvider.getAddress()
        );
        await addressesProvider.setAddressForId(
          id2,
          await lendingPoolConfigurator.getAddress()
        );

        expect(await addressesProvider.getAddressForId(id1)).to.be.equal(
          await meldProtocolDataProvider.getAddress()
        );
      });

      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PROTOCOL_DATA_PROVIDER
        );

        expect(await addressesProvider.getAddressForId(id)).to.be.equal(
          ZeroAddress
        );
      });
    }); // End of getAddress() Happy Flow Test Cases
  }); // End of getAddress()

  context("setLendingPool()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when LendingPool address is first set", async function () {
        const { lendingPool, addressesProvider, deployer } =
          await loadFixture(deployMinimalFixture);

        await expect(
          addressesProvider.setLendingPool(await lendingPool.getAddress())
        )
          .to.emit(addressesProvider, "LendingPoolUpdated")
          .withArgs(
            deployer.address,
            ZeroAddress,
            await lendingPool.getAddress()
          );
      });

      it("Should update state correctly", async function () {
        const { lendingPool, addressesProvider } =
          await loadFixture(deployMinimalFixture);

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL
        );

        await addressesProvider.setLendingPool(await lendingPool.getAddress());

        expect(await addressesProvider.getAddressForId(id)).to.be.equal(
          await lendingPool.getAddress()
        );
      });

      it("Should grant LENDING_POOL_ROLE to lending pool", async function () {
        const { lendingPool, addressesProvider } =
          await loadFixture(deployMinimalFixture);

        await addressesProvider.setLendingPool(await lendingPool.getAddress());

        expect(
          await addressesProvider.hasRole(
            await addressesProvider.LENDING_POOL_ROLE(),
            await lendingPool.getAddress()
          )
        ).to.be.true;
      });
    }); // End of setLendingPool() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(deployMinimalFixture);

        await expect(
          addressesProvider.setLendingPool(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, lendingPool, rando } =
          await loadFixture(deployMinimalFixture);

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider
            .connect(rando)
            .setLendingPool(await lendingPool.getAddress())
        ).to.revertedWith(expectedException);
      });
    }); // End of setLendingPool() Error Test Cases
  }); // End of setLendingPool()

  context("getLendingPool()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const { lendingPool, lendingPoolConfigurator, addressesProvider } =
          await loadFixture(deployMinimalFixture);

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL
        );

        const id2 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL_CONFIGURATOR
        );

        await addressesProvider.setAddressForId(
          id1,
          await lendingPool.getAddress()
        );
        await addressesProvider.setAddressForId(
          id2,
          await lendingPoolConfigurator.getAddress()
        );

        expect(await addressesProvider.getLendingPool()).to.be.equal(
          await lendingPool.getAddress()
        );
      });

      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(deployMinimalFixture);

        expect(await addressesProvider.getLendingPool()).to.be.equal(
          ZeroAddress
        );
      });

      it("Should revert if the address is already set", async function () {
        const { lendingPool, addressesProvider } =
          await loadFixture(deployMinimalFixture);

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL
        );

        await addressesProvider.setAddressForId(
          id,
          await lendingPool.getAddress()
        );

        await expect(
          addressesProvider.setLendingPool(await lendingPool.getAddress())
        ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ADDRESS);
      });
    }); // End of getLendingPool() Happy Flow Test Cases
  }); // End of getLendingPool()

  context("setLendingPoolConfigurator()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when LendingPoolConfigurator address is first set", async function () {
        const { lendingPoolConfigurator, addressesProvider, deployer } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        await expect(
          addressesProvider.setLendingPoolConfigurator(
            await lendingPoolConfigurator.getAddress()
          )
        )
          .to.emit(addressesProvider, "LendingPoolConfiguratorUpdated")
          .withArgs(
            deployer.address,
            ZeroAddress,
            await lendingPoolConfigurator.getAddress()
          );
      });

      it("Should update state correctly", async function () {
        const { lendingPoolConfigurator, addressesProvider } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL_CONFIGURATOR
        );

        await addressesProvider.setLendingPoolConfigurator(
          await lendingPoolConfigurator.getAddress()
        );

        expect(await addressesProvider.getAddressForId(id)).to.be.equal(
          await lendingPoolConfigurator.getAddress()
        );
      });

      it("Should grant LENDING_POOL_CONFIGURATOR_ROLE to lending pool configurator", async function () {
        const { lendingPoolConfigurator, addressesProvider } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        await addressesProvider.setLendingPoolConfigurator(
          await lendingPoolConfigurator.getAddress()
        );

        expect(
          await addressesProvider.hasRole(
            await addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE(),
            await lendingPoolConfigurator.getAddress()
          )
        ).to.be.true;
      });
    }); // End of setLendingPoolConfigurator() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider.setLendingPoolConfigurator(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, lendingPoolConfigurator, rando } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider
            .connect(rando)
            .setLendingPoolConfigurator(
              await lendingPoolConfigurator.getAddress()
            )
        ).to.revertedWith(expectedException);
      });

      it("Should revert if the address is already set", async function () {
        const { lendingPoolConfigurator, addressesProvider } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL_CONFIGURATOR
        );

        await addressesProvider.setAddressForId(
          id,
          await lendingPoolConfigurator.getAddress()
        );

        await expect(
          addressesProvider.setLendingPoolConfigurator(
            await lendingPoolConfigurator.getAddress()
          )
        ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ADDRESS);
      });
    }); // End of setLendingPoolConfigurator() Error Test Cases
  }); // End of setLendingPoolConfigurator()

  context("getLendingPoolConfigurator()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const { lendingPool, lendingPoolConfigurator, addressesProvider } =
          await loadFixture(deployMinimalFixture);

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL
        );

        const id2 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL_CONFIGURATOR
        );

        await addressesProvider.setAddressForId(
          id1,
          await lendingPool.getAddress()
        );
        await addressesProvider.setAddressForId(
          id2,
          await lendingPoolConfigurator.getAddress()
        );

        expect(
          await addressesProvider.getLendingPoolConfigurator()
        ).to.be.equal(await lendingPoolConfigurator.getAddress());
      });

      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        expect(
          await addressesProvider.getLendingPoolConfigurator()
        ).to.be.equal(ZeroAddress);
      });
    }); // End of getLendingPoolConfigurator() Happy Flow Test Cases
  }); // End of getLendingPoolConfigurator()

  context("setProtocolDataProvider()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when ProtocolDataProvider address is first set", async function () {
        const { meldProtocolDataProvider, addressesProvider, deployer } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        await expect(
          addressesProvider.setProtocolDataProvider(
            await meldProtocolDataProvider.getAddress()
          )
        )
          .to.emit(addressesProvider, "ProtocolDataProviderUpdated")
          .withArgs(
            deployer.address,
            ZeroAddress,
            await meldProtocolDataProvider.getAddress()
          );
      });

      it("Should emit the correct event when new ProtocolDataProvider address is set", async function () {
        const { meldProtocolDataProvider, addressesProvider, deployer, rando } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        await addressesProvider.setProtocolDataProvider(
          await meldProtocolDataProvider.getAddress()
        );

        await expect(
          addressesProvider.setProtocolDataProvider(await rando.getAddress())
        )
          .to.emit(addressesProvider, "ProtocolDataProviderUpdated")
          .withArgs(
            deployer.address,
            await meldProtocolDataProvider.getAddress(),
            await rando.getAddress()
          );
      });

      it("Should update state correctly", async function () {
        const { meldProtocolDataProvider, addressesProvider } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PROTOCOL_DATA_PROVIDER
        );

        await addressesProvider.setProtocolDataProvider(
          await meldProtocolDataProvider.getAddress()
        );

        expect(await addressesProvider.getAddressForId(id)).to.be.equal(
          await meldProtocolDataProvider.getAddress()
        );
      });
    }); // End of setProtocolDataProvider() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider.setProtocolDataProvider(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, meldProtocolDataProvider, rando } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider
            .connect(rando)
            .setProtocolDataProvider(
              await meldProtocolDataProvider.getAddress()
            )
        ).to.revertedWith(expectedException);
      });
    }); // End of setProtocolDataProvider() Error Test Cases
  }); // End of setProtocolDataProvider()

  context("getProtocolDataProvider()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const {
          lendingPoolConfigurator,
          meldProtocolDataProvider,
          addressesProvider,
        } = await loadFixture(deployProtocolAndGetSignersFixture);

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL_CONFIGURATOR
        );

        const id2 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PROTOCOL_DATA_PROVIDER
        );

        await addressesProvider.setAddressForId(
          id1,
          await lendingPoolConfigurator.getAddress()
        );
        await addressesProvider.setAddressForId(
          id2,
          await meldProtocolDataProvider.getAddress()
        );

        expect(await addressesProvider.getProtocolDataProvider()).to.be.equal(
          await meldProtocolDataProvider.getAddress()
        );
      });

      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        expect(await addressesProvider.getProtocolDataProvider()).to.be.equal(
          ZeroAddress
        );
      });
    }); // End of getProtocolDataProvider() Happy Flow Test Cases
  }); // End of getProtocolDataProvider()

  context("setPriceOracle()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when PriceOracle address is first set", async function () {
        const { priceOracleAggregator, addressesProvider, deployer } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        await expect(
          addressesProvider.setPriceOracle(
            await priceOracleAggregator.getAddress()
          )
        )
          .to.emit(addressesProvider, "PriceOracleUpdated")
          .withArgs(
            deployer.address,
            ZeroAddress,
            await priceOracleAggregator.getAddress()
          );
      });

      it("Should emit the correct event when new PriceOracle address is set", async function () {
        const { priceOracleAggregator, addressesProvider, deployer, rando } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        await addressesProvider.setPriceOracle(
          await priceOracleAggregator.getAddress()
        );

        await expect(addressesProvider.setPriceOracle(await rando.getAddress()))
          .to.emit(addressesProvider, "PriceOracleUpdated")
          .withArgs(
            deployer.address,
            await priceOracleAggregator.getAddress(),
            await rando.getAddress()
          );
      });

      it("Should update state correctly", async function () {
        const { priceOracleAggregator, addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PRICE_ORACLE
        );

        await addressesProvider.setPriceOracle(
          await priceOracleAggregator.getAddress()
        );

        expect(await addressesProvider.getAddressForId(id)).to.be.equal(
          await priceOracleAggregator.getAddress()
        );
      });
    }); // End of setPriceOracle() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider.setPriceOracle(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, priceOracleAggregator, rando } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider
            .connect(rando)
            .setPriceOracle(await priceOracleAggregator.getAddress())
        ).to.revertedWith(expectedException);
      });
    }); // End of setPriceOracle() Error Test Cases
  }); // End of setPriceOracle()

  context("getPriceOracle()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const {
          lendingPoolConfigurator,
          priceOracleAggregator,
          addressesProvider,
        } = await loadFixture(deployProtocolAndGetSignersFixture);

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL_CONFIGURATOR
        );

        const id2 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.PRICE_ORACLE
        );

        await addressesProvider.setAddressForId(
          id1,
          await lendingPoolConfigurator.getAddress()
        );
        await addressesProvider.setAddressForId(
          id2,
          await priceOracleAggregator.getAddress()
        );

        expect(await addressesProvider.getPriceOracle()).to.be.equal(
          await priceOracleAggregator.getAddress()
        );
      });

      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        expect(await addressesProvider.getPriceOracle()).to.be.equal(
          ZeroAddress
        );
      });
    }); // End of getPriceOracle() Happy Flow Test Cases
  }); // End of getPriceOracle()

  context("setLendingRateOracle()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event ", async function () {
        const { lendingRateOracleAggregator, addressesProvider, deployer } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        await expect(
          addressesProvider
            .connect(deployer)
            .setLendingRateOracle(
              await lendingRateOracleAggregator.getAddress()
            )
        )
          .to.emit(addressesProvider, "LendingRateOracleUpdated")
          .withArgs(
            deployer.address,
            ZeroAddress,
            await lendingRateOracleAggregator.getAddress()
          );
      });

      it("Should emit the correct event when new LendingRateOracle address is set", async function () {
        const {
          lendingRateOracleAggregator,
          addressesProvider,
          deployer,
          rando,
        } = await loadFixture(deployProtocolAndGetSignersFixture);

        await addressesProvider.setLendingRateOracle(
          await lendingRateOracleAggregator.getAddress()
        );

        await expect(
          addressesProvider.setLendingRateOracle(await rando.getAddress())
        )
          .to.emit(addressesProvider, "LendingRateOracleUpdated")
          .withArgs(
            deployer.address,
            await lendingRateOracleAggregator.getAddress(),
            await rando.getAddress()
          );
      });

      it("Should update state correctly", async function () {
        const { lendingRateOracleAggregator, addressesProvider } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const id = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_RATE_ORACLE
        );

        await addressesProvider.setLendingRateOracle(
          await lendingRateOracleAggregator.getAddress()
        );

        expect(await addressesProvider.getAddressForId(id)).to.be.equal(
          await lendingRateOracleAggregator.getAddress()
        );
      });
    }); // End of setLendingRateOracle() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider.setLendingRateOracle(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, lendingRateOracleAggregator, rando } =
          await loadFixture(deployProtocolAndGetSignersFixture);

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider
            .connect(rando)
            .setLendingRateOracle(
              await lendingRateOracleAggregator.getAddress()
            )
        ).to.revertedWith(expectedException);
      });
    }); // End of setLendingRateOracle() Error Test Cases
  }); // End of setLendingRateOracle()

  context("getLendingRateOracle()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const {
          lendingPoolConfigurator,
          lendingRateOracleAggregator,
          addressesProvider,
        } = await loadFixture(deployProtocolAndGetSignersFixture);

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_POOL_CONFIGURATOR
        );

        const id2 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.LENDING_RATE_ORACLE
        );

        await addressesProvider.setAddressForId(
          id1,
          await lendingPoolConfigurator.getAddress()
        );
        await addressesProvider.setAddressForId(
          id2,
          await lendingRateOracleAggregator.getAddress()
        );

        expect(await addressesProvider.getLendingRateOracle()).to.be.equal(
          await lendingRateOracleAggregator.getAddress()
        );
      });

      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        expect(await addressesProvider.getLendingRateOracle()).to.be.equal(
          ZeroAddress
        );
      });
    }); // End of getLendingRateOracle() Happy Flow Test Cases
  }); // End of getLendingRateOracle()

  context("setMeldBankerNFT()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when MeldBankerNFT address is first set", async function () {
        const { addressesProvider, deployer, meldBankerNft } =
          await loadFixture(meldBankerNftFixture);

        await expect(addressesProvider.setMeldBankerNFT(meldBankerNft))
          .to.emit(addressesProvider, "MeldBankerNFTUpdated")
          .withArgs(
            deployer.address,
            ZeroAddress,
            await meldBankerNft.getAddress()
          );
      });

      it("Should update state correctly", async function () {
        const { addressesProvider, meldBankerNft } =
          await loadFixture(meldBankerNftFixture);

        await addressesProvider.setMeldBankerNFT(meldBankerNft);

        expect(await addressesProvider.getMeldBankerNFT()).to.be.equal(
          await meldBankerNft.getAddress()
        );
      });
    }); // End of setMeldBankerNFT() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(meldBankerNftFixture);

        await expect(
          addressesProvider.setMeldBankerNFT(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, rando } =
          await loadFixture(meldBankerNftFixture);

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider.connect(rando).setMeldBankerNFT(rando.address)
        ).to.revertedWith(expectedException);
      });

      it("Should revert if the address is already set", async function () {
        const { addressesProvider, deployer } =
          await loadFixture(meldBankerNftFixture);

        await addressesProvider.setMeldBankerNFT(deployer.address);

        await expect(
          addressesProvider.setMeldBankerNFT(deployer.address)
        ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ADDRESS);
      });
    }); // End of setMeldBankerNFT() Error Test Cases
  }); // End of setMeldBankerNFT()

  context("getMeldBankerNFT()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const { addressesProvider, meldBankerNft } =
          await loadFixture(meldBankerNftFixture);

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.MELD_BANKER_NFT
        );

        await addressesProvider.setAddressForId(id1, meldBankerNft);

        expect(await addressesProvider.getMeldBankerNFT()).to.be.equal(
          await meldBankerNft.getAddress()
        );
      });
      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(meldBankerNftFixture);

        expect(await addressesProvider.getMeldBankerNFT()).to.be.equal(
          ZeroAddress
        );
      });
    }); // End of getMeldBankerNFT() Happy Flow Test Cases
  }); // End of getMeldBankerNFT()

  context("setMeldBankerNFTMinter()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when MeldBankerNFTMinter address is first set", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(addressesProvider.setMeldBankerNFTMinter(deployer.address))
          .to.emit(addressesProvider, "MeldBankerNFTMinterUpdated")
          .withArgs(deployer.address, ZeroAddress, deployer.address);
      });

      it("Should emit the correct event when new MeldBankerNFTMinter address is set", async function () {
        const { addressesProvider, deployer, rando } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await addressesProvider.setMeldBankerNFTMinter(deployer.address);

        await expect(addressesProvider.setMeldBankerNFTMinter(rando.address))
          .to.emit(addressesProvider, "MeldBankerNFTMinterUpdated")
          .withArgs(deployer.address, deployer.address, rando.address);
      });

      it("Should update state correctly", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await addressesProvider.setMeldBankerNFTMinter(deployer.address);

        expect(await addressesProvider.getMeldBankerNFTMinter()).to.be.equal(
          deployer.address
        );
      });
    }); // End of setMeldBankerNFTMinter() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider.setMeldBankerNFTMinter(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, rando } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider.connect(rando).setMeldBankerNFTMinter(rando.address)
        ).to.revertedWith(expectedException);
      });
    }); // End of setMeldBankerNFTMinter() Error Test Cases
  }); // End of setMeldBankerNFTMinter()

  context("getMeldBankerNFTMinter()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const { addressesProvider, meldBankerNftMinter } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.MELD_BANKER_NFT_MINTER
        );

        await addressesProvider.setAddressForId(id1, meldBankerNftMinter);

        expect(await addressesProvider.getMeldBankerNFTMinter()).to.be.equal(
          await meldBankerNftMinter.getAddress()
        );
      });
      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        expect(await addressesProvider.getMeldBankerNFTMinter()).to.be.equal(
          ZeroAddress
        );
      });
    }); // End of getMeldBankerNFTMinter() Happy Flow Test Cases
  }); // End of getMeldBankerNFTMinter()

  context("setYieldBoostFactory()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when YieldBoostFactory address is first set", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(addressesProvider.setYieldBoostFactory(deployer.address))
          .to.emit(addressesProvider, "YieldBoostFactoryUpdated")
          .withArgs(deployer.address, ZeroAddress, deployer.address);
      });

      it("Should update state correctly", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await addressesProvider.setYieldBoostFactory(deployer.address);

        expect(await addressesProvider.getYieldBoostFactory()).to.be.equal(
          deployer.address
        );
      });
    }); // End of setYieldBoostFactory() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider.setYieldBoostFactory(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, rando } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider.connect(rando).setYieldBoostFactory(rando.address)
        ).to.revertedWith(expectedException);
      });
      it("Should revert if the address is already set", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await addressesProvider.setYieldBoostFactory(deployer.address);

        await expect(
          addressesProvider.setYieldBoostFactory(deployer.address)
        ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ADDRESS);
      });
    }); // End of setYieldBoostFactory() Error Test Cases
  }); // End of setYieldBoostFactory()

  context("getYieldBoostFactory()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const { addressesProvider, yieldBoostFactory } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.YIELD_BOOST_FACTORY
        );

        await addressesProvider.setAddressForId(id1, yieldBoostFactory);

        expect(await addressesProvider.getYieldBoostFactory()).to.be.equal(
          await yieldBoostFactory.getAddress()
        );
      });
      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        expect(await addressesProvider.getYieldBoostFactory()).to.be.equal(
          ZeroAddress
        );
      });
    }); // End of getYieldBoostFactory() Happy Flow Test Cases
  }); // End of getYieldBoostFactory()

  context("setMeldToken()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when MeldToken address is first set", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(addressesProvider.setMeldToken(deployer.address))
          .to.emit(addressesProvider, "MeldTokenUpdated")
          .withArgs(deployer.address, ZeroAddress, deployer.address);
      });

      it("Should update state correctly", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await addressesProvider.setMeldToken(deployer.address);

        expect(await addressesProvider.getMeldToken()).to.be.equal(
          deployer.address
        );
      });
    }); // End of setMeldToken() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider.setMeldToken(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, rando } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider.connect(rando).setMeldToken(rando.address)
        ).to.revertedWith(expectedException);
      });
      it("Should revert if the address is already set", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await addressesProvider.setMeldToken(deployer.address);

        await expect(
          addressesProvider.setMeldToken(deployer.address)
        ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ADDRESS);
      });
    }); // End of setMeldToken() Error Test Cases
  }); // End of setMeldToken()

  context("getMeldToken()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const { meld } = await deployMockTokens();

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.MELD_TOKEN
        );

        await addressesProvider.setAddressForId(id1, meld);

        expect(await addressesProvider.getMeldToken()).to.be.equal(
          await meld.getAddress()
        );
      });
      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        expect(await addressesProvider.getMeldToken()).to.be.equal(ZeroAddress);
      });
    }); // End of getMeldToken() Happy Flow Test Cases
  }); // End of getMeldToken()

  context("setMeldStakingStorage()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when MeldToken address is first set", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          justAddressProviderFixture
        );

        await expect(addressesProvider.setMeldStakingStorage(deployer.address))
          .to.emit(addressesProvider, "MeldStakingStorageUpdated")
          .withArgs(deployer.address, ZeroAddress, deployer.address);
      });

      it("Should update state correctly", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          justAddressProviderFixture
        );

        await addressesProvider.setMeldStakingStorage(deployer.address);

        expect(await addressesProvider.getMeldStakingStorage()).to.be.equal(
          deployer.address
        );
      });
    }); // End of setMeldStakingStorage() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if address is the zero address", async function () {
        const { addressesProvider } = await loadFixture(
          justAddressProviderFixture
        );

        await expect(
          addressesProvider.setMeldStakingStorage(ZeroAddress)
        ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, rando } = await loadFixture(
          justAddressProviderFixture
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider.connect(rando).setMeldStakingStorage(rando.address)
        ).to.revertedWith(expectedException);
      });
      it("Should revert if the address is already set", async function () {
        const { addressesProvider, deployer } = await loadFixture(
          justAddressProviderFixture
        );

        await addressesProvider.setMeldStakingStorage(deployer.address);

        await expect(
          addressesProvider.setMeldStakingStorage(deployer.address)
        ).to.revertedWith(ProtocolErrors.AP_CANNOT_UPDATE_ADDRESS);
      });
    }); // End of setMeldStakingStorage() Error Test Cases
  }); // End of setMeldStakingStorage()

  context("getMeldStakingStorage()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should return the correct address", async function () {
        const { addressesProvider, rando } = await loadFixture(
          justAddressProviderFixture
        );

        const id1 = ethers.encodeBytes32String(
          ADDRESSES_PROVIDER_IDS.MELD_STAKING_STORAGE
        );

        await addressesProvider.setAddressForId(id1, rando);

        expect(await addressesProvider.getMeldStakingStorage()).to.be.equal(
          rando.address
        );
      });
      it("Should return the zero address if the address is not set", async function () {
        const { addressesProvider } = await loadFixture(
          justAddressProviderFixture
        );

        expect(await addressesProvider.getMeldStakingStorage()).to.be.equal(
          ZeroAddress
        );
      });
    }); // End of getMeldStakingStorage() Happy Flow Test Cases
  }); // End of getMeldStakingStorage()

  context("destroyRole()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when a role is destroyed", async function () {
        const { addressesProvider, roleDestroyer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        // No one has  GENIUS_LOAN_ROLE role

        const tx = addressesProvider
          .connect(roleDestroyer)
          .destroyRole(await addressesProvider.GENIUS_LOAN_ROLE());

        await expect(tx)
          .to.emit(addressesProvider, "RoleDestroyed")
          .withArgs(
            roleDestroyer.address,
            await addressesProvider.GENIUS_LOAN_ROLE()
          );

        await expect(tx)
          .to.emit(addressesProvider, "RoleAdminChanged")
          .withArgs(
            await addressesProvider.GENIUS_LOAN_ROLE(),
            await addressesProvider.PRIMARY_ADMIN_ROLE(),
            "0x0000000000000000000000000000000000000000000000000000000000000001"
          );
      });

      it("Should update state correctly", async function () {
        const { addressesProvider, roleDestroyer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        // No one has  GENIUS_LOAN_ROLE role

        expect(
          await addressesProvider.isDestroyedRole(
            await addressesProvider.GENIUS_LOAN_ROLE()
          )
        ).to.be.false;

        await addressesProvider
          .connect(roleDestroyer)
          .destroyRole(await addressesProvider.GENIUS_LOAN_ROLE());

        expect(
          await addressesProvider.isDestroyedRole(
            await addressesProvider.GENIUS_LOAN_ROLE()
          )
        ).to.be.true;

        expect(
          await addressesProvider.getRoleAdmin(
            await addressesProvider.GENIUS_LOAN_ROLE()
          )
        ).to.be.equal(
          "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
      });
    }); // End of destroyRole() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, rando } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.DESTROYER_ROLE()}`;

        await expect(
          addressesProvider
            .connect(rando)
            .destroyRole(await addressesProvider.GENIUS_LOAN_ROLE())
        ).to.revertedWith(expectedException);
      });
      it("Should revert if the role is already destroyed", async function () {
        const { addressesProvider, roleDestroyer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await addressesProvider
          .connect(roleDestroyer)
          .destroyRole(await addressesProvider.GENIUS_LOAN_ROLE());

        await expect(
          addressesProvider
            .connect(roleDestroyer)
            .destroyRole(await addressesProvider.GENIUS_LOAN_ROLE())
        ).to.revertedWith(ProtocolErrors.AP_ROLE_ALREADY_DESTROYED);
      });

      it("Should revert if the role is not destroyable", async function () {
        const { addressesProvider, roleDestroyer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider
            .connect(roleDestroyer)
            .destroyRole(await addressesProvider.DEFAULT_ADMIN_ROLE())
        ).to.revertedWith(ProtocolErrors.AP_ROLE_NOT_DESTROYABLE);

        await expect(
          addressesProvider
            .connect(roleDestroyer)
            .destroyRole(await addressesProvider.PRIMARY_ADMIN_ROLE())
        ).to.revertedWith(ProtocolErrors.AP_ROLE_NOT_DESTROYABLE);
      });

      it("Should revert if the role still has members", async function () {
        const {
          addressesProvider,
          roleDestroyer,
          deployer,
          geniusLoanExecutor,
        } = await loadFixture(deployProtocolAndGetSignersFixture);

        // Give geniusLoanExecutor the GENIUS_LOAN_ROLE role
        await addressesProvider
          .connect(deployer)
          .grantRole(
            await addressesProvider.GENIUS_LOAN_ROLE(),
            geniusLoanExecutor.address
          );

        await expect(
          addressesProvider
            .connect(roleDestroyer)
            .destroyRole(await addressesProvider.GENIUS_LOAN_ROLE())
        ).to.revertedWith(ProtocolErrors.AP_ROLE_HAS_MEMBERS);
      });
    }); // End of destroyRole() Error Test Cases
  }); // End of destroyRole()

  context("setRoleAdmin()", function () {
    context("Happy Flow Test Cases", async function () {
      it("Should emit the correct event when a role admin is set", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await expect(
          addressesProvider.setRoleAdmin(
            await addressesProvider.GENIUS_LOAN_ROLE(),
            await addressesProvider.ORACLE_MANAGEMENT_ROLE()
          )
        )
          .to.emit(addressesProvider, "RoleAdminChanged")
          .withArgs(
            await addressesProvider.GENIUS_LOAN_ROLE(),
            await addressesProvider.PRIMARY_ADMIN_ROLE(),
            await addressesProvider.ORACLE_MANAGEMENT_ROLE()
          );
      });

      it("Should update state correctly", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        expect(
          await addressesProvider.getRoleAdmin(
            await addressesProvider.GENIUS_LOAN_ROLE()
          )
        ).to.be.equal(await addressesProvider.PRIMARY_ADMIN_ROLE());

        await addressesProvider.setRoleAdmin(
          await addressesProvider.GENIUS_LOAN_ROLE(),
          await addressesProvider.ORACLE_MANAGEMENT_ROLE()
        );

        expect(
          await addressesProvider.getRoleAdmin(
            await addressesProvider.GENIUS_LOAN_ROLE()
          )
        ).to.be.equal(await addressesProvider.ORACLE_MANAGEMENT_ROLE());
      });
    }); // End of setRoleAdmin() Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, rando } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PRIMARY_ADMIN_ROLE()}`;

        await expect(
          addressesProvider
            .connect(rando)
            .setRoleAdmin(
              await addressesProvider.GENIUS_LOAN_ROLE(),
              await addressesProvider.ORACLE_MANAGEMENT_ROLE()
            )
        ).to.revertedWith(expectedException);
      });
      it("Should revert if the role is already destroyed", async function () {
        const { addressesProvider, roleDestroyer } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        await addressesProvider
          .connect(roleDestroyer)
          .destroyRole(await addressesProvider.GENIUS_LOAN_ROLE());

        await expect(
          addressesProvider.setRoleAdmin(
            await addressesProvider.GENIUS_LOAN_ROLE(),
            await addressesProvider.ORACLE_MANAGEMENT_ROLE()
          )
        ).to.revertedWith(ProtocolErrors.AP_ROLE_ALREADY_DESTROYED);
      });
    }); // End of setRoleAdmin() Error Test Cases
  }); // End of setRoleAdmin()
}); // End of AddressesProvider Context

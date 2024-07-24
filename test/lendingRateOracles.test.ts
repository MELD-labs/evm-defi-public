import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { _1e18 } from "./helpers/constants";
import { MaxUint256, ZeroAddress } from "ethers";
import { ProtocolErrors } from "./helpers/types";
import { grantRoles } from "./helpers/utils/utils";

describe("Lending Rate Oracles", function () {
  context("MeldLendingRateOracle", function () {
    async function setUpFixture() {
      const [
        deployer,
        poolAdmin,
        oracleAdmin,
        bankerAdmin,
        rando,
        pauser,
        unpauser,
        roleDestroyer,
      ] = await ethers.getSigners();

      const AddressesProvider =
        await ethers.getContractFactory("AddressesProvider");
      const addressesProvider = await AddressesProvider.deploy(
        await deployer.getAddress()
      );

      // Grant roles
      await grantRoles(
        addressesProvider,
        deployer,
        poolAdmin,
        oracleAdmin,
        bankerAdmin,
        pauser,
        unpauser,
        roleDestroyer
      );

      const MeldLendingRateOracle = await ethers.getContractFactory(
        "MeldLendingRateOracle"
      );
      const meldLendingRateOracle = await MeldLendingRateOracle.deploy(
        await addressesProvider.getAddress()
      );

      // Mock asset address
      const assetAddress = ethers.Wallet.createRandom().address;
      const assetAddress2 = ethers.Wallet.createRandom().address;

      return {
        deployer,
        oracleAdmin,
        rando,
        meldLendingRateOracle,
        assetAddress,
        assetAddress2,
        addressesProvider,
      };
    }
    context("setMarketBorrowRate", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right event when setting asset borrow rate", async function () {
          const { meldLendingRateOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const borrowRate = (3n * _1e18) / 100n; // 0.03 in 18 decimals
          await expect(
            meldLendingRateOracle
              .connect(oracleAdmin)
              .setMarketBorrowRate(assetAddress, borrowRate)
          )
            .to.emit(meldLendingRateOracle, "AssetBorrowRateUpdated")
            .withArgs(oracleAdmin.address, assetAddress, 0n, borrowRate);
        });
        it("Should emit the right event when setting asset borrow rate and then updating it", async function () {
          const { meldLendingRateOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const borrowRate = (3n * _1e18) / 100n; // 0.03 in 18 decimals
          const newBorrowRate = (4n * _1e18) / 100n; // 0.04 in 18 decimals
          await expect(
            meldLendingRateOracle
              .connect(oracleAdmin)
              .setMarketBorrowRate(assetAddress, borrowRate)
          )
            .to.emit(meldLendingRateOracle, "AssetBorrowRateUpdated")
            .withArgs(oracleAdmin.address, assetAddress, 0n, borrowRate);

          await expect(
            meldLendingRateOracle
              .connect(oracleAdmin)
              .setMarketBorrowRate(assetAddress, newBorrowRate)
          )
            .to.emit(meldLendingRateOracle, "AssetBorrowRateUpdated")
            .withArgs(
              oracleAdmin.address,
              assetAddress,
              borrowRate,
              newBorrowRate
            );
        });
        it("Should have the correct borrow rate after setting it", async function () {
          const { meldLendingRateOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const borrowRate = (3n * _1e18) / 100n; // 0.03 in 18 decimals
          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, borrowRate);
          const [retrievedBorrowRate, success] =
            await meldLendingRateOracle.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate).to.equal(borrowRate);
          expect(success).to.equal(true);
        });
        it("Should have the correct borrow rate after setting it and then updating it", async function () {
          const { meldLendingRateOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const borrowRate = (3n * _1e18) / 100n; // 0.03 in 18 decimals
          const newBorrowRate = (4n * _1e18) / 100n; // 0.04 in 18 decimals
          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, borrowRate);
          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, newBorrowRate);
          const [retrievedBorrowRate, success] =
            await meldLendingRateOracle.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate).to.equal(newBorrowRate);
          expect(success).to.equal(true);
        });
      }); // end context Happy Path test cases
      context("Error test cases", function () {
        it("Should revert if the caller does not have correct role", async function () {
          const { meldLendingRateOracle, rando, addressesProvider } =
            await loadFixture(setUpFixture);
          const borrowRate = (3n * _1e18) / 100n; // 0.03 in 18 decimals

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;
          await expect(
            meldLendingRateOracle
              .connect(rando)
              .setMarketBorrowRate(rando.address, borrowRate)
          ).to.be.revertedWith(expectedException);
        });
      }); // end context Error test cases
    }); // end context setMarketBorrowRate

    context("setMultipleAssetsBorrowRate", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right event when setting multiple asset borrow rates", async function () {
          const {
            meldLendingRateOracle,
            assetAddress,
            assetAddress2,
            oracleAdmin,
          } = await loadFixture(setUpFixture);
          const assets = [assetAddress, assetAddress2];
          const borrowRates = [(3n * _1e18) / 100n, (4n * _1e18) / 100n];

          const setBorrowRatesTx = await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMultipleAssetsBorrowRate(assets, borrowRates);
          await expect(setBorrowRatesTx)
            .to.emit(meldLendingRateOracle, "AssetBorrowRateUpdated")
            .withArgs(oracleAdmin.address, assetAddress, 0n, borrowRates[0]);
          await expect(setBorrowRatesTx)
            .to.emit(meldLendingRateOracle, "AssetBorrowRateUpdated")
            .withArgs(oracleAdmin.address, assetAddress2, 0n, borrowRates[1]);
        });
        it("Should emit the right event when setting multiple asset borrow rates and then updating them", async function () {
          const {
            meldLendingRateOracle,
            assetAddress,
            assetAddress2,
            oracleAdmin,
          } = await loadFixture(setUpFixture);
          const assets = [assetAddress, assetAddress2];
          const borrowRates = [(3n * _1e18) / 100n, (4n * _1e18) / 100n];
          const newBorrowRates = [(5n * _1e18) / 100n, (6n * _1e18) / 100n];
          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMultipleAssetsBorrowRate(assets, borrowRates);
          const setBorrowRatesTx = await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMultipleAssetsBorrowRate(assets, newBorrowRates);
          await expect(setBorrowRatesTx)
            .to.emit(meldLendingRateOracle, "AssetBorrowRateUpdated")
            .withArgs(
              oracleAdmin.address,
              assetAddress,
              borrowRates[0],
              newBorrowRates[0]
            );
          await expect(setBorrowRatesTx)
            .to.emit(meldLendingRateOracle, "AssetBorrowRateUpdated")
            .withArgs(
              oracleAdmin.address,
              assetAddress2,
              borrowRates[1],
              newBorrowRates[1]
            );
        });
        it("Should have the correct borrow rates after setting them", async function () {
          const {
            meldLendingRateOracle,
            assetAddress,
            assetAddress2,
            oracleAdmin,
          } = await loadFixture(setUpFixture);
          const assets = [assetAddress, assetAddress2];
          const borrowRates = [(3n * _1e18) / 100n, (4n * _1e18) / 100n];
          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMultipleAssetsBorrowRate(assets, borrowRates);
          const [retrievedBorrowRate, success] =
            await meldLendingRateOracle.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate).to.equal(borrowRates[0]);
          expect(success).to.equal(true);
          const [retrievedBorrowRate2, success2] =
            await meldLendingRateOracle.getMarketBorrowRate(assetAddress2);
          expect(retrievedBorrowRate2).to.equal(borrowRates[1]);
          expect(success2).to.equal(true);
        });
        it("Should have the correct borrow rates after setting them and then updating them", async function () {
          const {
            meldLendingRateOracle,
            assetAddress,
            assetAddress2,
            oracleAdmin,
          } = await loadFixture(setUpFixture);
          const assets = [assetAddress, assetAddress2];
          const borrowRates = [(3n * _1e18) / 100n, (4n * _1e18) / 100n];
          const newBorrowRates = [(5n * _1e18) / 100n, (6n * _1e18) / 100n];
          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMultipleAssetsBorrowRate(assets, borrowRates);
          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMultipleAssetsBorrowRate(assets, newBorrowRates);
          const [retrievedBorrowRate, success] =
            await meldLendingRateOracle.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate).to.equal(newBorrowRates[0]);
          expect(success).to.equal(true);
          const [retrievedBorrowRate2, success2] =
            await meldLendingRateOracle.getMarketBorrowRate(assetAddress2);
          expect(retrievedBorrowRate2).to.equal(newBorrowRates[1]);
          expect(success2).to.equal(true);
        });
      }); // end context Happy Path test cases
      context("Error test cases", function () {
        it("Should revert if the caller does not have correct role", async function () {
          const { meldLendingRateOracle, rando, addressesProvider } =
            await loadFixture(setUpFixture);
          const assets = [rando.address];

          const borrowRates = [(3n * _1e18) / 100n];
          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;
          await expect(
            meldLendingRateOracle
              .connect(rando)
              .setMultipleAssetsBorrowRate(assets, borrowRates)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the assets and rates arrays are not the same length", async function () {
          const { meldLendingRateOracle, assetAddress } =
            await loadFixture(setUpFixture);
          const assets = [assetAddress, ZeroAddress];
          const borrowRates = [(3n * _1e18) / 100n];
          await expect(
            meldLendingRateOracle.setMultipleAssetsBorrowRate(
              assets,
              borrowRates
            )
          ).to.be.revertedWith(ProtocolErrors.INCONSISTENT_ARRAY_SIZE);
        });
        it("Should revert when setting multiple assets borrow rates with empty array", async function () {
          const { meldLendingRateOracle } = await loadFixture(setUpFixture);
          await expect(
            meldLendingRateOracle.setMultipleAssetsBorrowRate([], [])
          ).to.be.revertedWith(ProtocolErrors.EMPTY_ARRAY);
        });
      }); // end context Error test cases
    }); // end context setMultipleAssetsBorrowRate

    context("getMarketBorrowRate", function () {
      context("Happy Path test cases", function () {
        it("Should return the correct borrow rate", async function () {
          const { meldLendingRateOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const borrowRate = (3n * _1e18) / 100n; // 0.03 in 18 decimals
          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, borrowRate);
          const [retrievedBorrowRate, success] =
            await meldLendingRateOracle.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate).to.equal(borrowRate);
          expect(success).to.equal(true);
        });

        it("Should return true for success if borrow rate is 0", async function () {
          const { meldLendingRateOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);

          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, 0n);
          const [retrievedBorrowRate, success] =
            await meldLendingRateOracle.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate).to.equal(0n);
          expect(success).to.equal(true);
        });
      }); // end context Happy Path test cases
      context("Error test cases", function () {
        it("Should return false for success if the asset borrow rate is invalid", async function () {
          const { meldLendingRateOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);

          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, MaxUint256);

          const [retrievedBorrowRate, success] =
            await meldLendingRateOracle.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate).to.equal(MaxUint256);
          expect(success).to.equal(false);
        });
      }); // end context Error test cases
    }); // end context getMarketBorrowRate
  }); // end context MeldLendingRateOracle

  context("LendingRateOracleAggregator", function () {
    async function setUpFixture() {
      const [
        deployer,
        poolAdmin,
        oracleAdmin,
        bankerAdmin,
        rando,
        pauser,
        unpauser,
        roleDestroyer,
      ] = await ethers.getSigners();

      const AddressesProvider =
        await ethers.getContractFactory("AddressesProvider");
      const addressesProvider = await AddressesProvider.deploy(
        await deployer.getAddress()
      );

      // Grant roles
      await grantRoles(
        addressesProvider,
        deployer,
        poolAdmin,
        oracleAdmin,
        bankerAdmin,
        pauser,
        unpauser,
        roleDestroyer
      );

      const LendingRateOracleAggregator = await ethers.getContractFactory(
        "LendingRateOracleAggregator"
      );
      const lendingRateOracleAggregator =
        await LendingRateOracleAggregator.deploy(
          await addressesProvider.getAddress()
        );

      // Mock LendingRate oracle addresses
      const mockLendingRateOracles = [
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
      ];

      return {
        deployer,
        rando,
        addressesProvider,
        lendingRateOracleAggregator,
        mockLendingRateOracles,
        oracleAdmin,
      };
    }

    context("setLendingRateOracleList", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right event when setting lending rate oracle list", async function () {
          const {
            lendingRateOracleAggregator,
            mockLendingRateOracles,
            oracleAdmin,
          } = await loadFixture(setUpFixture);
          await expect(
            lendingRateOracleAggregator
              .connect(oracleAdmin)
              .setLendingRateOracleList(mockLendingRateOracles)
          )
            .to.emit(
              lendingRateOracleAggregator,
              "LendingRateOracleListUpdated"
            )
            .withArgs(oracleAdmin.address, [], mockLendingRateOracles);
        });
        it("Should emit the right event when setting lending rate oracle list and then updating it", async function () {
          const {
            lendingRateOracleAggregator,
            mockLendingRateOracles,
            oracleAdmin,
          } = await loadFixture(setUpFixture);
          const newMockLendingRateOracles = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
          ];
          await expect(
            lendingRateOracleAggregator
              .connect(oracleAdmin)
              .setLendingRateOracleList(mockLendingRateOracles)
          )
            .to.emit(
              lendingRateOracleAggregator,
              "LendingRateOracleListUpdated"
            )
            .withArgs(oracleAdmin.address, [], mockLendingRateOracles);
          await expect(
            lendingRateOracleAggregator
              .connect(oracleAdmin)
              .setLendingRateOracleList(newMockLendingRateOracles)
          )
            .to.emit(
              lendingRateOracleAggregator,
              "LendingRateOracleListUpdated"
            )
            .withArgs(
              oracleAdmin.address,
              mockLendingRateOracles,
              newMockLendingRateOracles
            );
        });
        it("Should have the correct lending rate oracle list after setting it", async function () {
          const {
            lendingRateOracleAggregator,
            mockLendingRateOracles,
            oracleAdmin,
          } = await loadFixture(setUpFixture);
          await lendingRateOracleAggregator
            .connect(oracleAdmin)
            .setLendingRateOracleList(mockLendingRateOracles);
          for (let i = 0; i < mockLendingRateOracles.length; i++) {
            const retrievedLendingRateOracle =
              await lendingRateOracleAggregator.lendingRateOracleList(i);
            expect(retrievedLendingRateOracle).to.equal(
              mockLendingRateOracles[i]
            );
          }
        });
        it("Should have the correct lending rate oracle list after setting it and then updating it", async function () {
          const {
            lendingRateOracleAggregator,
            mockLendingRateOracles,
            oracleAdmin,
          } = await loadFixture(setUpFixture);
          const newMockLendingRateOracles = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
          ];
          await lendingRateOracleAggregator
            .connect(oracleAdmin)
            .setLendingRateOracleList(mockLendingRateOracles);
          await lendingRateOracleAggregator
            .connect(oracleAdmin)
            .setLendingRateOracleList(newMockLendingRateOracles);

          for (let i = 0; i < newMockLendingRateOracles.length; i++) {
            const retrievedLendingRateOracle =
              await lendingRateOracleAggregator.lendingRateOracleList(i);
            expect(retrievedLendingRateOracle).to.equal(
              newMockLendingRateOracles[i]
            );
          }
        });
      }); // end context Happy Path test cases
      context("Error test cases", function () {
        it("Should revert if the caller does not have correct role", async function () {
          const {
            lendingRateOracleAggregator,
            rando,
            addressesProvider,
            mockLendingRateOracles,
          } = await loadFixture(setUpFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;
          await expect(
            lendingRateOracleAggregator
              .connect(rando)
              .setLendingRateOracleList(mockLendingRateOracles)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert when setting lending rate oracle list with empty array", async function () {
          const { lendingRateOracleAggregator, oracleAdmin } =
            await loadFixture(setUpFixture);
          await expect(
            lendingRateOracleAggregator
              .connect(oracleAdmin)
              .setLendingRateOracleList([])
          ).to.be.revertedWith(ProtocolErrors.EMPTY_ARRAY);
        });
      }); // end context Error test cases
    }); // end context setLendingRateOracleList
    context("getMarketBorrowRate", function () {
      context("Happy Path test cases", function () {
        it("Should return the correct borrow rate", async function () {
          const {
            lendingRateOracleAggregator,
            addressesProvider,
            oracleAdmin,
          } = await loadFixture(setUpFixture);

          const assetAddress = ethers.Wallet.createRandom().address;

          const meldLendingRateOracle = await ethers.getContractFactory(
            "MeldLendingRateOracle"
          );
          const meldLendingRateOracle1 = await meldLendingRateOracle.deploy(
            await addressesProvider.getAddress()
          );
          const meldLendingRateOracle2 = await meldLendingRateOracle.deploy(
            await addressesProvider.getAddress()
          );

          await lendingRateOracleAggregator
            .connect(oracleAdmin)
            .setLendingRateOracleList([
              meldLendingRateOracle1,
              meldLendingRateOracle2,
            ]);

          const [retrievedBorrowRate0, success0] =
            await lendingRateOracleAggregator.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate0).to.equal(0n);
          expect(success0).to.equal(true);

          // Set the borrow rate for the asset in the second oracle
          const borrowRate2 = (3n * _1e18) / 100n; // 0.03 in 18 decimals
          await meldLendingRateOracle2
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, borrowRate2);

          // Get the borrow rate for the asset
          const [retrievedBorrowRate2, success2] =
            await lendingRateOracleAggregator.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate2).to.equal(0n); // rate 0 returned by the first oracle is valid
          expect(success2).to.equal(true);

          // Set the borrow rate for the asset in the first oracle
          const borrowRate1 = (4n * _1e18) / 100n; // 0.04 in 18 decimals
          await meldLendingRateOracle1
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, borrowRate1);

          // Get the borrow rate for the asset
          const [retrievedBorrowRate1, success1] =
            await lendingRateOracleAggregator.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate1).to.equal(borrowRate1);
          expect(success1).to.equal(true);

          // Set the borrow rate for the asset in the second oracle to an invalid amount
          await meldLendingRateOracle2
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, MaxUint256);

          const [retrievedBorrowRate3, success3] =
            await lendingRateOracleAggregator.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate3).to.equal(borrowRate1); // rate returend by the first oracle is valid
          expect(success3).to.equal(true);

          // Set the borrow rate for the asset in the first oracle to an invalid amount
          await meldLendingRateOracle1
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, MaxUint256);

          const [retrievedBorrowRate4, success4] =
            await lendingRateOracleAggregator.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate4).to.equal(MaxUint256); // aggregator falls through to second oracle, which has an invalid rate
          expect(success4).to.equal(false);
        });
      }); // end context Happy Path test cases
      context("Error test cases", function () {
        it("Should return false for success if the asset does not have a borrow rate", async function () {
          const { lendingRateOracleAggregator, mockLendingRateOracles } =
            await loadFixture(setUpFixture);
          await expect(
            lendingRateOracleAggregator.getMarketBorrowRate(
              mockLendingRateOracles[0]
            )
          ).to.be.revertedWith(ProtocolErrors.LENDING_RATE_ORACLE_NOT_SET);
        });

        it("Should return false for success if the asset borrow rate is invalid", async function () {
          const {
            lendingRateOracleAggregator,
            addressesProvider,
            oracleAdmin,
          } = await loadFixture(setUpFixture);

          const assetAddress = ethers.Wallet.createRandom().address;

          const meldLendingRateOracle = await ethers.getContractFactory(
            "MeldLendingRateOracle"
          );
          const meldLendingRateOracle1 = await meldLendingRateOracle.deploy(
            await addressesProvider.getAddress()
          );
          const meldLendingRateOracle2 = await meldLendingRateOracle.deploy(
            await addressesProvider.getAddress()
          );

          await lendingRateOracleAggregator
            .connect(oracleAdmin)
            .setLendingRateOracleList([
              meldLendingRateOracle1,
              meldLendingRateOracle2,
            ]);

          await meldLendingRateOracle1
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, MaxUint256);

          await meldLendingRateOracle2
            .connect(oracleAdmin)
            .setMarketBorrowRate(assetAddress, MaxUint256);

          await expect(
            lendingRateOracleAggregator.getMarketBorrowRate(assetAddress)
          ).to.not.be.reverted;

          const [retrievedBorrowRate, success] =
            await lendingRateOracleAggregator.getMarketBorrowRate(assetAddress);
          expect(retrievedBorrowRate).to.equal(MaxUint256);
          expect(success).to.equal(false);
        });
      }); // end context Error test cases
    }); // end context getMarketBorrowRate
  }); // end context MeldLendingRateOracleAggregator
}); // end describe Lending Rate Oracles

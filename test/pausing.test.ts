import { ethers } from "hardhat";
import { setUpTestFixture } from "./helpers/utils/utils";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { RateMode } from "./helpers/types";
import { ZeroAddress, ZeroHash } from "ethers";
import { expect } from "chai";

describe("Pausing", function () {
  async function pausedProtocolFixture() {
    const basicFixturVars = await setUpTestFixture();

    await basicFixturVars.addressesProvider
      .connect(basicFixturVars.pauser)
      .pause();

    return {
      ...basicFixturVars,
    };
  }

  context("pause/unpause", function () {
    context("Happy path", function () {
      it("Should emit events when pausing and unpausing", async function () {
        const { addressesProvider, pauser, unpauser } =
          await loadFixture(setUpTestFixture);

        await expect(addressesProvider.connect(pauser).pause())
          .to.emit(addressesProvider, "Paused")
          .withArgs(pauser.address);

        await expect(addressesProvider.connect(unpauser).unpause())
          .to.emit(addressesProvider, "Unpaused")
          .withArgs(unpauser.address);
      });

      it("Should have the right values after pausing and unpausing", async function () {
        const { addressesProvider, pauser, unpauser } =
          await loadFixture(setUpTestFixture);

        expect(await addressesProvider.paused()).to.be.false;

        await addressesProvider.connect(pauser).pause();

        expect(await addressesProvider.paused()).to.be.true;

        await addressesProvider.connect(unpauser).unpause();

        expect(await addressesProvider.paused()).to.be.false;
      });
    }); // End happy path

    context("Error test cases", function () {
      it("Should revert when pausing if not pauser", async function () {
        const { addressesProvider, rando } =
          await loadFixture(setUpTestFixture);

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.PAUSER_ROLE()}`;

        await expect(
          addressesProvider.connect(rando).pause()
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert when unpausing if not unpauser", async function () {
        const { addressesProvider, pauser, rando } =
          await loadFixture(setUpTestFixture);

        await addressesProvider.connect(pauser).pause();
        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.UNPAUSER_ROLE()}`;

        await expect(
          addressesProvider.connect(rando).unpause()
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert when trying to pause when already paused", async function () {
        const { addressesProvider, pauser } =
          await loadFixture(setUpTestFixture);

        await addressesProvider.connect(pauser).pause();

        await expect(
          addressesProvider.connect(pauser).pause()
        ).to.be.revertedWith("Pausable: paused");
      });

      it("Should revert when trying to unpause when not paused", async function () {
        const { addressesProvider, unpauser } =
          await loadFixture(setUpTestFixture);

        await expect(
          addressesProvider.connect(unpauser).unpause()
        ).to.be.revertedWith("Pausable: not paused");
      });
    }); // End error test cases
  }); // End pause/unpause

  context("Paused Protocol", function () {
    context("AddressesProvider", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { addressesProvider } = await loadFixture(pausedProtocolFixture);

        await expect(
          addressesProvider.setAddressForId(ZeroHash, ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          addressesProvider.setProtocolDataProvider(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          addressesProvider.setPriceOracle(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          addressesProvider.setLendingRateOracle(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          addressesProvider.setMeldBankerNFTMinter(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // End AddressesProvider

    context("LendingPool", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { lendingPool, depositor, borrower, rando } = await loadFixture(
          pausedProtocolFixture
        );

        await expect(
          lendingPool
            .connect(depositor)
            .deposit(ZeroAddress, 0n, depositor.address, true, 0)
        ).to.be.revertedWith("Pausable: paused");
        await expect(
          lendingPool
            .connect(depositor)
            .deposit(ZeroAddress, 0n, depositor.address, false, 0)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool
            .connect(borrower)
            .withdraw(ZeroAddress, borrower.address, 0n, ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool
            .connect(rando)
            .withdraw(ZeroAddress, ZeroAddress, 0n, ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(ZeroAddress, 0n, RateMode.Variable, ZeroAddress, 0)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool
            .connect(borrower)
            .repay(ZeroAddress, 0n, RateMode.Variable, ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool
            .connect(borrower)
            .liquidationCall(ZeroAddress, ZeroAddress, ZeroAddress, 0n, false)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool.connect(borrower).flashLoan([], [], ZeroHash)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool
            .connect(borrower)
            .setUserUseReserveAsCollateral(ZeroAddress, false)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool.connect(borrower).setUserAcceptGeniusLoan(false)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool.connect(borrower).setLiquidationProtocolFeePercentage(0)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPool.connect(borrower).setFlashLoanPremium(0)
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // End LendingPool

    context("LendingPoolConfigurator", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { lendingPoolConfigurator } = await loadFixture(
          pausedProtocolFixture
        );

        await expect(
          lendingPoolConfigurator.batchInitReserve([])
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.enableBorrowingOnReserve(ZeroAddress, false)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.disableBorrowingOnReserve(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.configureReserveAsCollateral(
            ZeroAddress,
            0,
            0,
            0
          )
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.enableReserveStableRate(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.disableReserveStableRate(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.activateReserve(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.deactivateReserve(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.freezeReserve(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.unfreezeReserve(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.setReserveFactor(ZeroAddress, 0)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.setSupplyCapUSD(ZeroAddress, 0)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.setBorrowCapUSD(ZeroAddress, 0)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.setFlashLoanLimitUSD(ZeroAddress, 0)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.setYieldBoostStakingAddress(
            ZeroAddress,
            ZeroAddress
          )
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          lendingPoolConfigurator.setReserveInterestRateStrategyAddress(
            ZeroAddress,
            ZeroAddress
          )
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // End LendingPoolConfigurator

    context("LendingRateOracleAggregator", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { lendingRateOracleAggregator } = await loadFixture(
          pausedProtocolFixture
        );

        await expect(
          lendingRateOracleAggregator.setLendingRateOracleList([])
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // End LendingRateOracle

    context("MeldPriceOracle", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { meldPriceOracle } = await loadFixture(pausedProtocolFixture);

        await expect(meldPriceOracle.setMaxPriceAge(0)).to.be.revertedWith(
          "Pausable: paused"
        );
      });
    }); // End MeldPriceOracle

    context("PriceOracleAggregator", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { priceOracleAggregator } = await loadFixture(
          pausedProtocolFixture
        );

        await expect(
          priceOracleAggregator.setPriceOracleList([])
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // End PriceOracleAggregator

    context("SupraOracleAdapter", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { addressesProvider, rando } = await loadFixture(
          pausedProtocolFixture
        );

        const SupraOracleAdapter =
          await ethers.getContractFactory("SupraOracleAdapter");
        const supraOracleAdapter = await SupraOracleAdapter.deploy(
          addressesProvider,
          rando
        );

        await expect(
          supraOracleAdapter.setPairPath(ZeroAddress, [])
        ).to.be.revertedWith("Pausable: paused");

        await expect(supraOracleAdapter.setMaxPriceAge(0)).to.be.revertedWith(
          "Pausable: paused"
        );

        await expect(
          supraOracleAdapter.updateSupraSvalueFeed(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // End SupraOracleAdapter

    context("MeldBankerNFT", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { meldBankerNft } = await loadFixture(pausedProtocolFixture);

        await expect(
          meldBankerNft.setMetadataAddress(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          meldBankerNft.updateAddressesProvider(ZeroAddress)
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // End MeldBankerNFT

    context("MeldBankerNFTMetadata", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { meldBankerNftMetadata } = await loadFixture(
          pausedProtocolFixture
        );

        await expect(
          meldBankerNftMetadata.setMetadata(1, "")
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // End MeldBankerNFTMetadata

    context("MToken", function () {
      it("Should revert when trying to call protected functions when paused", async function () {
        const { meldProtocolDataProvider, usdc, depositor } = await loadFixture(
          pausedProtocolFixture
        );

        const [mUSDCAddress, ,] =
          await meldProtocolDataProvider.getReserveTokensAddresses(usdc);

        const mUSDC = await ethers.getContractAt("MToken", mUSDCAddress);

        await expect(
          mUSDC.connect(depositor).transfer(ZeroAddress, 0)
        ).to.be.revertedWith("Pausable: paused");
      });
    }); // End MToken
  }); // End paused protocol
});

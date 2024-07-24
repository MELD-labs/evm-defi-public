import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import {
  allocateAndApproveTokens,
  setUpTestFixture,
} from "./helpers/utils/utils";
import { ProtocolErrors, RateMode } from "./helpers/types";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import { oneRay } from "./helpers/constants";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { ONE_YEAR } from "./helpers/constants";

describe("VariableDebtToken", function () {
  // Test VariableDebtToken functions that are not touched by other test cases

  async function setUpDepositFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      meldBanker,
      goldenBanker,
      borrower,
      borrower3,
      borrower2,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      meldBankerTokenId,
      goldenBankerTokenId,
      yieldBoostStorageUSDC,
      yieldBoostStakingUSDC,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // USDC
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      borrower,
      contracts.lendingPool,
      20000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        borrower.address,
        true,
        0
      );

    const depositAmountUSDC2 = await allocateAndApproveTokens(
      usdc,
      owner,
      borrower2,
      contracts.lendingPool,
      5000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower2)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC2,
        borrower2.address,
        true,
        0
      );

    // DAI
    const depositAmountDAI = await allocateAndApproveTokens(
      dai,
      owner,
      borrower3,
      contracts.lendingPool,
      2000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower3)
      .deposit(
        await dai.getAddress(),
        depositAmountDAI,
        borrower3.address,
        true,
        0
      );

    // MELD
    // Approve double the amount to be deposited to test the max amount.
    const depositAmountMELD = await allocateAndApproveTokens(
      meld,
      owner,
      depositor,
      contracts.lendingPool,
      10000n,
      2n
    );

    const depositMELDTx = await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        depositor.address,
        true,
        0
      );

    await expect(depositMELDTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await meld.getAddress(), depositor.address);

    // USDT
    const depositAmountTether = await allocateAndApproveTokens(
      tether,
      owner,
      depositor,
      contracts.lendingPool,
      50000n,
      0n
    );

    const depositTetherTx = await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await tether.getAddress(),
        depositAmountTether,
        depositor.address,
        true,
        0
      );

    await expect(depositTetherTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await tether.getAddress(), depositor.address);

    return {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      meldBanker,
      goldenBanker,
      borrower,
      borrower3,
      borrower2,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      meldBankerTokenId,
      goldenBankerTokenId,
      yieldBoostStorageUSDC,
      yieldBoostStakingUSDC,
      ...contracts,
    };
  }

  async function setUpSingleVariableBorrowMELDFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      borrower,
      borrower3,
      borrower2,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      ...contracts
    } = await setUpDepositFixture();

    // Borrow borrows MELD from the lending pool
    const borrowAmount = await convertToCurrencyDecimals(
      await meld.getAddress(),
      "2000"
    );

    const borrowTx = await contracts.lendingPool
      .connect(borrower)
      .borrow(
        await meld.getAddress(),
        borrowAmount,
        RateMode.Variable,
        borrower.address,
        0
      );

    // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
    const contractInstanceWithBorrowLibraryABI = await ethers.getContractAt(
      "BorrowLogic",
      await contracts.lendingPool.getAddress(),
      owner
    );

    await expect(borrowTx)
      .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
      .withArgs(
        await meld.getAddress(),
        borrower.address,
        borrower.address,
        borrowAmount,
        RateMode.Variable,
        anyValue
      );

    // Borrower already has the amount borrowed. Make sure borrower has enough to pay off debt in test cases and has approved the lending pool to spend tokens.
    // In real life, the borrower would have to get these funds from somewhere.
    await allocateAndApproveTokens(
      meld,
      owner,
      borrower,
      contracts.lendingPool,
      2000n * 2n, // 2x the amount borrowed
      0n
    );

    return {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      borrower,
      borrower3,
      borrower2,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      borrowAmount,
      ...contracts,
    };
  }

  context("initialize()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if inizialize is called a second time", async function () {
        const { expectedReserveTokenAddresses, rando } =
          await loadFixture(setUpTestFixture);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );

        await expect(
          variableDebtToken
            .connect(rando)
            .initialize(
              rando.address,
              rando.address,
              rando.address,
              18n,
              "VariableDebtToken Name",
              "VDT"
            )
        ).to.be.revertedWith(
          ProtocolErrors.CT_RESERVE_TOKEN_ALREADY_INITIALIZED
        );
      });
    }); // End of initialize Error Test Cases Context
  }); // End of initialize Context

  context("mint()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, expectedReserveTokenAddresses, rando } =
          await loadFixture(setUpTestFixture);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_ROLE()}`;

        await expect(
          variableDebtToken
            .connect(rando)
            .mint(rando.address, rando.address, 100n, oneRay)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of mint Error Test Cases Context
  }); // End of mint Context

  context("burn()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, expectedReserveTokenAddresses, rando } =
          await loadFixture(setUpTestFixture);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_ROLE()}`;

        await expect(
          variableDebtToken.connect(rando).burn(rando.address, 100n, oneRay)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of burn Error Test Cases Context
  }); // End of burn Context

  context("transfer()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert because the function is not supported", async function () {
        const { expectedReserveTokenAddresses, rando, borrower } =
          await loadFixture(setUpTestFixture);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );

        await expect(
          variableDebtToken.connect(borrower).transfer(rando.address, 100n)
        ).to.be.revertedWith("TRANSFER_NOT_SUPPORTED");
      });
    }); // End of transfer Error Test Cases Context
  }); // End of transfer Context

  context("transferFrom()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert because the function is not supported", async function () {
        const { expectedReserveTokenAddresses, rando, borrower } =
          await loadFixture(setUpTestFixture);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );

        await expect(
          variableDebtToken.transferFrom(borrower.address, rando.address, 100n)
        ).to.be.revertedWith("TRANSFER_NOT_SUPPORTED");
      });
    }); // End of transferFrom Error Test Cases Context
  }); // End of transferFrom Context

  context("approve()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert because the function is not supported", async function () {
        const { lendingPool, expectedReserveTokenAddresses, borrower } =
          await loadFixture(setUpTestFixture);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );

        await expect(
          variableDebtToken
            .connect(borrower)
            .approve(await lendingPool.getAddress(), 100n)
        ).to.be.revertedWith("APPROVAL_NOT_SUPPORTED");
      });
    }); // End of approve Error Test Cases Context
  }); // End of approve Context

  context("allowance()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert because the function is not supported", async function () {
        const { lendingPool, expectedReserveTokenAddresses, borrower } =
          await loadFixture(setUpTestFixture);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );

        await expect(
          variableDebtToken.allowance(
            borrower.address,
            await lendingPool.getAddress()
          )
        ).to.be.revertedWith("ALLOWANCE_NOT_SUPPORTED");
      });
    }); // End of allowance Error Test Cases Context
  }); // End of allowance Context

  context("increaseAllowance()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert because the function is not supported", async function () {
        const { lendingPool, expectedReserveTokenAddresses, borrower } =
          await loadFixture(setUpTestFixture);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );

        await expect(
          variableDebtToken
            .connect(borrower)
            .increaseAllowance(await lendingPool.getAddress(), 100n)
        ).to.be.revertedWith("ALLOWANCE_NOT_SUPPORTED");
      });
    }); // End of increaseAllowance Error Test Cases Context
  }); // End of increaseAllowance Context

  context("decreaseAllowance()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert because the function is not supported", async function () {
        const { lendingPool, expectedReserveTokenAddresses, borrower } =
          await loadFixture(setUpTestFixture);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );

        await expect(
          variableDebtToken
            .connect(borrower)
            .decreaseAllowance(await lendingPool.getAddress(), 100n)
        ).to.be.revertedWith("ALLOWANCE_NOT_SUPPORTED");
      });
    }); // End of decreaseAllowance Error Test Cases Context
  }); // End of decreaseAllowance Context

  context("getScaledUserBalanceAndSupply()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should return the correct values", async function () {
        const { expectedReserveTokenAddresses, borrower, borrowAmount } =
          await loadFixture(setUpSingleVariableBorrowMELDFixture);

        // Simulate time passing
        await time.increase(ONE_YEAR);

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("MELD").VariableDebtToken
        );

        const result = await variableDebtToken.getScaledUserBalanceAndSupply(
          borrower.address
        );

        // Scaled balance and total supply should be the amuont supplied (scaled), without interest accrued
        expect(result[0]).to.be.equal(borrowAmount); // scaled balance
        expect(result[1]).to.be.equal(borrowAmount); // scaled total supply
      });
    }); // End of getScaledUserBalanceAndSupply Happy Path Test Cases Context
  }); // End of getScaledUserBalanceAndSupply Context

  context("UNDERLYING_ASSET_ADDRESS()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should return the correct value", async function () {
        const { expectedReserveTokenAddresses, meld } = await loadFixture(
          setUpSingleVariableBorrowMELDFixture
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          expectedReserveTokenAddresses.get("MELD").VariableDebtToken
        );

        const underlyingAsset =
          await variableDebtToken.UNDERLYING_ASSET_ADDRESS();
        expect(underlyingAsset).to.be.equal(await meld.getAddress());
      });
    }); // End of UNDERLYING_ASSET_ADDRESS Happy Path Test Cases Context
  }); // End of UNDERLYING_ASSET_ADDRESS Context
}); // End of VariableDebtToken Test Cases Context

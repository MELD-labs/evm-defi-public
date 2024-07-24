import { ethers } from "hardhat";
import { ZeroAddress, ZeroHash } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  allocateAndApproveTokens,
  setUpTestFixture,
} from "./helpers/utils/utils";
import { ProtocolErrors } from "./helpers/types";
import { expect } from "chai";
import { ReserveData } from "./helpers/interfaces";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import { expectEqual, getReserveData } from "./helpers/utils/helpers";

describe("FlashLoan", function () {
  async function flashLoanFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      flInitiator,
      rando,
      usdc,
      unsupportedToken,
      meld,
      ...contracts
    } = await setUpTestFixture();

    // Deposit tokens to the reserves

    // Depositor deposits USDC liquidity
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      contracts.lendingPool,
      1000n,
      0n
    );

    await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        depositor.address,
        true,
        0
      );

    // Depositor deposits MELD liquidity
    const depositAmountMELD = await allocateAndApproveTokens(
      meld,
      owner,
      depositor,
      contracts.lendingPool,
      25000n,
      0n
    );

    await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        depositor.address,
        true,
        0
      );

    const MockFlashLoanReceiver = await ethers.getContractFactory(
      "MockFlashLoanReceiver"
    );

    const mockFlashLoanReceiver = await MockFlashLoanReceiver.deploy(
      contracts.addressesProvider,
      owner
    );

    // give allowance of the owner of the tokens to the mockFlashLoanReceiver

    await usdc.connect(owner).approve(mockFlashLoanReceiver, depositAmountUSDC);
    await meld.connect(owner).approve(mockFlashLoanReceiver, depositAmountMELD);

    const contractInstanceWithLibraryABI = await ethers.getContractAt(
      "FlashLoanLogic",
      contracts.lendingPool,
      owner
    );

    return {
      ...contracts,
      usdc,
      unsupportedToken,
      meld,
      mockFlashLoanReceiver,
      contractInstanceWithLibraryABI,
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      flInitiator,
      rando,
      depositAmountUSDC,
      depositAmountMELD,
    };
  }

  context("Happy flow test cases", async function () {
    it("Should emit an event if a flash loan of one asset is successful", async function () {
      const {
        lendingPool,
        meldProtocolDataProvider,
        contractInstanceWithLibraryABI,
        usdc,
        treasury,
        flInitiator,
        mockFlashLoanReceiver,
      } = await loadFixture(flashLoanFixture);

      const flashLoanAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        100n
      );

      const flashLoanPremiumTotal = await lendingPool.flashLoanPremiumTotal();
      const expectedPremium = flashLoanAmount.percentMul(flashLoanPremiumTotal);

      const [mUSDCAddress, ,] =
        await meldProtocolDataProvider.getReserveTokensAddresses(usdc);

      await expect(
        mockFlashLoanReceiver
          .connect(flInitiator)
          .flashLoan([usdc], [flashLoanAmount], ZeroHash)
      )
        .to.emit(contractInstanceWithLibraryABI, "FlashLoan")
        .withArgs(
          await mockFlashLoanReceiver.getAddress(),
          await usdc.getAddress(),
          flashLoanAmount,
          expectedPremium
        )
        .to.emit(usdc, "Transfer")
        .withArgs(
          mUSDCAddress,
          await mockFlashLoanReceiver.getAddress(),
          flashLoanAmount
        )
        .to.emit(usdc, "Transfer")
        .withArgs(
          await mockFlashLoanReceiver.getAddress(),
          mUSDCAddress,
          flashLoanAmount
        )
        .to.emit(usdc, "Transfer")
        .withArgs(
          await mockFlashLoanReceiver.getAddress(),
          treasury.address,
          expectedPremium
        );
    });

    it("Should emit an event if a flash loan of multiple assets is successful", async function () {
      const {
        lendingPool,
        meldProtocolDataProvider,
        contractInstanceWithLibraryABI,
        usdc,
        meld,
        treasury,
        flInitiator,
        mockFlashLoanReceiver,
      } = await loadFixture(flashLoanFixture);

      const flashLoanAmountUSDC = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        100n
      );
      const flashLoanAmountMELD = await convertToCurrencyDecimals(
        await meld.getAddress(),
        1000n
      );

      const flashLoanPremiumTotal = await lendingPool.flashLoanPremiumTotal();
      const expectedPremiumUSDC = flashLoanAmountUSDC.percentMul(
        flashLoanPremiumTotal
      );
      const expectedPremiumMELD = flashLoanAmountMELD.percentMul(
        flashLoanPremiumTotal
      );

      const [mUSDCAddress, ,] =
        await meldProtocolDataProvider.getReserveTokensAddresses(usdc);
      const [mMELDAddress, ,] =
        await meldProtocolDataProvider.getReserveTokensAddresses(meld);

      await expect(
        mockFlashLoanReceiver
          .connect(flInitiator)
          .flashLoan(
            [usdc, meld],
            [flashLoanAmountUSDC, flashLoanAmountMELD],
            ZeroHash
          )
      )
        .to.emit(contractInstanceWithLibraryABI, "FlashLoan")
        .withArgs(
          await mockFlashLoanReceiver.getAddress(),
          await usdc.getAddress(),
          flashLoanAmountUSDC,
          expectedPremiumUSDC
        )
        .to.emit(usdc, "Transfer")
        .withArgs(
          mUSDCAddress,
          await mockFlashLoanReceiver.getAddress(),
          flashLoanAmountUSDC
        )
        .to.emit(usdc, "Transfer")
        .withArgs(
          await mockFlashLoanReceiver.getAddress(),
          mUSDCAddress,
          flashLoanAmountUSDC
        )
        .to.emit(usdc, "Transfer")
        .withArgs(
          await mockFlashLoanReceiver.getAddress(),
          treasury.address,
          expectedPremiumUSDC
        )
        .to.emit(contractInstanceWithLibraryABI, "FlashLoan")
        .withArgs(
          await mockFlashLoanReceiver.getAddress(),
          await meld.getAddress(),
          flashLoanAmountMELD,
          expectedPremiumMELD
        )
        .to.emit(meld, "Transfer")
        .withArgs(
          mMELDAddress,
          await mockFlashLoanReceiver.getAddress(),
          flashLoanAmountMELD
        )
        .to.emit(meld, "Transfer")
        .withArgs(
          await mockFlashLoanReceiver.getAddress(),
          mMELDAddress,
          flashLoanAmountMELD
        )
        .to.emit(meld, "Transfer")
        .withArgs(
          await mockFlashLoanReceiver.getAddress(),
          treasury.address,
          expectedPremiumMELD
        );
    });

    it("Should update the balances correctly after a flash loan of one asset", async function () {
      const {
        lendingPool,
        meldProtocolDataProvider,
        usdc,
        treasury,
        flInitiator,
        mockFlashLoanReceiver,
        lendingRateOracleAggregator,
      } = await loadFixture(flashLoanFixture);

      const flashLoanAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        100n
      );

      const flashLoanPremiumTotal = await lendingPool.flashLoanPremiumTotal();
      const expectedPremium = flashLoanAmount.percentMul(flashLoanPremiumTotal);

      const [mUSDCAddress, ,] =
        await meldProtocolDataProvider.getReserveTokensAddresses(usdc);

      expect(await usdc.balanceOf(mockFlashLoanReceiver)).to.equal(0);
      expect(await usdc.balanceOf(treasury)).to.equal(0);

      const mUSDCBalanceBefore = await usdc.balanceOf(mUSDCAddress);

      // Get reserve data before flash loan
      const reserveDataBeforeFlashLoan: ReserveData = await getReserveData(
        meldProtocolDataProvider,
        await usdc.getAddress(),
        await lendingRateOracleAggregator.getAddress()
      );

      // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
      time.setNextBlockTimestamp(await time.latest());

      await mockFlashLoanReceiver
        .connect(flInitiator)
        .flashLoan([usdc], [flashLoanAmount], ZeroHash);

      expect(
        await usdc.balanceOf(await mockFlashLoanReceiver.getAddress())
      ).to.equal(0); // This mock repays everything a doesn't earn anything

      const mUSDCBalanceAfter = await usdc.balanceOf(mUSDCAddress);

      expect(mUSDCBalanceAfter).to.equal(mUSDCBalanceBefore); // Everything is repaid

      expect(await usdc.balanceOf(treasury)).to.equal(expectedPremium);

      // Get reserve data after flash loan
      const reserveDataAfterFlashLoan: ReserveData = await getReserveData(
        meldProtocolDataProvider,
        await usdc.getAddress(),
        await lendingRateOracleAggregator.getAddress()
      );

      // Check if the reserve data is updated correctly
      expectEqual(reserveDataAfterFlashLoan, reserveDataBeforeFlashLoan);
    });

    it("Should update the balances correctly after a flash loan of multiple assets", async function () {
      const {
        lendingPool,
        meldProtocolDataProvider,
        usdc,
        meld,
        treasury,
        flInitiator,
        mockFlashLoanReceiver,
        lendingRateOracleAggregator,
      } = await loadFixture(flashLoanFixture);

      const flashLoanAmountUSDC = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        100n
      );
      const flashLoanAmountMELD = await convertToCurrencyDecimals(
        await meld.getAddress(),
        1000n
      );

      const flashLoanPremiumTotal = await lendingPool.flashLoanPremiumTotal();
      const expectedPremiumUSDC = flashLoanAmountUSDC.percentMul(
        flashLoanPremiumTotal
      );
      const expectedPremiumMELD = flashLoanAmountMELD.percentMul(
        flashLoanPremiumTotal
      );

      const [mUSDCAddress, ,] =
        await meldProtocolDataProvider.getReserveTokensAddresses(usdc);
      const [mMELDAddress, ,] =
        await meldProtocolDataProvider.getReserveTokensAddresses(meld);

      expect(await usdc.balanceOf(mockFlashLoanReceiver)).to.equal(0);
      expect(await meld.balanceOf(mockFlashLoanReceiver)).to.equal(0);
      expect(await usdc.balanceOf(treasury)).to.equal(0);
      expect(await meld.balanceOf(treasury)).to.equal(0);

      const mUSDCBalanceBefore = await usdc.balanceOf(mUSDCAddress);
      const mMELDBalanceBefore = await meld.balanceOf(mMELDAddress);

      // Get reserve data before flash loan
      const usdcReserveDataBeforeFlashLoan: ReserveData = await getReserveData(
        meldProtocolDataProvider,
        await usdc.getAddress(),
        await lendingRateOracleAggregator.getAddress()
      );

      const meldReserveDataBeforeFlashLoan: ReserveData = await getReserveData(
        meldProtocolDataProvider,
        await meld.getAddress(),
        await lendingRateOracleAggregator.getAddress()
      );

      // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
      time.setNextBlockTimestamp(await time.latest());

      await mockFlashLoanReceiver
        .connect(flInitiator)
        .flashLoan(
          [usdc, meld],
          [flashLoanAmountUSDC, flashLoanAmountMELD],
          ZeroHash
        );

      expect(
        await usdc.balanceOf(await mockFlashLoanReceiver.getAddress())
      ).to.equal(0); // This mock repays everything a doesn't earn anything
      expect(
        await meld.balanceOf(await mockFlashLoanReceiver.getAddress())
      ).to.equal(0); // This mock repays everything a doesn't earn anything

      const mUSDCBalanceAfter = await usdc.balanceOf(mUSDCAddress);
      const mMELDBalanceAfter = await meld.balanceOf(mMELDAddress);

      expect(mUSDCBalanceAfter).to.equal(mUSDCBalanceBefore); // Everything is repaid
      expect(mMELDBalanceAfter).to.equal(mMELDBalanceBefore); // Everything is repaid

      expect(await usdc.balanceOf(treasury)).to.equal(expectedPremiumUSDC);
      expect(await meld.balanceOf(treasury)).to.equal(expectedPremiumMELD);

      // Get reserve data after flash loan

      const usdcReserveDataAfterFlashLoan: ReserveData = await getReserveData(
        meldProtocolDataProvider,
        await usdc.getAddress(),
        await lendingRateOracleAggregator.getAddress()
      );

      const meldReserveDataAfterFlashLoan: ReserveData = await getReserveData(
        meldProtocolDataProvider,
        await meld.getAddress(),
        await lendingRateOracleAggregator.getAddress()
      );

      // Check if the reserve data is updated correctly

      expectEqual(
        usdcReserveDataAfterFlashLoan,
        usdcReserveDataBeforeFlashLoan
      );

      expectEqual(
        meldReserveDataAfterFlashLoan,
        meldReserveDataBeforeFlashLoan
      );
    });
  }); // end of Happy flow test cases

  context("Error flow test cases", async function () {
    it("Should revert if called by an address that does not implement IFlashLoanReceiver", async function () {
      const { lendingPool, usdc, flInitiator } =
        await loadFixture(flashLoanFixture);

      await expect(
        lendingPool
          .connect(flInitiator)
          .flashLoan(
            [usdc],
            [await convertToCurrencyDecimals(await usdc.getAddress(), 100n)],
            ZeroHash
          )
      ).to.be.reverted;
    });

    it("Should revert if there are no assets to flash loan", async function () {
      const { lendingPool, flInitiator } = await loadFixture(flashLoanFixture);

      await expect(
        lendingPool.connect(flInitiator).flashLoan([], [], ZeroHash)
      ).to.be.revertedWith(ProtocolErrors.EMPTY_ARRAY);
    });

    it("Should revert if the assets and amounts arrays have different lengths", async function () {
      const { lendingPool, usdc, meld, flInitiator } =
        await loadFixture(flashLoanFixture);

      await expect(
        lendingPool
          .connect(flInitiator)
          .flashLoan([usdc, meld], [100n], ZeroHash)
      ).to.be.revertedWith(ProtocolErrors.INCONSISTENT_ARRAY_SIZE);
    });

    it("Should revert if one of the assets is the zero address", async function () {
      const { lendingPool, usdc, flInitiator } =
        await loadFixture(flashLoanFixture);

      await expect(
        lendingPool
          .connect(flInitiator)
          .flashLoan(
            [ZeroAddress, usdc],
            [
              100n,
              await convertToCurrencyDecimals(await usdc.getAddress(), 100n),
            ],
            ZeroHash
          )
      ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if one of the amounts is zero", async function () {
      const { lendingPool, usdc, meld, flInitiator } =
        await loadFixture(flashLoanFixture);

      await expect(
        lendingPool
          .connect(flInitiator)
          .flashLoan(
            [meld, usdc],
            [
              0n,
              await convertToCurrencyDecimals(await usdc.getAddress(), 100n),
            ],
            ZeroHash
          )
      ).to.be.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);
    });

    it("Should revert if the asset is not supported", async function () {
      const { lendingPool, unsupportedToken, flInitiator } =
        await loadFixture(flashLoanFixture);

      await expect(
        lendingPool
          .connect(flInitiator)
          .flashLoan([unsupportedToken], [100n], ZeroHash)
      ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
    });

    it("Should revert if the flash loan amount is over the flash loan limit", async function () {
      const { lendingPool, meldProtocolDataProvider, usdc, flInitiator } =
        await loadFixture(flashLoanFixture);

      const [flashLoanLimit] =
        await meldProtocolDataProvider.getFlashLoanLimitData(usdc);

      await expect(
        lendingPool
          .connect(flInitiator)
          .flashLoan([usdc], [flashLoanLimit + 1n], ZeroHash)
      ).to.be.revertedWith(ProtocolErrors.VL_FLASH_LOAN_AMOUNT_OVER_LIMIT);
    });

    it("Should revert if the flash loan amount is over the available liquidity", async function () {
      const { lendingPool, usdc, flInitiator, depositAmountUSDC } =
        await loadFixture(flashLoanFixture);

      await expect(
        lendingPool
          .connect(flInitiator)
          .flashLoan([usdc], [depositAmountUSDC + 1n], ZeroHash)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("Should revert if the flash loan receiver does not return the amount + premium", async function () {
      const { usdc, flInitiator, mockFlashLoanReceiver } =
        await loadFixture(flashLoanFixture);

      const flashLoanAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        100n
      );

      await mockFlashLoanReceiver.setSpendAllTokens(true);

      await expect(
        mockFlashLoanReceiver
          .connect(flInitiator)
          .flashLoan([usdc], [flashLoanAmount], ZeroHash)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("Should revert if the flash loan receiver returns false", async function () {
      const { usdc, flInitiator, mockFlashLoanReceiver } =
        await loadFixture(flashLoanFixture);

      const flashLoanAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        100n
      );

      await mockFlashLoanReceiver.setForceFail(true);

      await expect(
        mockFlashLoanReceiver
          .connect(flInitiator)
          .flashLoan([usdc], [flashLoanAmount], ZeroHash)
      ).to.be.revertedWith(
        ProtocolErrors.FLL_INVALID_FLASH_LOAN_EXECUTOR_RETURN
      );
    });
  }); // end of Error flow test cases
});

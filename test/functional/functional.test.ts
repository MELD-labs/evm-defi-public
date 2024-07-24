import { ethers } from "hardhat";
import {
  allocateAndApproveTokens,
  setUpTestFixture,
} from "../helpers/utils/utils";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { convertToCurrencyDecimals } from "../helpers/utils/contracts-helpers";
import { ProtocolErrors, RateMode } from "../helpers/types";
import { _1e18 } from "../helpers/constants";
import { expect } from "chai";

describe("Functional Tests", function () {
  context("Deposit => Borrow", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if borrower borrows 1 USDC after depositing 1.299 DAI as collateral", async function () {
        /* This test case tests a scenario found while developing the liquidation bot.
         * The borrow correctly reverts because the collateral deposited is not enough to cover the borrow, given the LTV.
         */

        const { lendingPool, dai, usdc, borrower, depositor, owner } =
          await loadFixture(setUpTestFixture);

        // Depositor deposits USDC liquidity
        const depositAmountUSDC = await allocateAndApproveTokens(
          usdc,
          owner,
          depositor,
          lendingPool,
          50000n,
          0n
        );

        await lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            depositAmountUSDC,
            depositor.address,
            true,
            0
          );

        // Borrower deposits DAI as collateral

        const depositAmountDAI = await allocateAndApproveTokens(
          dai,
          owner,
          borrower,
          lendingPool,
          1.29995485,
          0n
        );

        await lendingPool
          .connect(borrower)
          .deposit(
            await dai.getAddress(),
            depositAmountDAI,
            borrower.address,
            true,
            0
          );

        // First - Borrower borrows 1 USDC
        const amountToBorrowUSDC = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "1"
        );

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrowUSDC,
              RateMode.Variable,
              borrower.address,
              0
            )
        ).to.be.revertedWith(
          ProtocolErrors.VL_COLLATERAL_CANNOT_COVER_NEW_BORROW
        );
      });
      it("Should revert if borrower borrows small amounts whose total is greater than available borrow amount", async function () {
        /* This test case tests a scenario found while developing the liquidation bot.
         * The second borrow now correctly reverts, after a code change.
         */

        const {
          lendingPool,
          meldProtocolDataProvider,
          priceOracleAggregator,
          dai,
          usdc,
          borrower,
          depositor,
          owner,
        } = await loadFixture(setUpTestFixture);

        // Depositor deposits USDC liquidity
        const depositAmountUSDC = await allocateAndApproveTokens(
          usdc,
          owner,
          depositor,
          lendingPool,
          50000n,
          0n
        );

        await lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            depositAmountUSDC,
            depositor.address,
            true,
            0
          );

        // Borrower deposits DAI as collateral
        const depositAmountDAI = await allocateAndApproveTokens(
          dai,
          owner,
          borrower,
          lendingPool,
          1.29995485,
          0n
        );

        await lendingPool
          .connect(borrower)
          .deposit(
            await dai.getAddress(),
            depositAmountDAI,
            borrower.address,
            true,
            0
          );

        // First - Borrower borrows 1 USDC
        const amountToBorrowUSDC = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "0.5"
        );

        await lendingPool
          .connect(borrower)
          .borrow(
            await usdc.getAddress(),
            amountToBorrowUSDC,
            RateMode.Variable,
            borrower.address,
            0
          );

        const {
          totalCollateralUSD,
          totalDebtUSD,
          availableBorrowsUSD,
          currentLiquidationThreshold,
          ltv,
          healthFactor,
        } = await lendingPool.getUserAccountData(borrower.address);

        // Caclculations based on GenericLogic.calculateUserAccountData //

        // Get DAI price in USD
        const [daiUnitPriceInUSD, oracleSuccess] =
          await priceOracleAggregator.getAssetPrice(await dai.getAddress());

        expect(oracleSuccess).to.be.true;

        const daiTokenUnit = await convertToCurrencyDecimals(
          await dai.getAddress(),
          "1"
        );

        // Get USDC price in USD
        const [usdcUnitPriceInUSD] = await priceOracleAggregator.getAssetPrice(
          await usdc.getAddress()
        );

        expect(oracleSuccess).to.be.true;

        const usdcTokenUnit = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "1"
        );

        const expectedTotalCollateralUSD =
          (depositAmountDAI * daiUnitPriceInUSD) / daiTokenUnit;
        const expectedTotalCollateralUSDConverted: bigint =
          expectedTotalCollateralUSD;

        // Instantiate reserve token contracts
        const reserveTokenAddressesUSDC =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddressesUSDC.variableDebtTokenAddress
        );

        // Calculate expected debt
        const variableDebt = await variableDebtToken.balanceOf(
          borrower.address
        );

        const usdcDebtInUSD =
          (variableDebt * usdcUnitPriceInUSD) / usdcTokenUnit;
        const expectedTotalDebtUSD = usdcDebtInUSD;

        let expectedAvailableBorrowsUSD =
          expectedTotalCollateralUSDConverted.percentMul(ltv);
        expectedAvailableBorrowsUSD =
          expectedAvailableBorrowsUSD - expectedTotalDebtUSD;

        // Get ltv and liquidationThreshold
        const reserveConfigData =
          await meldProtocolDataProvider.getReserveConfigurationData(
            await dai.getAddress()
          );

        // Calculate expected health factor
        const exectedHealthFactor = expectedTotalCollateralUSD
          .percentMul(reserveConfigData.liquidationThreshold)
          .wadDiv(expectedTotalDebtUSD);

        expect(totalCollateralUSD).to.equal(expectedTotalCollateralUSD);
        expect(totalDebtUSD).to.equal(expectedTotalDebtUSD);
        expect(availableBorrowsUSD).to.equal(expectedAvailableBorrowsUSD);
        expect(currentLiquidationThreshold).to.equal(
          reserveConfigData.liquidationThreshold
        );
        expect(ltv).to.equal(reserveConfigData.ltv);
        expect(healthFactor).to.equal(exectedHealthFactor);
        expect(healthFactor).to.be.greaterThan(_1e18);

        // Second - Borrow MELD from the lending pool
        const amountToBorrow2 = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "0.5"
        );

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow2,
              RateMode.Variable,
              borrower.address,
              0
            )
        ).to.be.revertedWith(
          ProtocolErrors.VL_COLLATERAL_CANNOT_COVER_NEW_BORROW
        );
      });
    });
  }); // End of Borrow context
}); // End of Borrow Describe

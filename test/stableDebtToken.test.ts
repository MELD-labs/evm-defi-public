import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { setUpTestFixture } from "./helpers/utils/utils";
import { ProtocolErrors } from "./helpers/types";
import { oneRay } from "./helpers/constants";

describe("StableDebtToken", function () {
  context("initialize()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if inizialize is called a second time", async function () {
        const { expectedReserveTokenAddresses, rando } =
          await loadFixture(setUpTestFixture);

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          expectedReserveTokenAddresses.get("USDC").StableDebtToken
        );

        await expect(
          stableDebtToken
            .connect(rando)
            .initialize(
              rando.address,
              rando.address,
              rando.address,
              18n,
              "StableDebtToken Name",
              "SDT"
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

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          expectedReserveTokenAddresses.get("USDC").StableDebtToken
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_ROLE()}`;

        await expect(
          stableDebtToken
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

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          expectedReserveTokenAddresses.get("USDC").StableDebtToken
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_ROLE()}`;

        await expect(
          stableDebtToken.connect(rando).burn(rando.address, 100n)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of burn Error Test Cases Context
  }); // End of burn Context

  context("UNDERLYING_ASSET_ADDRESS()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should return the correct value", async function () {
        const { expectedReserveTokenAddresses, meld } =
          await loadFixture(setUpTestFixture);

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          expectedReserveTokenAddresses.get("MELD").StableDebtToken
        );

        const underlyingAsset =
          await stableDebtToken.UNDERLYING_ASSET_ADDRESS();
        expect(underlyingAsset).to.be.equal(await meld.getAddress());
      });
    }); // End of UNDERLYING_ASSET_ADDRESS Happy Path Test Cases Context
  }); // End of UNDERLYING_ASSET_ADDRESS Context
}); // End of Stable Debt Token Test Cases Context

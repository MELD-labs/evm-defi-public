import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { _1e18 } from "./helpers/constants";
import { AddressLike, BigNumberish, ZeroAddress } from "ethers";
import { ProtocolErrors } from "./helpers/types";
import { MockSupraSValueFeed } from "../typechain-types";

describe("Price Oracles", function () {
  context("MeldPriceOracle", function () {
    async function setUpFixture() {
      const [deployer, rando, oracleAdmin] = await ethers.getSigners();

      const AddressesProvider =
        await ethers.getContractFactory("AddressesProvider");
      const addressesProvider = await AddressesProvider.deploy(
        await deployer.getAddress()
      );

      await addressesProvider.grantRole(
        await addressesProvider.ORACLE_MANAGEMENT_ROLE(),
        await oracleAdmin.getAddress()
      );

      const MeldPriceOracle =
        await ethers.getContractFactory("MeldPriceOracle");
      const meldPriceOracle = await MeldPriceOracle.connect(deployer).deploy(
        await addressesProvider.getAddress()
      );

      // Mock asset address
      const assetAddress = ethers.Wallet.createRandom().address;
      const assetAddress2 = ethers.Wallet.createRandom().address;

      return {
        deployer,
        rando,
        oracleAdmin,
        meldPriceOracle,
        assetAddress,
        assetAddress2,
        addressesProvider,
      };
    }
    context("setAssetPrice", function () {
      context("Happy Path Test Cases", function () {
        it("Should emit the right event when setting asset price", async function () {
          const { meldPriceOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const price = 2n * _1e18 * 100n;
          await expect(
            meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(assetAddress, price)
          )
            .to.emit(meldPriceOracle, "AssetPriceUpdated")
            .withArgs(oracleAdmin.address, assetAddress, 0, price);
        });
        it("Should emit the right event when setting asset price and then updating it", async function () {
          const { meldPriceOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const price = 2n * _1e18 * 100n;
          await expect(
            meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(assetAddress, price)
          )
            .to.emit(meldPriceOracle, "AssetPriceUpdated")
            .withArgs(oracleAdmin.address, assetAddress, 0, price);
          const newPrice = 3n * _1e18 * 100n;
          await expect(
            meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(assetAddress, newPrice)
          )
            .to.emit(meldPriceOracle, "AssetPriceUpdated")
            .withArgs(oracleAdmin.address, assetAddress, price, newPrice);
        });
        it("Should have the right price after setting asset price", async function () {
          const { meldPriceOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const price = 4n * _1e18 * 100n;
          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(assetAddress, price);
          const [retrievedPrice, success] =
            await meldPriceOracle.getAssetPrice(assetAddress);
          expect(retrievedPrice).to.equal(price);
          expect(success).to.be.true;
        });
        it("Should have the right price after setting asset price and then updating it", async function () {
          const { meldPriceOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const price = 5n * _1e18 * 100n;
          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(assetAddress, price);
          const newPrice = 6n * _1e18 * 100n;
          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(assetAddress, newPrice);
          const [retrievedPrice, success] =
            await meldPriceOracle.getAssetPrice(assetAddress);
          expect(retrievedPrice).to.equal(newPrice);
          expect(success).to.be.true;
        });
      }); // End of setAssetPrice Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should revert if the caller does not have correct role when calling setAssetPrice", async function () {
          const { meldPriceOracle, rando, assetAddress, addressesProvider } =
            await loadFixture(setUpFixture);

          const price = _1e18 * 100n;

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;

          await expect(
            meldPriceOracle.connect(rando).setAssetPrice(assetAddress, price)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of setAssetPrice Error Test Cases
    }); // End of setAssetPrice context

    context("setMultipleAssetsPrice", function () {
      context("Happy Path Test Cases", function () {
        it("Should emit the right events after setting multiple assets prices", async function () {
          const { oracleAdmin, meldPriceOracle, assetAddress, assetAddress2 } =
            await loadFixture(setUpFixture);
          const prices = [2n * _1e18 * 100n, 3n * _1e18 * 100n];
          const setPricesTx = await meldPriceOracle
            .connect(oracleAdmin)
            .setMultipleAssetsPrice([assetAddress, assetAddress2], prices);
          await expect(setPricesTx)
            .to.emit(meldPriceOracle, "AssetPriceUpdated")
            .withArgs(oracleAdmin.address, assetAddress, 0, prices[0]);
          await expect(setPricesTx)
            .to.emit(meldPriceOracle, "AssetPriceUpdated")
            .withArgs(oracleAdmin.address, assetAddress2, 0, prices[1]);
        });

        it("Should emit the right events after setting multiple assets prices multiple times", async function () {
          const { oracleAdmin, meldPriceOracle, assetAddress, assetAddress2 } =
            await loadFixture(setUpFixture);
          const prices = [4n * _1e18 * 100n, 5n * _1e18 * 100n];
          const setPricesTx = await meldPriceOracle
            .connect(oracleAdmin)
            .setMultipleAssetsPrice([assetAddress, assetAddress2], prices);
          await expect(setPricesTx)
            .to.emit(meldPriceOracle, "AssetPriceUpdated")
            .withArgs(oracleAdmin.address, assetAddress, 0, prices[0]);
          await expect(setPricesTx)
            .to.emit(meldPriceOracle, "AssetPriceUpdated")
            .withArgs(oracleAdmin.address, assetAddress2, 0, prices[1]);

          const newPrices = [6n * _1e18 * 100n, 7n * _1e18 * 100n];
          const setNewPricesTx = await meldPriceOracle
            .connect(oracleAdmin)
            .setMultipleAssetsPrice([assetAddress, assetAddress2], newPrices);
          await expect(setNewPricesTx)
            .to.emit(meldPriceOracle, "AssetPriceUpdated")
            .withArgs(
              oracleAdmin.address,
              assetAddress,
              prices[0],
              newPrices[0]
            );
          await expect(setNewPricesTx)
            .to.emit(meldPriceOracle, "AssetPriceUpdated")
            .withArgs(
              oracleAdmin.address,
              assetAddress2,
              prices[1],
              newPrices[1]
            );
        });

        it("Should have the right prices after setting multiple assets prices", async function () {
          const { meldPriceOracle, assetAddress, assetAddress2, oracleAdmin } =
            await loadFixture(setUpFixture);
          const prices = [9n * _1e18 * 100n, 10n * _1e18 * 100n];
          await meldPriceOracle
            .connect(oracleAdmin)
            .setMultipleAssetsPrice([assetAddress, assetAddress2], prices);

          const [retrievedPrice1, success1] =
            await meldPriceOracle.getAssetPrice(assetAddress);
          const [retrievedPrice2, success2] =
            await meldPriceOracle.getAssetPrice(assetAddress2);
          expect(retrievedPrice1).to.equal(prices[0]);
          expect(retrievedPrice2).to.equal(prices[1]);
          expect(success1).to.be.true;
          expect(success2).to.be.true;
        });

        it("Should have the right prices after setting multiple assets prices multiple times", async function () {
          const { meldPriceOracle, assetAddress, assetAddress2, oracleAdmin } =
            await loadFixture(setUpFixture);
          const prices = [12n * _1e18 * 100n, 13n * _1e18 * 100n];
          await meldPriceOracle
            .connect(oracleAdmin)
            .setMultipleAssetsPrice([assetAddress, assetAddress2], prices);

          const newPrices = [14n * _1e18 * 100n, 15n * _1e18 * 100n];
          await meldPriceOracle
            .connect(oracleAdmin)
            .setMultipleAssetsPrice([assetAddress, assetAddress2], newPrices);

          const [retrievedPrice1, success1] =
            await meldPriceOracle.getAssetPrice(assetAddress);
          const [retrievedPrice2, success2] =
            await meldPriceOracle.getAssetPrice(assetAddress2);
          expect(retrievedPrice1).to.equal(newPrices[0]);
          expect(retrievedPrice2).to.equal(newPrices[1]);
          expect(success1).to.be.true;
          expect(success2).to.be.true;
        });
      }); // End of setMultipleAssetsPrice Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should revert if the caller does not have correct role when calling setMultipleAssetsPrice", async function () {
          const { meldPriceOracle, rando, addressesProvider } =
            await loadFixture(setUpFixture);

          const assetAddresses = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
          ];
          const prices = [_1e18 * 100n, _1e18 * 150n]; // Only one price

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;

          await expect(
            meldPriceOracle
              .connect(rando)
              .setMultipleAssetsPrice(assetAddresses, prices)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert when setting multiple assets prices with different array lengths", async function () {
          const { meldPriceOracle, oracleAdmin } =
            await loadFixture(setUpFixture);
          const assetAddresses = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
          ];
          const prices = [_1e18 * 100n]; // Only one price
          await expect(
            meldPriceOracle
              .connect(oracleAdmin)
              .setMultipleAssetsPrice(assetAddresses, prices)
          ).to.be.revertedWith(ProtocolErrors.INCONSISTENT_ARRAY_SIZE);
        });

        it("Should revert when setting multiple assets prices with empty array", async function () {
          const { meldPriceOracle, oracleAdmin } =
            await loadFixture(setUpFixture);
          const assetAddresses: AddressLike[] = [];
          const prices: BigNumberish[] = [];
          await expect(
            meldPriceOracle
              .connect(oracleAdmin)
              .setMultipleAssetsPrice(assetAddresses, prices)
          ).to.be.revertedWith(ProtocolErrors.EMPTY_ARRAY);
        });
      }); // End of setMultipleAssetsPrice Error Test Cases
    }); // End of setMultipleAssetsPrice context

    context("setMaxPriceAge", function () {
      context("Happy Path Test Cases", function () {
        it("Should emit the right event when updating max price age", async function () {
          const { meldPriceOracle, oracleAdmin } =
            await loadFixture(setUpFixture);
          const oldMaxPriceAge = await meldPriceOracle.maxPriceAge();
          const newMaxPriceAge = 30 * 60; // 30 minutes
          await expect(
            meldPriceOracle.connect(oracleAdmin).setMaxPriceAge(newMaxPriceAge)
          )
            .to.emit(meldPriceOracle, "MaxPriceAgeUpdated")
            .withArgs(oracleAdmin.address, oldMaxPriceAge, newMaxPriceAge);
        });

        it("Should have the right max price age after updating it", async function () {
          const { meldPriceOracle, oracleAdmin } =
            await loadFixture(setUpFixture);
          const newMaxPriceAge = 30 * 60; // 30 minutes
          await meldPriceOracle
            .connect(oracleAdmin)
            .setMaxPriceAge(newMaxPriceAge);
          expect(await meldPriceOracle.maxPriceAge()).to.equal(newMaxPriceAge);
        });
      }); // End of setMaxPriceAge Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should revert if the caller does not have correct role when calling setMaxPriceAge", async function () {
          const { meldPriceOracle, rando, addressesProvider } =
            await loadFixture(setUpFixture);
          const newMaxPriceAge = 30 * 60; // 30 minutes
          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;

          await expect(
            meldPriceOracle.connect(rando).setMaxPriceAge(newMaxPriceAge)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert when setting max price age to zero", async function () {
          const { meldPriceOracle, oracleAdmin } =
            await loadFixture(setUpFixture);
          await expect(
            meldPriceOracle.connect(oracleAdmin).setMaxPriceAge(0)
          ).to.be.revertedWith(ProtocolErrors.EMPTY_VALUE);
        });
      }); // End of setMaxPriceAge Error Test Cases
    }); // End of setMaxPriceAge context

    context("getAssetPrice", function () {
      context("Happy Path Test Cases", function () {
        it("Should return the right asset price successfully", async function () {
          const { meldPriceOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const price = 2n * _1e18 * 100n;
          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(assetAddress, price);
          const [retrievedPrice, success] = await meldPriceOracle
            .connect(oracleAdmin)
            .getAssetPrice(assetAddress);
          expect(retrievedPrice).to.equal(price);
          expect(success).to.be.true;
        });
      }); // End of getAssetPrice Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should return invalid result after max price age", async function () {
          const { meldPriceOracle, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const price = 22n * _1e18 * 100n;
          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(assetAddress, price);

          const maxPriceAge = await meldPriceOracle.maxPriceAge();

          // Increase the block timestamp by more than the max price age
          await time.increase(maxPriceAge + 10n);

          // Check the price validity after the max price age has passed
          const [retrievedPrice, success] =
            await meldPriceOracle.getAssetPrice(assetAddress);
          expect(retrievedPrice).to.equal(price);
          expect(success).to.be.false; // The price should no longer be valid
        });

        it("Should return invalid result when asset price is not set", async function () {
          const { meldPriceOracle } = await loadFixture(setUpFixture);
          const assetAddress = ethers.Wallet.createRandom().address;
          const [retrievedPrice, success] =
            await meldPriceOracle.getAssetPrice(assetAddress);
          expect(retrievedPrice).to.equal(0);
          expect(success).to.be.false;
        });
      }); // End of getAssetPrice Error Test Cases
    }); // End of getAssetPrice context
  });

  context("PriceOracleAggregator", function () {
    async function setUpFixture() {
      const [deployer, rando, oracleAdmin] = await ethers.getSigners();

      const AddressesProvider =
        await ethers.getContractFactory("AddressesProvider");
      const addressesProvider = await AddressesProvider.deploy(
        await deployer.getAddress()
      );

      await addressesProvider.grantRole(
        await addressesProvider.ORACLE_MANAGEMENT_ROLE(),
        await oracleAdmin.getAddress()
      );

      const PriceOracleAggregator = await ethers.getContractFactory(
        "PriceOracleAggregator"
      );
      const priceOracleAggregator = await PriceOracleAggregator.connect(
        deployer
      ).deploy(await addressesProvider.getAddress());

      // Mock price oracle addresses
      const mockPriceOracles = [
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
      ];

      return {
        deployer,
        rando,
        oracleAdmin,
        priceOracleAggregator,
        mockPriceOracles,
        addressesProvider,
      };
    }

    context("setPriceOracleList", function () {
      context("Happy Path Test Cases", function () {
        it("Should emit the right event when setting price oracle list", async function () {
          const { priceOracleAggregator, mockPriceOracles, oracleAdmin } =
            await loadFixture(setUpFixture);
          await expect(
            priceOracleAggregator
              .connect(oracleAdmin)
              .setPriceOracleList(mockPriceOracles)
          )
            .to.emit(priceOracleAggregator, "PriceOracleListUpdated")
            .withArgs(oracleAdmin.address, [], mockPriceOracles);
        });

        it("Should emit the right event when updating price oracle list", async function () {
          const { oracleAdmin, priceOracleAggregator, mockPriceOracles } =
            await loadFixture(setUpFixture);

          await priceOracleAggregator
            .connect(oracleAdmin)
            .setPriceOracleList(mockPriceOracles);
          const newMockPriceOracles = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
          ];
          await expect(
            priceOracleAggregator
              .connect(oracleAdmin)
              .setPriceOracleList(newMockPriceOracles)
          )
            .to.emit(priceOracleAggregator, "PriceOracleListUpdated")
            .withArgs(
              oracleAdmin.address,
              mockPriceOracles,
              newMockPriceOracles
            );
        });

        it("Should have the right price oracle list after setting it", async function () {
          const { priceOracleAggregator, mockPriceOracles, oracleAdmin } =
            await loadFixture(setUpFixture);
          await priceOracleAggregator
            .connect(oracleAdmin)
            .setPriceOracleList(mockPriceOracles);

          for (let i = 0; i < mockPriceOracles.length; i++) {
            expect(await priceOracleAggregator.priceOracleList(i)).to.equal(
              mockPriceOracles[i]
            );
          }
        });

        it("Should have the right price oracle list after updating it", async function () {
          const { priceOracleAggregator, mockPriceOracles, oracleAdmin } =
            await loadFixture(setUpFixture);
          await priceOracleAggregator
            .connect(oracleAdmin)
            .setPriceOracleList(mockPriceOracles);

          const newMockPriceOracles = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address,
          ];
          await priceOracleAggregator
            .connect(oracleAdmin)
            .setPriceOracleList(newMockPriceOracles);

          for (let i = 0; i < newMockPriceOracles.length; i++) {
            expect(await priceOracleAggregator.priceOracleList(i)).to.equal(
              newMockPriceOracles[i]
            );
          }
        });
      }); // End of setPriceOracleList Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should revert if the caller does not have correct role when calling setPriceOracleList", async function () {
          const {
            priceOracleAggregator,
            addressesProvider,
            mockPriceOracles,
            rando,
          } = await loadFixture(setUpFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;

          await expect(
            priceOracleAggregator
              .connect(rando)
              .setPriceOracleList(mockPriceOracles)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert when setting price oracle list to an empty array", async function () {
          const { priceOracleAggregator, oracleAdmin } =
            await loadFixture(setUpFixture);
          await expect(
            priceOracleAggregator.connect(oracleAdmin).setPriceOracleList([])
          ).to.be.revertedWith(ProtocolErrors.EMPTY_ARRAY);
        });
      }); // End of setPriceOracleList Error Test Cases
    }); // End of setPriceOracleList context

    context("getAssetPrice", function () {
      context("Happy Path Test Cases", function () {
        it("Should be able to get asset price from price oracles in the right order", async function () {
          const { priceOracleAggregator, addressesProvider, oracleAdmin } =
            await loadFixture(setUpFixture);
          const assetAddress = ethers.Wallet.createRandom().address;

          const MeldPriceOracle =
            await ethers.getContractFactory("MeldPriceOracle");

          const meldPriceOracle1 = await MeldPriceOracle.deploy(
            await addressesProvider.getAddress()
          );
          const meldPriceOracle2 = await MeldPriceOracle.deploy(
            await addressesProvider.getAddress()
          );

          await priceOracleAggregator
            .connect(oracleAdmin)
            .setPriceOracleList([meldPriceOracle1, meldPriceOracle2]);

          // Check price if none of the price oracles have a price
          const [retrievedPrice0, success0] =
            await priceOracleAggregator.getAssetPrice(assetAddress);

          expect(retrievedPrice0).to.equal(0);
          expect(success0).to.be.false;

          // Set price for the second price oracle
          const price2 = _1e18 * 100n;
          await meldPriceOracle2
            .connect(oracleAdmin)
            .setAssetPrice(assetAddress, price2);

          // Check price if only the second price oracle has a price
          const [retrievedPrice1, success1] =
            await priceOracleAggregator.getAssetPrice(assetAddress);
          expect(retrievedPrice1).to.equal(price2);
          expect(success1).to.be.true;

          // Set price for the first price oracle
          const price1 = _1e18 * 200n;
          await meldPriceOracle1
            .connect(oracleAdmin)
            .setAssetPrice(assetAddress, price1);

          // Check price if both price oracles have a price
          const [retrievedPrice2, success2] =
            await priceOracleAggregator.getAssetPrice(assetAddress);
          expect(retrievedPrice2).to.equal(price1);
          expect(success2).to.be.true;
        });
      }); // End of getAssetPrice Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should revert when getting asset price with no price oracles set", async function () {
          const { priceOracleAggregator } = await loadFixture(setUpFixture);
          const assetAddress = ethers.Wallet.createRandom().address;
          await expect(
            priceOracleAggregator.getAssetPrice(assetAddress)
          ).to.be.revertedWith(ProtocolErrors.PRICE_ORACLE_NOT_SET);
        });
      }); // End of getAssetPrice Error Test Cases
    }); // End of getAssetPrice context
  }); // End of PriceOracleAggregator context

  context("SupraOracleAdapter", function () {
    async function setUpFixture() {
      const [deployer, rando, oracleAdmin] = await ethers.getSigners();

      const AddressesProvider =
        await ethers.getContractFactory("AddressesProvider");
      const addressesProvider = await AddressesProvider.deploy(
        await deployer.getAddress()
      );

      await addressesProvider.grantRole(
        await addressesProvider.ORACLE_MANAGEMENT_ROLE(),
        oracleAdmin.getAddress()
      );
      const SupraOracleAdapter =
        await ethers.getContractFactory("SupraOracleAdapter");
      const mockFeedAddress = ethers.Wallet.createRandom().address;
      const supraOracleAdapter = await SupraOracleAdapter.deploy(
        await addressesProvider.getAddress(),
        mockFeedAddress
      );

      // Mock asset address
      const assetAddress = ethers.Wallet.createRandom().address;

      return {
        deployer,
        rando,
        oracleAdmin,
        supraOracleAdapter,
        addressesProvider,
        mockFeedAddress,
        assetAddress,
      };
    }

    async function setUpFixtureWithMockSvalueFeed() {
      const [deployer, oracleAdmin, rando1, rando2, rando3] =
        await ethers.getSigners();

      const AddressesProvider =
        await ethers.getContractFactory("AddressesProvider");
      const addressesProvider = await AddressesProvider.deploy(
        await deployer.getAddress()
      );

      await addressesProvider.grantRole(
        await addressesProvider.ORACLE_MANAGEMENT_ROLE(),
        oracleAdmin.getAddress()
      );

      const SupraOracleAdapter =
        await ethers.getContractFactory("SupraOracleAdapter");
      const SvalueFeed = await ethers.getContractFactory("MockSupraSValueFeed");
      const svalueFeed = (await SvalueFeed.deploy()) as MockSupraSValueFeed;
      const supraOracleAdapter = await SupraOracleAdapter.deploy(
        await addressesProvider.getAddress(),
        svalueFeed
      );

      // Mock feed and prices
      const decimals = 18;

      const assetAddress1 = rando1.address;
      const assetAddress2 = rando2.address;
      const assetAddress3 = rando3.address; // This asset will be used to test the max price age

      const pairIndex1 = 33; // ASSET1-USD
      const pairIndex2 = 99; // ASSET2-ASSET1
      const pairIndex3 = 111; // ASSET3-USD

      const assetPrice1 = 2n * _1e18 * 100n; // 200 USD
      const assetPrice2 = 2n * assetPrice1; // 400 USD

      const asset2To1Price = 2n * _1e18; // 2 ASSET1

      const assetPrice3 = 3n * _1e18 * 100n; // 300 USD

      await svalueFeed["setFeed(uint256,uint256,uint256)"](
        pairIndex1,
        decimals,
        assetPrice1
      );
      await svalueFeed["setFeed(uint256,uint256,uint256)"](
        pairIndex2,
        decimals,
        asset2To1Price
      );
      await svalueFeed["setFeed(uint256,uint256,uint256,uint256)"](
        pairIndex3,
        decimals,
        assetPrice3,
        (await time.latest()) - 10 * 3600 // 10 hours ago
      );

      await supraOracleAdapter
        .connect(oracleAdmin)
        .setPairPath(assetAddress1, [pairIndex1]);
      await supraOracleAdapter
        .connect(oracleAdmin)
        .setPairPath(assetAddress2, [pairIndex1, pairIndex2]);
      await supraOracleAdapter
        .connect(oracleAdmin)
        .setPairPath(assetAddress3, [pairIndex3]); // Old price

      return {
        deployer,
        oracleAdmin,
        supraOracleAdapter,
        svalueFeed,
        assetAddress1,
        assetAddress2,
        assetAddress3,
        assetPrice1,
        assetPrice2,
        assetPrice3,
      };
    }

    context("setPairPath", function () {
      context("Happy Path Test Cases", function () {
        it("Should emit the right event when setting pair path", async function () {
          const { supraOracleAdapter, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const pairPath = [1, 2, 3];
          await expect(
            supraOracleAdapter
              .connect(oracleAdmin)
              .setPairPath(assetAddress, pairPath)
          )
            .to.emit(supraOracleAdapter, "PairPathAdded")
            .withArgs(oracleAdmin.address, assetAddress, pairPath);
        });

        it("Should emit the right event when updating pair path", async function () {
          const { supraOracleAdapter, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const pairPath = [1, 2, 3];
          await supraOracleAdapter
            .connect(oracleAdmin)
            .setPairPath(assetAddress, pairPath);

          const newPairPath = [4, 5, 6];
          await expect(
            supraOracleAdapter
              .connect(oracleAdmin)
              .setPairPath(assetAddress, newPairPath)
          )
            .to.emit(supraOracleAdapter, "PairPathAdded")
            .withArgs(oracleAdmin.address, assetAddress, newPairPath);
        });

        it("Should have the right pair path after setting it", async function () {
          const { supraOracleAdapter, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const pairPath = [1, 2, 3];
          await supraOracleAdapter
            .connect(oracleAdmin)
            .setPairPath(assetAddress, pairPath);

          for (let i = 0; i < pairPath.length; i++) {
            expect(
              await supraOracleAdapter.pairPaths(assetAddress, i)
            ).to.equal(pairPath[i]);
          }
        });

        it("Should have the right pair path after updating it", async function () {
          const { supraOracleAdapter, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          const pairPath = [1, 2, 3];
          await supraOracleAdapter
            .connect(oracleAdmin)
            .setPairPath(assetAddress, pairPath);

          const newPairPath = [4, 5, 6];
          await supraOracleAdapter
            .connect(oracleAdmin)
            .setPairPath(assetAddress, newPairPath);

          for (let i = 0; i < newPairPath.length; i++) {
            expect(
              await supraOracleAdapter.pairPaths(assetAddress, i)
            ).to.equal(newPairPath[i]);
          }
        });
      }); // End of setPairPath Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should revert if the caller does not have correct role when calling setPairPath", async function () {
          const { supraOracleAdapter, addressesProvider, assetAddress, rando } =
            await loadFixture(setUpFixture);

          const pairPath = [1, 2, 3];

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;

          await expect(
            supraOracleAdapter
              .connect(rando)
              .setPairPath(assetAddress, pairPath)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of setPairPath Error Test Cases
    }); // End of setPairPath context

    context("setMaxPriceAge", function () {
      context("Happy Path Test Cases", function () {
        it("Should emit the right event when updating max price age", async function () {
          const { supraOracleAdapter, oracleAdmin } =
            await loadFixture(setUpFixture);
          const oldMaxPriceAge = await supraOracleAdapter.maxPriceAge();
          const newMaxPriceAge = 30 * 60; // 30 minutes
          await expect(
            supraOracleAdapter
              .connect(oracleAdmin)
              .setMaxPriceAge(newMaxPriceAge)
          )
            .to.emit(supraOracleAdapter, "MaxPriceAgeUpdated")
            .withArgs(oracleAdmin.address, oldMaxPriceAge, newMaxPriceAge);
        });

        it("Should have the right max price age after updating it", async function () {
          const { supraOracleAdapter, oracleAdmin } =
            await loadFixture(setUpFixture);
          const newMaxPriceAge = 45 * 60; // 45 minutes
          await supraOracleAdapter
            .connect(oracleAdmin)
            .setMaxPriceAge(newMaxPriceAge);
          expect(await supraOracleAdapter.maxPriceAge()).to.equal(
            newMaxPriceAge
          );
        });
      }); // End of setMaxPriceAge Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should revert if the caller does not have correct role when calling setMaxPriceAge", async function () {
          const { supraOracleAdapter, addressesProvider, rando } =
            await loadFixture(setUpFixture);

          const newMaxPriceAge = 30 * 60; // 30 minutes

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;

          await expect(
            supraOracleAdapter.connect(rando).setMaxPriceAge(newMaxPriceAge)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert when setting max price age to zero", async function () {
          const { supraOracleAdapter, oracleAdmin } =
            await loadFixture(setUpFixture);
          await expect(
            supraOracleAdapter.connect(oracleAdmin).setMaxPriceAge(0)
          ).to.be.revertedWith(ProtocolErrors.EMPTY_VALUE);
        });
      }); // End of setMaxPriceAge Error Test Cases
    }); // End of setMaxPriceAge context

    context("updateSupraSvalueFeed", function () {
      context("Happy Path Test Cases", function () {
        it("Should emit the right event when updating the sValueFeed address", async function () {
          const { rando, supraOracleAdapter, oracleAdmin } =
            await loadFixture(setUpFixture);
          const newFeedAddress = rando.address;
          const oldFeedAddress = await supraOracleAdapter.sValueFeed();

          await expect(
            supraOracleAdapter
              .connect(oracleAdmin)
              .updateSupraSvalueFeed(newFeedAddress)
          )
            .to.emit(supraOracleAdapter, "SValueFeedUpdated")
            .withArgs(oracleAdmin.address, oldFeedAddress, newFeedAddress);
        });

        it("Should have the right sValueFeed address after updating it", async function () {
          const { rando, supraOracleAdapter, oracleAdmin } =
            await loadFixture(setUpFixture);
          const newFeedAddress = rando.address;
          await supraOracleAdapter
            .connect(oracleAdmin)
            .updateSupraSvalueFeed(newFeedAddress);
          expect(await supraOracleAdapter.sValueFeed()).to.equal(
            newFeedAddress
          );
        });
      }); // End of updateSupraSvalueFeed Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should revert if the caller does not have correct role when calling updateSupraSvalueFeed", async function () {
          const { addressesProvider, rando, supraOracleAdapter } =
            await loadFixture(setUpFixture);
          const newFeedAddress = ethers.Wallet.createRandom().address;

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.ORACLE_MANAGEMENT_ROLE()}`;

          await expect(
            supraOracleAdapter
              .connect(rando)
              .updateSupraSvalueFeed(newFeedAddress)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of updateSupraSvalueFeed Error Test Cases
    }); // End of updateSupraSvalueFeed context

    context("getAssetPrice", function () {
      context("Happy Path Test Cases", function () {
        it("Should return the right asset price successfully", async function () {
          const { supraOracleAdapter, assetAddress1, assetPrice1 } =
            await loadFixture(setUpFixtureWithMockSvalueFeed);

          const [retrievedPrice1, success1] =
            await supraOracleAdapter.getAssetPrice(assetAddress1);
          expect(retrievedPrice1).to.equal(assetPrice1);
          expect(success1).to.be.true;
        });
        it("Should return the right asset price successfully for an address with a pairPath longer than 1", async function () {
          const { supraOracleAdapter, assetAddress2, assetPrice2 } =
            await loadFixture(setUpFixtureWithMockSvalueFeed);

          const [retrievedPrice2, success2] =
            await supraOracleAdapter.getAssetPrice(assetAddress2);
          expect(retrievedPrice2).to.equal(assetPrice2);
          expect(success2).to.be.true;
        });
        it("Should return the right asset price successfully for an address with an old price", async function () {
          const { supraOracleAdapter, assetAddress3, assetPrice3 } =
            await loadFixture(setUpFixtureWithMockSvalueFeed);

          const [retrievedPrice3, success3] =
            await supraOracleAdapter.getAssetPrice(assetAddress3);
          expect(retrievedPrice3).to.equal(assetPrice3);
          expect(success3).to.be.false;
        });
        it("Should return default values after removing an asset from the oracle", async function () {
          const {
            oracleAdmin,
            supraOracleAdapter,
            assetAddress2,
            assetPrice2,
          } = await loadFixture(setUpFixtureWithMockSvalueFeed);

          const [retrievedPrice2, success2] =
            await supraOracleAdapter.getAssetPrice(assetAddress2);
          expect(retrievedPrice2).to.equal(assetPrice2);
          expect(success2).to.be.true;

          await supraOracleAdapter
            .connect(oracleAdmin)
            .setPairPath(assetAddress2, []);

          const [retrievedPrice, success] =
            await supraOracleAdapter.getAssetPrice(assetAddress2);
          expect(retrievedPrice).to.equal(0);
          expect(success).to.be.false;
        });
      }); // End of getAssetPrice Happy Path Test Cases

      context("Error Test Cases", function () {
        it("Should return default values for empty pair path", async function () {
          const { supraOracleAdapter, assetAddress } =
            await loadFixture(setUpFixture);
          const [retrievedPrice, success] =
            await supraOracleAdapter.getAssetPrice(assetAddress);
          expect(retrievedPrice).to.equal(0);
          expect(success).to.be.false;
        });
        it("Should return default values when feed is not set", async function () {
          const { supraOracleAdapter, assetAddress, oracleAdmin } =
            await loadFixture(setUpFixture);
          await supraOracleAdapter
            .connect(oracleAdmin)
            .updateSupraSvalueFeed(ZeroAddress);

          const [retrievedPrice, success] =
            await supraOracleAdapter.getAssetPrice(assetAddress);
          expect(retrievedPrice).to.equal(0);
          expect(success).to.be.false;
        });
      }); // End of getAssetPrice Error Test Cases
    }); // End of getAssetPrice context
  });
});

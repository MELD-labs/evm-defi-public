import { ethers } from "hardhat";
import { ZeroAddress } from "ethers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployContracts,
  deployMockTokens,
  getYBAddresses,
  initializeReserves,
  loadPoolConfigForEnv,
  deployProtocolAndGetSignersFixture,
} from "./helpers/utils/utils";
import { ProtocolErrors } from "./helpers/types";
import { PoolConfiguration } from "./helpers/types";
import { expect } from "chai";
import { ReserveInitParams } from "./helpers/interfaces";
import { LendingPoolConfigurator } from "../typechain-types";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("YieldBoostFactory", function () {
  async function setUpTestFixture() {
    const { owner, poolAdmin, treasury, ...contracts } =
      await deployProtocolAndGetSignersFixture();

    // Deploy mock asset tokens
    const { usdc, unsupportedToken, meld } = await deployMockTokens();

    await contracts.addressesProvider.setMeldToken(meld);

    //Initialize reserves
    const reserveInitParams: ReserveInitParams[] = [
      {
        underlyingAsset: usdc,
        interestRateStrategy: contracts.usdcInterestRateStrategy,
      },
      {
        underlyingAsset: meld,
        interestRateStrategy: contracts.meldInterestRateStrategy,
      },
    ];

    await initializeReserves(
      reserveInitParams,
      treasury.address,
      contracts.lendingPoolConfigurator as LendingPoolConfigurator,
      poolAdmin
    );

    const mockMeldStakingStorage = await ethers.getContractAt(
      "MockMeldStakingStorage",
      await contracts.addressesProvider.getMeldStakingStorage()
    );

    const epochSize = await mockMeldStakingStorage.epochSize();

    return {
      ...contracts,
      epochSize,
      owner,
      usdc,
      meld,
      unsupportedToken,
      mockMeldStakingStorage,
    };
  }

  async function withoutMeldFixture() {
    const [
      owner,
      poolAdmin,
      oracleAdmin,
      bankerAdmin,
      treasury,
      pauser,
      unpauser,
      roleDestroyer,
    ] = await ethers.getSigners();

    // Get pool configuration values
    const poolConfig: PoolConfiguration = loadPoolConfigForEnv();
    const {
      yieldBoostFactory,
      addressesProvider,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      tetherInterestRateStrategy,
    } = await deployContracts(
      false,
      poolConfig.ReservesConfig,
      owner,
      poolAdmin,
      oracleAdmin,
      bankerAdmin,
      pauser,
      unpauser,
      roleDestroyer
    ); // addressesProviderSetters == false so the MELD token is not set

    await addressesProvider.setProtocolDataProvider(meldProtocolDataProvider);

    await addressesProvider.setLendingPoolConfigurator(lendingPoolConfigurator);
    await addressesProvider.setYieldBoostFactory(yieldBoostFactory);

    // Deploy mock asset tokens
    const { tether } = await deployMockTokens();

    //Initialize reserves
    const reserveInitParams: ReserveInitParams[] = [
      {
        underlyingAsset: tether,
        interestRateStrategy: tetherInterestRateStrategy,
      },
    ];

    await initializeReserves(
      reserveInitParams,
      treasury.address,
      lendingPoolConfigurator as LendingPoolConfigurator,
      poolAdmin
    );

    return {
      yieldBoostFactory,
      tether,
    };
  }

  context("Constructor", function () {
    context("Error test cases", function () {
      it("Should not deploy the YieldBoostFactory if the MeldStakingStorage is not set", async function () {
        const [owner] = await ethers.getSigners();

        const AddressesProvider =
          await ethers.getContractFactory("AddressesProvider");
        const addressesProvider = await AddressesProvider.deploy(owner);

        const YieldBoostFactory =
          await ethers.getContractFactory("YieldBoostFactory");

        await expect(
          YieldBoostFactory.connect(owner).deploy(addressesProvider)
        ).to.be.revertedWith(ProtocolErrors.YB_INVALID_MELD_STAKING_STORAGE);
      });
      it("Should not deploy the YieldBoostFactory if the epoch size is 0", async function () {
        const [owner] = await ethers.getSigners();

        const AddressesProvider =
          await ethers.getContractFactory("AddressesProvider");
        const addressesProvider = await AddressesProvider.deploy(owner);

        const MockMeldStakingStorage = await ethers.getContractFactory(
          "MockMeldStakingStorage"
        );
        const mockMeldStakingStorage = await MockMeldStakingStorage.deploy();

        await addressesProvider.setMeldStakingStorage(mockMeldStakingStorage);

        const YieldBoostFactory =
          await ethers.getContractFactory("YieldBoostFactory");

        await mockMeldStakingStorage.setEpochSize(0);

        await expect(
          YieldBoostFactory.connect(owner).deploy(addressesProvider)
        ).to.be.revertedWith(ProtocolErrors.YB_INVALID_EPOCH_SIZE);
      });

      it("Should not deploy the YieldBoostFactory if the addresses provider is the zero address", async function () {
        const YieldBoostFactory =
          await ethers.getContractFactory("YieldBoostFactory");

        await expect(YieldBoostFactory.deploy(ZeroAddress)).to.be.revertedWith(
          ProtocolErrors.INVALID_ADDRESS
        );
      });
    }); // end of Constructor Error test cases
  }); // end of Constructor

  context("Implementation addresses", function () {
    context("Happy path test cases", function () {
      it("Should be able to get the implementation addresses", async function () {
        const { yieldBoostFactory } = await loadFixture(setUpTestFixture);

        expect(await yieldBoostFactory.ybStakingImpl()).to.not.equal(
          ZeroAddress
        );
        expect(await yieldBoostFactory.ybStorageImpl()).to.not.equal(
          ZeroAddress
        );
      });
    }); // end of Implementation addresses Happy path test cases
  }); // end of Implementation addresses

  context("Epoch Size", function () {
    context("Happy path test cases", function () {
      it("Should be able to get the epoch size", async function () {
        const { yieldBoostFactory, epochSize } =
          await loadFixture(setUpTestFixture);

        expect(await yieldBoostFactory.epochSize()).to.equal(epochSize);
      });
    }); // end of Epoch Size Happy path test cases
  }); // end of Epoch Size

  context("createYieldBoostInstance", function () {
    context("Happy path test cases", function () {
      it("Should emit events when creating a Yield Boost instance", async function () {
        const {
          yieldBoostFactory,
          addressesProvider,
          meld,
          usdc,
          epochSize,
          mockMeldStakingStorage,
        } = await loadFixture(setUpTestFixture);

        const initTimestamp = await mockMeldStakingStorage.getEpochStart(
          await mockMeldStakingStorage.getCurrentEpoch()
        );

        const createYBInstanceTx =
          await yieldBoostFactory.createYieldBoostInstance(usdc);

        await expect(createYBInstanceTx)
          .to.emit(yieldBoostFactory, "YieldBoostInstanceCreated")
          .withArgs(addressesProvider, usdc, anyValue, anyValue);

        const { ybStakingAddress, ybStorageAddress } = await getYBAddresses(
          yieldBoostFactory,
          createYBInstanceTx
        );

        expect(ybStakingAddress).to.not.equal(ZeroAddress);
        expect(ybStorageAddress).to.not.equal(ZeroAddress);

        const ybStaking = await ethers.getContractAt(
          "YieldBoostStaking",
          ybStakingAddress
        );
        const ybStorage = await ethers.getContractAt(
          "YieldBoostStorage",
          ybStorageAddress
        );

        await expect(createYBInstanceTx)
          .to.emit(ybStaking, "Initialized")
          .withArgs(
            await yieldBoostFactory.getAddress(),
            await meld.getAddress(),
            await usdc.getAddress(),
            ybStorageAddress
          );

        await expect(createYBInstanceTx)
          .to.emit(ybStorage, "Initialized")
          .withArgs(
            await yieldBoostFactory.getAddress(),
            ybStakingAddress,
            initTimestamp,
            epochSize
          );
      });
    }); // end of createYieldBoostInstance Happy path test cases

    context("Error test cases", function () {
      it("Should not create a Yield Boost instance if the underlying asset is the zero address", async function () {
        const { yieldBoostFactory } = await loadFixture(setUpTestFixture);

        await expect(
          yieldBoostFactory.createYieldBoostInstance(ZeroAddress)
        ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });
      it("Should not create a Yield Boost instance if the underlying asset is not a reserve", async function () {
        const { unsupportedToken, yieldBoostFactory } =
          await loadFixture(setUpTestFixture);

        await expect(
          yieldBoostFactory.createYieldBoostInstance(unsupportedToken)
        ).to.be.revertedWith(ProtocolErrors.YB_INVALID_ASSET);
      });
      it("Should not create a Yield Boost instance if the MELD token address in the AddressesProvider is the zero address", async function () {
        const { yieldBoostFactory, tether } =
          await loadFixture(withoutMeldFixture);
        await expect(
          yieldBoostFactory.createYieldBoostInstance(tether)
        ).to.be.revertedWith(ProtocolErrors.YB_INVALID_MELD_TOKEN);
      });
      it("Should not initialize the Yield Boost Staking or Storage contracts if the contracts are already initialized", async function () {
        const {
          yieldBoostFactory,
          addressesProvider,
          usdc,
          epochSize,
          mockMeldStakingStorage,
        } = await loadFixture(setUpTestFixture);

        const initTimestamp = await mockMeldStakingStorage.getEpochStart(
          await mockMeldStakingStorage.getCurrentEpoch()
        );

        const createYBInstanceTx =
          await yieldBoostFactory.createYieldBoostInstance(usdc);

        await expect(createYBInstanceTx)
          .to.emit(yieldBoostFactory, "YieldBoostInstanceCreated")
          .withArgs(addressesProvider, usdc, anyValue, anyValue);

        const { ybStakingAddress, ybStorageAddress } = await getYBAddresses(
          yieldBoostFactory,
          createYBInstanceTx
        );

        expect(ybStakingAddress).to.not.equal(ZeroAddress);
        expect(ybStorageAddress).to.not.equal(ZeroAddress);

        const ybStaking = await ethers.getContractAt(
          "YieldBoostStaking",
          ybStakingAddress
        );
        const ybStorage = await ethers.getContractAt(
          "YieldBoostStorage",
          ybStorageAddress
        );

        await expect(ybStaking.initialize(usdc, ybStorage)).to.be.revertedWith(
          ProtocolErrors.YB_ALREADY_INITIALIZED
        );

        await expect(
          ybStorage.initialize(initTimestamp, epochSize, ybStaking)
        ).to.be.revertedWith(ProtocolErrors.YB_ALREADY_INITIALIZED);
      });
    }); // end of createYieldBoostInstance Error test cases
  }); // end of createYieldBoostInstance
});

import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  allocateAndApproveTokens,
  deployMockTokens,
  getBlockTimestamps,
  getReserveYBContracts,
  getYBAddresses,
  setUpTestFixture,
} from "./helpers/utils/utils";
import { ProtocolErrors } from "./helpers/types";
import { expect } from "chai";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";

describe("YieldBoostStaking", function () {
  async function stakingFixture() {
    const [owner, user1, user2, user3, rewardsSetter, rando] =
      await ethers.getSigners();

    const AddressesProvider =
      await ethers.getContractFactory("AddressesProvider");
    const addressesProvider = await AddressesProvider.deploy(owner);

    const MockYBCaller = await ethers.getContractFactory("MockYBCaller");
    const mockYBCaller = await MockYBCaller.deploy();

    await addressesProvider.setLendingPool(mockYBCaller);

    // Deploy mock asset tokens
    const { usdc, meld } = await deployMockTokens();

    await addressesProvider.setMeldToken(meld);

    const MockMeldStakingStorage = await ethers.getContractFactory(
      "MockMeldStakingStorage"
    );
    const mockMeldStakingStorage = await MockMeldStakingStorage.deploy();

    await addressesProvider.setMeldStakingStorage(mockMeldStakingStorage);

    const YieldBoostFactory =
      await ethers.getContractFactory("YieldBoostFactory");
    const yieldBoostFactory = await YieldBoostFactory.deploy(addressesProvider);

    const MeldProtocolDataProvider = await ethers.getContractFactory(
      "MeldProtocolDataProvider"
    );
    const meldProtocolDataProvider =
      await MeldProtocolDataProvider.deploy(addressesProvider);

    await addressesProvider.setProtocolDataProvider(meldProtocolDataProvider);

    await addressesProvider.setYieldBoostFactory(yieldBoostFactory);

    const createYBInstanceTx =
      await yieldBoostFactory.createYieldBoostInstance(usdc);

    const { ybStakingAddress, ybStorageAddress } = await getYBAddresses(
      yieldBoostFactory,
      createYBInstanceTx
    );

    const ybStaking = await ethers.getContractAt(
      "YieldBoostStaking",
      ybStakingAddress
    );

    const ybStorage = await ethers.getContractAt(
      "YieldBoostStorage",
      ybStorageAddress
    );

    await mockYBCaller.setYBStakingAddress(ybStakingAddress);

    await addressesProvider.grantRole(
      await addressesProvider.YB_REWARDS_SETTER_ROLE(),
      rewardsSetter
    );

    const epochSize = await mockMeldStakingStorage.epochSize();
    const initTimestamp = await mockMeldStakingStorage.getEpochStart(
      await mockMeldStakingStorage.getCurrentEpoch()
    );
    return {
      addressesProvider,
      yieldBoostFactory,
      epochSize,
      initTimestamp,
      owner,
      user1,
      user2,
      user3,
      rewardsSetter,
      rando,
      usdc,
      meld,
      ybStaking,
      ybStorage,
      mockYBCaller,
    };
  }

  async function rewardsFixture() {
    const stakingFixtureVars = await loadFixture(stakingFixture);

    const { usdc, meld, rewardsSetter, owner, ybStaking } = stakingFixtureVars;

    await allocateAndApproveTokens(
      usdc,
      owner,
      rewardsSetter,
      ybStaking,
      1_000_000n,
      1n
    );
    await allocateAndApproveTokens(
      meld,
      owner,
      rewardsSetter,
      ybStaking,
      1_000_000n,
      1n
    );

    const rewards = {
      assetRewards: await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "100"
      ),
      meldRewards: await convertToCurrencyDecimals(
        await meld.getAddress(),
        "3000"
      ),
    };

    return {
      ...stakingFixtureVars,
      rewards,
    };
  }

  async function realProtocolRewards() {
    const {
      addressesProvider,
      lendingPool,
      meldProtocolDataProvider,
      yieldBoostStakingUSDC,
      usdc,
      meld,
      owner,
      depositor,
      rando,
      rewardsSetter,
    } = await setUpTestFixture();

    const ybcontracts = await getReserveYBContracts(
      [await usdc.getAddress()],
      meldProtocolDataProvider
    );
    const ybStorage = ybcontracts.ybStorageContracts[0];

    // Set up first USDC deposit. factor = 2 because deposit and approval amount are different
    const depositAmount = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      lendingPool,
      1000n,
      2n
    );

    // Deposit USDC
    await lendingPool
      .connect(depositor)
      .deposit(
        await usdc.getAddress(),
        depositAmount,
        depositor.address,
        true,
        0
      );

    const epochSize = await ybStorage.getEpochSize();

    const rewards = {
      assetRewards: await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "100"
      ),
      meldRewards: await convertToCurrencyDecimals(
        await meld.getAddress(),
        "3000"
      ),
    };

    await addressesProvider.grantRole(
      await addressesProvider.YB_REWARDS_SETTER_ROLE(),
      rewardsSetter
    );

    await allocateAndApproveTokens(
      usdc,
      owner,
      rewardsSetter,
      yieldBoostStakingUSDC,
      300_000n,
      1n
    );
    await allocateAndApproveTokens(
      meld,
      owner,
      rewardsSetter,
      yieldBoostStakingUSDC,
      300_000n,
      1n
    );

    return {
      addressesProvider,
      lendingPool,
      meldProtocolDataProvider,
      yieldBoostStakingUSDC,
      usdc,
      meld,
      owner,
      depositor,
      rando,
      rewardsSetter,
      ybStorage,
      epochSize,
      rewards,
    };
  }

  context("Initial values", function () {
    it("Should get the correct initial values", async function () {
      const { ybStorage, epochSize, initTimestamp } =
        await loadFixture(stakingFixture);

      expect(await ybStorage.getEpochSize()).to.be.equal(epochSize);
      expect(await ybStorage.getInitTimestamp()).to.be.equal(initTimestamp);
      expect(await ybStorage.getCurrentEpoch()).to.be.equal(1n);
      expect(await ybStorage.getLastEpochRewardsUpdated()).to.be.equal(1n);
      expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(0n);
      expect(await ybStorage.getTotalStakedAmount()).to.be.equal(0n);
    });
  }); // End of initial values

  context("Addresses getters", function () {
    it("Should get the correct values of meldTokenAddress, assetAddress and yieldBoostStorageAddress ", async function () {
      const { ybStaking, ybStorage, meld, usdc } =
        await loadFixture(stakingFixture);

      expect(await ybStaking.meldTokenAddress()).to.be.equal(
        await meld.getAddress()
      );

      expect(await ybStaking.assetAddress()).to.be.equal(
        await usdc.getAddress()
      );

      expect(await ybStaking.yieldBoostStorageAddress()).to.be.equal(
        await ybStorage.getAddress()
      );
    });
  }); // End of Addresses getters

  context("setStakeAmount", function () {
    context("One user", function () {
      context("Happy path", function () {
        it("Should emit the right events when creating a new position", async function () {
          const { user1, usdc, ybStaking, mockYBCaller } =
            await loadFixture(stakingFixture);

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1000"
          );

          const setStakeAmountTx = await mockYBCaller.setStakeAmount(
            user1,
            stakeAmount
          );

          await expect(setStakeAmountTx)
            .to.emit(ybStaking, "StakePositionUpdated")
            .withArgs(user1.address, 0, stakeAmount);

          await expect(setStakeAmountTx)
            .to.emit(ybStaking, "StakePositionCreated")
            .withArgs(user1.address, stakeAmount);
        });

        it("Should emit the right events when updating an existing position", async function () {
          const { user1, usdc, ybStaking, mockYBCaller } =
            await loadFixture(stakingFixture);

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "500"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          const newStakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000"
          );

          const setStakeAmountTx = await mockYBCaller.setStakeAmount(
            user1,
            newStakeAmount
          );

          await expect(setStakeAmountTx)
            .to.emit(ybStaking, "StakePositionUpdated")
            .withArgs(user1.address, stakeAmount, newStakeAmount);
        });

        it("Should emit the right events when removing a position", async function () {
          const { user1, usdc, ybStaking, mockYBCaller } =
            await loadFixture(stakingFixture);

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "3000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          const setStakeAmountTx = await mockYBCaller.setStakeAmount(user1, 0);

          await expect(setStakeAmountTx)
            .to.emit(ybStaking, "StakePositionUpdated")
            .withArgs(user1.address, stakeAmount, 0);

          await expect(setStakeAmountTx)
            .to.emit(ybStaking, "StakePositionRemoved")
            .withArgs(user1.address, stakeAmount);
        });

        it("Should not emit any events when setting amount 0 to a non-existing position", async function () {
          const { user1, ybStaking, mockYBCaller } =
            await loadFixture(stakingFixture);

          const setStakeAmountTx = await mockYBCaller.setStakeAmount(user1, 0);

          expect(setStakeAmountTx).to.not.emit(
            ybStaking,
            "StakePositionCreated"
          );
          expect(setStakeAmountTx).to.not.emit(
            ybStaking,
            "StakePositionUpdated"
          );
          expect(setStakeAmountTx).to.not.emit(
            ybStaking,
            "StakePositionRemoved"
          );
        });

        it("Should have the correct state after creating a new position", async function () {
          const { user1, usdc, mockYBCaller, ybStorage } =
            await loadFixture(stakingFixture);

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1200"
          );

          expect(await ybStorage.isStaker(user1)).to.be.false;

          const setStakeAmountTx = await mockYBCaller.setStakeAmount(
            user1,
            stakeAmount
          );

          const currentEpoch = await ybStorage.getCurrentEpoch();

          // check global state

          expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
            stakeAmount
          );

          expect(
            await ybStorage.getLastStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(stakeAmount);

          expect(
            await ybStorage.getMinStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(0n);

          expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
            currentEpoch
          );

          // check user state

          expect(await ybStorage.isStaker(user1)).to.be.true;

          expect(
            await ybStorage.getStakerStakingStartTimestamp(user1)
          ).to.be.equal(
            (await getBlockTimestamps(setStakeAmountTx)).txTimestamp
          );

          expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
            stakeAmount
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(0n);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(stakeAmount);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user1)
          ).to.be.equal(currentEpoch);
        });

        it("Should have the correct state after updating an existing position increasing the stake in the same epoch it was created", async function () {
          const { user1, usdc, mockYBCaller, ybStorage } =
            await loadFixture(stakingFixture);

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1300"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          const newStakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000"
          );

          await mockYBCaller.setStakeAmount(user1, newStakeAmount);

          const currentEpoch = await ybStorage.getCurrentEpoch();

          // check global state

          expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
            newStakeAmount
          );

          expect(
            await ybStorage.getLastStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(newStakeAmount);

          expect(
            await ybStorage.getMinStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(0n);

          expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
            currentEpoch
          );

          // check user state

          expect(await ybStorage.isStaker(user1)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
            newStakeAmount
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(0n);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(newStakeAmount);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user1)
          ).to.be.equal(currentEpoch);
        });

        it("Should have the correct state after updating an existing position increasing the stake in a new epoch", async function () {
          const {
            user1,
            usdc,

            mockYBCaller,
            ybStorage,
            epochSize,
          } = await loadFixture(stakingFixture);

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          // Move to the next epoch
          await time.increase(epochSize);

          const newStakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "3100"
          );

          await mockYBCaller.setStakeAmount(user1, newStakeAmount);

          const currentEpoch = await ybStorage.getCurrentEpoch();

          // check global state

          expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
            newStakeAmount
          );

          expect(
            await ybStorage.getLastStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(newStakeAmount);

          expect(
            await ybStorage.getMinStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(stakeAmount);

          expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
            currentEpoch
          );

          // check user state

          expect(await ybStorage.isStaker(user1)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
            newStakeAmount
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(stakeAmount);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(newStakeAmount);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user1)
          ).to.be.equal(currentEpoch);
        });

        it("Should have the correct state after updating an existing position decreasing the stake in the same epoch it was created", async function () {
          const { user1, usdc, mockYBCaller, ybStorage } =
            await loadFixture(stakingFixture);

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2500"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          const newStakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1800"
          );

          await mockYBCaller.setStakeAmount(user1, newStakeAmount);

          const currentEpoch = await ybStorage.getCurrentEpoch();

          // check global state

          expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
            newStakeAmount
          );

          expect(
            await ybStorage.getLastStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(newStakeAmount);

          expect(
            await ybStorage.getMinStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(0n);

          expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
            currentEpoch
          );

          // check user state

          expect(await ybStorage.isStaker(user1)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
            newStakeAmount
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(0n);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(newStakeAmount);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user1)
          ).to.be.equal(currentEpoch);
        });

        it("Should have the correct state after updating an existing position decreasing the stake in a new epoch", async function () {
          const {
            user1,
            usdc,

            mockYBCaller,
            ybStorage,
            epochSize,
          } = await loadFixture(stakingFixture);

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2300"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          // Move to the next epoch
          await time.increase(epochSize);

          const newStakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1900"
          );

          await mockYBCaller.setStakeAmount(user1, newStakeAmount);

          const currentEpoch = await ybStorage.getCurrentEpoch();

          // check global state

          expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
            newStakeAmount
          );

          expect(
            await ybStorage.getLastStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(newStakeAmount);

          expect(
            await ybStorage.getMinStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(newStakeAmount);

          expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
            currentEpoch
          );

          // check user state

          expect(await ybStorage.isStaker(user1)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
            newStakeAmount
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(newStakeAmount);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(newStakeAmount);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user1)
          ).to.be.equal(currentEpoch);
        });
      }); // End of one userHappy path
    }); // End of one user

    context("Multiple users", function () {
      context("Happy path", function () {
        it("Should have the correct state after creating a new position for multiple users", async function () {
          const { user1, user2, usdc, mockYBCaller, ybStorage } =
            await loadFixture(stakingFixture);

          const stakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1100"
          );

          const stakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2300"
          );

          expect(await ybStorage.isStaker(user1)).to.be.false;
          expect(await ybStorage.isStaker(user2)).to.be.false;

          const setStakeAmountTx1 = await mockYBCaller.setStakeAmount(
            user1,
            stakeAmount1
          );

          const setStakeAmountTx2 = await mockYBCaller.setStakeAmount(
            user2,
            stakeAmount2
          );

          const currentEpoch = await ybStorage.getCurrentEpoch();

          // check global state

          expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
            stakeAmount1 + stakeAmount2
          );

          expect(
            await ybStorage.getLastStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(stakeAmount1 + stakeAmount2);

          expect(
            await ybStorage.getMinStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(0n);

          expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
            currentEpoch
          );

          // check user1 state

          expect(await ybStorage.isStaker(user1)).to.be.true;

          expect(
            await ybStorage.getStakerStakingStartTimestamp(user1)
          ).to.be.equal(
            (await getBlockTimestamps(setStakeAmountTx1)).txTimestamp
          );

          expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
            stakeAmount1
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(0n);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(stakeAmount1);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user1)
          ).to.be.equal(currentEpoch);

          // check user2 state

          expect(await ybStorage.isStaker(user2)).to.be.true;

          expect(
            await ybStorage.getStakerStakingStartTimestamp(user2)
          ).to.be.equal(
            (await getBlockTimestamps(setStakeAmountTx2)).txTimestamp
          );

          expect(await ybStorage.getStakerStakedAmount(user2)).to.be.equal(
            stakeAmount2
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user2,
              currentEpoch
            )
          ).to.be.equal(0n);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user2,
              currentEpoch
            )
          ).to.be.equal(stakeAmount2);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user2)
          ).to.be.equal(currentEpoch);
        });

        it("Should have the correct state after updating an existing position for multiple users in the same epoch", async function () {
          const { user1, user2, usdc, mockYBCaller, ybStorage } =
            await loadFixture(stakingFixture);

          const stakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1200"
          );

          const stakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2500"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount1);
          await mockYBCaller.setStakeAmount(user2, stakeAmount2);

          const newStakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1500"
          );

          const newStakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2700"
          );

          await mockYBCaller.setStakeAmount(user1, newStakeAmount1);
          await mockYBCaller.setStakeAmount(user2, newStakeAmount2);

          const currentEpoch = await ybStorage.getCurrentEpoch();

          // check global state

          expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
            newStakeAmount1 + newStakeAmount2
          );

          expect(
            await ybStorage.getLastStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(newStakeAmount1 + newStakeAmount2);

          expect(
            await ybStorage.getMinStakedAmountPerEpoch(currentEpoch)
          ).to.be.equal(0n);

          expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
            currentEpoch
          );

          // check user1 state

          expect(await ybStorage.isStaker(user1)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
            newStakeAmount1
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(0n);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user1,
              currentEpoch
            )
          ).to.be.equal(newStakeAmount1);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user1)
          ).to.be.equal(currentEpoch);

          // check user2

          expect(await ybStorage.isStaker(user2)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user2)).to.be.equal(
            newStakeAmount2
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user2,
              currentEpoch
            )
          ).to.be.equal(0n);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user2,
              currentEpoch
            )
          ).to.be.equal(newStakeAmount2);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user2)
          ).to.be.equal(currentEpoch);
        });

        it("Should have the correct state after updating an existing position for multiple users in different epochs", async function () {
          const { user1, user2, usdc, mockYBCaller, ybStorage, epochSize } =
            await loadFixture(stakingFixture);

          const stakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1300"
          );

          const stakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2400"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount1);
          await mockYBCaller.setStakeAmount(user2, stakeAmount2);

          // Advance 2 epochs
          await time.increase(epochSize * 2n);

          // User 1 stake position increases

          const newStakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1600"
          );

          await mockYBCaller.setStakeAmount(user1, newStakeAmount1);

          const epochSecondStakeUser1 = await ybStorage.getCurrentEpoch();

          // check global state

          const totalStakedAmountAfterFirstStake = stakeAmount1 + stakeAmount2;
          const totalStakedAmountAfterSecondStakeUser1 =
            newStakeAmount1 + stakeAmount2;

          expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
            totalStakedAmountAfterSecondStakeUser1
          );

          expect(
            await ybStorage.getLastStakedAmountPerEpoch(epochSecondStakeUser1)
          ).to.be.equal(totalStakedAmountAfterSecondStakeUser1);

          expect(
            await ybStorage.getMinStakedAmountPerEpoch(epochSecondStakeUser1)
          ).to.be.equal(totalStakedAmountAfterFirstStake);

          expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
            epochSecondStakeUser1
          );

          // check user1 state

          expect(await ybStorage.isStaker(user1)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
            newStakeAmount1
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user1,
              epochSecondStakeUser1
            )
          ).to.be.equal(stakeAmount1);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user1,
              epochSecondStakeUser1
            )
          ).to.be.equal(newStakeAmount1);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user1)
          ).to.be.equal(epochSecondStakeUser1);

          // check user2 (should not have changed)

          expect(await ybStorage.isStaker(user2)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user2)).to.be.equal(
            stakeAmount2
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user2,
              epochSecondStakeUser1
            )
          ).to.be.equal(0n); // Not updated

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user2,
              epochSecondStakeUser1
            )
          ).to.be.equal(0n); // Not updated

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user2)
          ).to.be.equal(1n);

          // User 2 stake position decreases

          // Advance 1 epoch

          await time.increase(epochSize);
          const epochSecondStakeUser2 = await ybStorage.getCurrentEpoch();

          const newStakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "500"
          );

          await mockYBCaller.setStakeAmount(user2, newStakeAmount2);

          // check global state

          const totalStakedAmountAfterSecondStakeUser2 =
            newStakeAmount1 + newStakeAmount2;

          expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
            totalStakedAmountAfterSecondStakeUser2
          );

          expect(
            await ybStorage.getLastStakedAmountPerEpoch(epochSecondStakeUser2)
          ).to.be.equal(totalStakedAmountAfterSecondStakeUser2);

          expect(
            await ybStorage.getMinStakedAmountPerEpoch(epochSecondStakeUser2)
          ).to.be.equal(totalStakedAmountAfterSecondStakeUser2);

          expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
            epochSecondStakeUser2
          );

          // check user1 state (should not have changed)

          expect(await ybStorage.isStaker(user1)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
            newStakeAmount1
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user1,
              epochSecondStakeUser2
            )
          ).to.be.equal(0n); // Not updated

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user1,
              epochSecondStakeUser2
            )
          ).to.be.equal(0n); // Not updated

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user1)
          ).to.be.equal(epochSecondStakeUser1);

          // check user2

          expect(await ybStorage.isStaker(user2)).to.be.true;

          expect(await ybStorage.getStakerStakedAmount(user2)).to.be.equal(
            newStakeAmount2
          );

          expect(
            await ybStorage.getStakerMinStakedAmountPerEpoch(
              user2,
              epochSecondStakeUser2
            )
          ).to.be.equal(newStakeAmount2);

          expect(
            await ybStorage.getStakerLastStakedAmountPerEpoch(
              user2,
              epochSecondStakeUser2
            )
          ).to.be.equal(newStakeAmount2);

          expect(
            await ybStorage.getStakerLastEpochStakingUpdated(user2)
          ).to.be.equal(epochSecondStakeUser2);
        });
      }); // End of multiple users Happy path
    }); // End of multiple users
  }); // End of setStakeAmount

  context("setRewards", function () {
    context("Happy path", function () {
      it("Should emit the right events when setting rewards", async function () {
        const {
          rewardsSetter,
          ybStaking,
          ybStorage,
          rewards,
          epochSize,
          initTimestamp,
          usdc,
          meld,
        } = await loadFixture(rewardsFixture);

        await time.increaseTo(initTimestamp + epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();
        expect(currentEpoch).to.be.equal(3n);
        const epoch = 2n;

        await expect(
          ybStaking.connect(rewardsSetter).setRewards(rewards, epoch)
        )
          .to.emit(ybStaking, "RewardsSet")
          .withArgs(
            rewardsSetter.address,
            epoch,
            rewards.assetRewards,
            rewards.meldRewards
          )
          .to.emit(ybStaking, "TokenDeposited")
          .withArgs(
            await usdc.getAddress(),
            rewardsSetter.address,
            rewards.assetRewards
          )
          .to.emit(ybStaking, "TokenDeposited")
          .withArgs(
            await meld.getAddress(),
            rewardsSetter.address,
            rewards.meldRewards
          );
      });

      it("Should emit the right events when setting rewards for two different epochs", async function () {
        const {
          rewardsSetter,
          ybStaking,
          ybStorage,
          rewards,
          epochSize,
          initTimestamp,
          usdc,
          meld,
        } = await loadFixture(rewardsFixture);

        await time.increaseTo(initTimestamp + epochSize * 3n);

        const currentEpoch = await ybStorage.getCurrentEpoch();
        expect(currentEpoch).to.be.equal(4n);
        const epoch = 2n;

        await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);

        const newEpoch = epoch + 1n;

        const newRewards = {
          assetRewards: rewards.assetRewards + 100n,
          meldRewards: rewards.meldRewards + 200n,
        };

        await expect(
          ybStaking.connect(rewardsSetter).setRewards(newRewards, newEpoch)
        )
          .to.emit(ybStaking, "RewardsSet")
          .withArgs(
            rewardsSetter.address,
            newEpoch,
            newRewards.assetRewards,
            newRewards.meldRewards
          )
          .to.emit(ybStaking, "TokenDeposited")
          .withArgs(
            await usdc.getAddress(),
            rewardsSetter.address,
            newRewards.assetRewards
          )
          .to.emit(ybStaking, "TokenDeposited")
          .withArgs(
            await meld.getAddress(),
            rewardsSetter.address,
            newRewards.meldRewards
          );
      });

      it("Should emit the right events when setting rewards only in asset tokens", async function () {
        const {
          rewardsSetter,
          ybStaking,
          ybStorage,
          epochSize,
          initTimestamp,
          usdc,
        } = await loadFixture(rewardsFixture);

        await time.increaseTo(initTimestamp + epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();
        expect(currentEpoch).to.be.equal(3n);
        const epoch = 2n;

        const rewards = {
          assetRewards: await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "350"
          ),
          meldRewards: 0n,
        };

        await expect(
          ybStaking.connect(rewardsSetter).setRewards(rewards, epoch)
        )
          .to.emit(ybStaking, "RewardsSet")
          .withArgs(rewardsSetter.address, epoch, rewards.assetRewards, 0n)
          .to.emit(ybStaking, "TokenDeposited")
          .withArgs(
            await usdc.getAddress(),
            rewardsSetter.address,
            rewards.assetRewards
          );
      });

      it("Should emit the right events when setting rewards only in meld tokens", async function () {
        const {
          rewardsSetter,
          ybStaking,
          ybStorage,
          meld,
          epochSize,
          initTimestamp,
        } = await loadFixture(rewardsFixture);

        await time.increaseTo(initTimestamp + epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();
        expect(currentEpoch).to.be.equal(3n);
        const epoch = 2n;

        const rewards = {
          assetRewards: 0n,
          meldRewards: await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2800"
          ),
        };

        await expect(
          ybStaking.connect(rewardsSetter).setRewards(rewards, epoch)
        )
          .to.emit(ybStaking, "RewardsSet")
          .withArgs(rewardsSetter.address, epoch, 0n, rewards.meldRewards)
          .to.emit(ybStaking, "TokenDeposited")
          .withArgs(
            await meld.getAddress(),
            rewardsSetter.address,
            rewards.meldRewards
          );
      });

      it("Should have the correct state after setting rewards", async function () {
        const {
          rewardsSetter,
          ybStaking,
          ybStorage,
          rewards,
          epochSize,
          initTimestamp,
          usdc,
          meld,
        } = await loadFixture(rewardsFixture);

        await time.increaseTo(initTimestamp + epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();
        expect(currentEpoch).to.be.equal(3n);
        const epoch = 2n;

        await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);

        // Check global state

        expect(await ybStorage.getTotalRewardsPerEpoch(epoch)).to.eqls([
          rewards.assetRewards,
          rewards.meldRewards,
        ]);

        expect(await ybStorage.getLastEpochRewardsUpdated()).to.be.equal(epoch);

        // Check balances

        expect(await usdc.balanceOf(ybStaking)).to.be.equal(
          rewards.assetRewards
        );

        expect(await meld.balanceOf(ybStaking)).to.be.equal(
          rewards.meldRewards
        );
      });

      it("Should have the correct state after setting rewards in multiple epochs", async function () {
        const {
          rewardsSetter,
          ybStaking,
          ybStorage,
          rewards,
          epochSize,
          initTimestamp,
          usdc,
          meld,
        } = await loadFixture(rewardsFixture);

        await time.increaseTo(initTimestamp + epochSize * 3n);

        const currentEpoch = await ybStorage.getCurrentEpoch();
        expect(currentEpoch).to.be.equal(4n);
        const epoch = 2n;

        await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);

        const newEpoch = epoch + 1n;

        const newRewards = {
          assetRewards: await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "4800"
          ),
          meldRewards: await convertToCurrencyDecimals(
            await meld.getAddress(),
            "230"
          ),
        };

        await ybStaking.connect(rewardsSetter).setRewards(newRewards, newEpoch);

        // Check global state

        expect(await ybStorage.getTotalRewardsPerEpoch(newEpoch)).to.eqls([
          newRewards.assetRewards,
          newRewards.meldRewards,
        ]);

        expect(await ybStorage.getLastEpochRewardsUpdated()).to.be.equal(
          newEpoch
        );

        // Check balances

        expect(await usdc.balanceOf(ybStaking)).to.be.equal(
          rewards.assetRewards + newRewards.assetRewards
        );

        expect(await meld.balanceOf(ybStaking)).to.be.equal(
          rewards.meldRewards + newRewards.meldRewards
        );
      });

      it("Should have the correct state after setting rewards only in asset tokens", async function () {
        const {
          rewardsSetter,
          ybStaking,
          ybStorage,
          epochSize,
          initTimestamp,
          usdc,
          meld,
        } = await loadFixture(rewardsFixture);

        await time.increaseTo(initTimestamp + epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();
        expect(currentEpoch).to.be.equal(3n);
        const epoch = 2n;

        const rewards = {
          assetRewards: await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "350"
          ),
          meldRewards: 0n,
        };

        await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);

        // Check global state

        expect(await ybStorage.getTotalRewardsPerEpoch(epoch)).to.eqls([
          rewards.assetRewards,
          0n,
        ]);

        expect(await ybStorage.getLastEpochRewardsUpdated()).to.be.equal(epoch);

        // Check balances

        expect(await usdc.balanceOf(ybStaking)).to.be.equal(
          rewards.assetRewards
        );
        expect(await meld.balanceOf(ybStaking)).to.be.equal(0n);
      });

      it("Should have the correct state after setting rewards only in meld tokens", async function () {
        const {
          rewardsSetter,
          ybStaking,
          ybStorage,
          usdc,
          meld,
          epochSize,
          initTimestamp,
        } = await loadFixture(rewardsFixture);

        await time.increaseTo(initTimestamp + epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();
        expect(currentEpoch).to.be.equal(3n);
        const epoch = 2n;

        const rewards = {
          assetRewards: 0n,
          meldRewards: await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2800"
          ),
        };

        await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);

        // Check global state

        expect(await ybStorage.getTotalRewardsPerEpoch(epoch)).to.eqls([
          0n,
          rewards.meldRewards,
        ]);

        expect(await ybStorage.getLastEpochRewardsUpdated()).to.be.equal(epoch);

        // Check balances

        expect(await meld.balanceOf(ybStaking)).to.be.equal(
          rewards.meldRewards
        );
        expect(await usdc.balanceOf(ybStaking)).to.be.equal(0n);
      });
    }); // End of Happy path setting rewards

    context("Error test cases", function () {
      it("Should revert when a non-rewards setter tries to set rewards", async function () {
        const { rando, addressesProvider, ybStaking, rewards } =
          await loadFixture(rewardsFixture);

        const epoch = 1n;

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.YB_REWARDS_SETTER_ROLE()}`;
        await expect(
          ybStaking.connect(rando).setRewards(rewards, epoch)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert when setting the rewards for the current epoch", async function () {
        const { rewardsSetter, ybStaking, ybStorage, epochSize, rewards } =
          await loadFixture(rewardsFixture);

        await time.increase(epochSize);

        const epoch = await ybStorage.getCurrentEpoch();

        await expect(
          ybStaking.connect(rewardsSetter).setRewards(rewards, epoch)
        ).to.be.revertedWith(ProtocolErrors.YB_REWARDS_CURRENT_OR_FUTURE_EPOCH);
      });

      it("Should revert when setting the rewards skipping an epoch", async function () {
        const { rewardsSetter, ybStaking, ybStorage, epochSize, rewards } =
          await loadFixture(rewardsFixture);

        await time.increase(epochSize * 3n);

        const epoch = await ybStorage.getCurrentEpoch();

        await expect(
          ybStaking.connect(rewardsSetter).setRewards(rewards, epoch - 1n)
        ).to.be.revertedWith(ProtocolErrors.YB_REWARDS_INVALID_EPOCH);
      });

      it("Should revert when setting the rewards for an epoch that has already been set", async function () {
        const { rewardsSetter, ybStaking, ybStorage, epochSize, rewards } =
          await loadFixture(rewardsFixture);

        await time.increase(epochSize * 2n);

        const epoch = (await ybStorage.getCurrentEpoch()) - 1n;

        await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);

        await expect(
          ybStaking.connect(rewardsSetter).setRewards(rewards, epoch)
        ).to.be.revertedWith(ProtocolErrors.YB_REWARDS_INVALID_EPOCH);
      });

      it("Should revert if the rewards are empty", async function () {
        const {
          rewardsSetter,
          ybStaking,

          ybStorage,
          epochSize,
        } = await loadFixture(rewardsFixture);

        await time.increase(epochSize * 2n);

        const epoch = (await ybStorage.getCurrentEpoch()) - 1n;

        await expect(
          ybStaking
            .connect(rewardsSetter)
            .setRewards({ assetRewards: 0n, meldRewards: 0n }, epoch)
        ).to.be.revertedWith(ProtocolErrors.YB_REWARDS_INVALID_AMOUNT);
      });
    }); // End of Error test cases setting rewards
  }); // End of setRewards

  context("updateUnclaimedRewards", function () {
    context("One user", function () {
      context("Happy path", function () {
        it("Should emit the right events when updating unclaimed rewards", async function () {
          const {
            user1,
            rewardsSetter,
            ybStaking,
            mockYBCaller,
            ybStorage,
            epochSize,
            rewards,
            usdc,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "20000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          // Advance to epoch 3 and set rewards for epoch 2
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsEpoch = currentEpoch - 1n;

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(rewards, rewardsEpoch);

          // Update unclaimed rewards

          await expect(ybStaking.updateUnclaimedRewards(user1))
            .to.emit(ybStaking, "UnclaimedRewardsUpdated")
            .withArgs(
              user1.address,
              0n,
              0n,
              rewards.assetRewards,
              rewards.meldRewards,
              rewardsEpoch,
              rewardsEpoch
            );
        });

        it("Should emit the right rewards after updating unclaimed rewards two epochs in a row", async function () {
          const {
            user1,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            rewards,
            usdc,
            meld,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "30000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          // Advance to epoch 3 and set rewards for epoch 2
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsEpoch = currentEpoch - 1n;

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(rewards, rewardsEpoch);

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);

          // Advance to epoch 4 and set rewards for epoch 3
          await time.increase(epochSize);
          const newCurrentEpoch = await ybStorage.getCurrentEpoch();

          expect(newCurrentEpoch).to.be.equal(4n);

          const newRewardsEpoch = newCurrentEpoch - 1n;

          const newRewards = {
            assetRewards: await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "430"
            ),
            meldRewards: await convertToCurrencyDecimals(
              await meld.getAddress(),
              "1400"
            ),
          };

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(newRewards, newRewardsEpoch);

          // Update unclaimed rewards

          await expect(ybStaking.updateUnclaimedRewards(user1))
            .to.emit(ybStaking, "UnclaimedRewardsUpdated")
            .withArgs(
              user1.address,
              rewards.assetRewards,
              rewards.meldRewards,
              rewards.assetRewards + newRewards.assetRewards,
              rewards.meldRewards + newRewards.meldRewards,
              newRewardsEpoch,
              newRewardsEpoch
            );
        });

        it("Should emit the right rewards after updating unclaimed rewards for different epochs together", async function () {
          const {
            user1,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            usdc,
            meld,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "30000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          // Advance to epoch 5 and set rewards for epoch 2-4
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsAmountUSDC = ["250", "320", "410"];
          const rewardsAmountMeld = ["1000", "1200", "1500"];

          let totalRewardsUSDC = 0n;
          let totalRewardsMELD = 0n;

          for (let epoch = 2; epoch < currentEpoch; epoch++) {
            const rewards = {
              assetRewards: await convertToCurrencyDecimals(
                await usdc.getAddress(),
                rewardsAmountUSDC[epoch - 2]
              ),
              meldRewards: await convertToCurrencyDecimals(
                await meld.getAddress(),
                rewardsAmountMeld[epoch - 2]
              ),
            };
            await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);
            totalRewardsUSDC += rewards.assetRewards;
            totalRewardsMELD += rewards.meldRewards;
          }

          // Update unclaimed rewards

          await expect(ybStaking.updateUnclaimedRewards(user1))
            .to.emit(ybStaking, "UnclaimedRewardsUpdated")
            .withArgs(
              user1.address,
              0n,
              0n,
              totalRewardsUSDC,
              totalRewardsMELD,
              2n,
              currentEpoch - 1n
            );
        });

        it("Should have the correct state after updating unclaimed rewards", async function () {
          const {
            user1,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            rewards,
            usdc,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "18000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            0n,
            0n,
          ]);

          // Advance to epoch 3 and set rewards for epoch 2
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsEpoch = currentEpoch - 1n;

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(rewards, rewardsEpoch);

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);

          // Check user state

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            rewards.assetRewards,
            rewards.meldRewards,
          ]);

          expect(
            await ybStorage.getStakerLastEpochRewardsUpdated(user1)
          ).to.be.equal(rewardsEpoch);
        });

        it("Should have the correct state after updating unclaimed rewards for two epochs in a row", async function () {
          const {
            user1,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            rewards,
            usdc,
            meld,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "30000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            0n,
            0n,
          ]);

          // Advance to epoch 3 and set rewards for epoch 2
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsEpoch = currentEpoch - 1n;

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(rewards, rewardsEpoch);

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);

          // Advance to epoch 4 and set rewards for epoch 3
          await time.increase(epochSize);
          const newCurrentEpoch = await ybStorage.getCurrentEpoch();

          expect(newCurrentEpoch).to.be.equal(4n);

          const newRewardsEpoch = newCurrentEpoch - 1n;

          const newRewards = {
            assetRewards: await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "530"
            ),
            meldRewards: await convertToCurrencyDecimals(
              await meld.getAddress(),
              "1600"
            ),
          };

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(newRewards, newRewardsEpoch);

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);

          // Check user state

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            rewards.assetRewards + newRewards.assetRewards,
            rewards.meldRewards + newRewards.meldRewards,
          ]);

          expect(
            await ybStorage.getStakerLastEpochRewardsUpdated(user1)
          ).to.be.equal(newRewardsEpoch);
        });

        it("Should have the correct state after updating unclaimed rewards for different epochs together", async function () {
          const {
            user1,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            usdc,
            meld,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "30000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount);

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            0n,
            0n,
          ]);

          // Advance to epoch 5 and set rewards for epoch 2-4
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsAmountUSDC = ["250", "320", "410"];
          const rewardsAmountMeld = ["1000", "1200", "1500"];

          let totalRewardsUSDC = 0n;
          let totalRewardsMELD = 0n;

          for (let epoch = 2; epoch < currentEpoch; epoch++) {
            const rewards = {
              assetRewards: await convertToCurrencyDecimals(
                await usdc.getAddress(),
                rewardsAmountUSDC[epoch - 2]
              ),
              meldRewards: await convertToCurrencyDecimals(
                await meld.getAddress(),
                rewardsAmountMeld[epoch - 2]
              ),
            };
            await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);
            totalRewardsUSDC += rewards.assetRewards;
            totalRewardsMELD += rewards.meldRewards;
          }

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);

          // Check user state

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            totalRewardsUSDC,
            totalRewardsMELD,
          ]);

          expect(
            await ybStorage.getStakerLastEpochRewardsUpdated(user1)
          ).to.be.equal(currentEpoch - 1n);
        });
      }); // End of Happy path one user updateUnclaimedRewards

      context("Error test cases", function () {
        it("Should revert when trying to update unclaimed rewards for a non-staker", async function () {
          const { rando, ybStaking } = await loadFixture(rewardsFixture);

          await expect(
            ybStaking.updateUnclaimedRewards(rando)
          ).to.be.revertedWith(ProtocolErrors.YB_STAKER_DOES_NOT_EXIST);
        });
      }); // End of Error test cases one user updateUnclaimedRewards
    }); // End of one user updateUnclaimedRewards

    context("Multiple users", function () {
      context("Happy path", function () {
        it("Should emit the right events when updating unclaimed rewards for multiple users", async function () {
          const {
            user1,
            user2,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            rewards,
            usdc,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "20000"
          );

          const stakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "30000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount1);
          await mockYBCaller.setStakeAmount(user2, stakeAmount2);

          // Advance to epoch 3 and set rewards for epoch 2
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsEpoch = currentEpoch - 1n;

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(rewards, rewardsEpoch);

          const globalMinStakedAmountRewardsEpoch =
            await ybStorage.getMinStakedAmountPerEpoch(rewardsEpoch);

          // Update unclaimed rewards

          await expect(ybStaking.updateUnclaimedRewards(user1))
            .to.emit(ybStaking, "UnclaimedRewardsUpdated")
            .withArgs(
              user1.address,
              0n,
              0n,
              (rewards.assetRewards * stakeAmount1) /
                globalMinStakedAmountRewardsEpoch,
              (rewards.meldRewards * stakeAmount1) /
                globalMinStakedAmountRewardsEpoch,
              rewardsEpoch,
              rewardsEpoch
            );

          await expect(ybStaking.updateUnclaimedRewards(user2))
            .to.emit(ybStaking, "UnclaimedRewardsUpdated")
            .withArgs(
              user2.address,
              0n,
              0n,
              (rewards.assetRewards * stakeAmount2) /
                globalMinStakedAmountRewardsEpoch,
              (rewards.meldRewards * stakeAmount2) /
                globalMinStakedAmountRewardsEpoch,
              rewardsEpoch,
              rewardsEpoch
            );
        });

        it("Should emit the right rewards after updating unclaimed rewards for multiple users two epochs in a row", async function () {
          const {
            user1,
            user2,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            rewards,
            usdc,
            meld,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "30000"
          );

          const stakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "40000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount1);
          await mockYBCaller.setStakeAmount(user2, stakeAmount2);

          // Advance to epoch 3 and set rewards for epoch 2
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsEpoch = currentEpoch - 1n;

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(rewards, rewardsEpoch);

          const globalMinStakedAmountRewardsEpoch =
            await ybStorage.getMinStakedAmountPerEpoch(rewardsEpoch);

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);
          await ybStaking.updateUnclaimedRewards(user2);

          // Advance to epoch 4 and set rewards for epoch 3
          await time.increase(epochSize);
          const newCurrentEpoch = await ybStorage.getCurrentEpoch();

          expect(newCurrentEpoch).to.be.equal(4n);

          const newRewardsEpoch = newCurrentEpoch - 1n;

          const newRewards = {
            assetRewards: await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "530"
            ),
            meldRewards: await convertToCurrencyDecimals(
              await meld.getAddress(),
              "1600"
            ),
          };

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(newRewards, newRewardsEpoch);

          // Update unclaimed rewards

          await expect(ybStaking.updateUnclaimedRewards(user1))
            .to.emit(ybStaking, "UnclaimedRewardsUpdated")
            .withArgs(
              user1.address,
              (rewards.assetRewards * stakeAmount1) /
                globalMinStakedAmountRewardsEpoch,
              (rewards.meldRewards * stakeAmount1) /
                globalMinStakedAmountRewardsEpoch,
              (rewards.assetRewards * stakeAmount1) /
                globalMinStakedAmountRewardsEpoch +
                (newRewards.assetRewards * stakeAmount1) /
                  globalMinStakedAmountRewardsEpoch,
              (rewards.meldRewards * stakeAmount1) /
                globalMinStakedAmountRewardsEpoch +
                (newRewards.meldRewards * stakeAmount1) /
                  globalMinStakedAmountRewardsEpoch,
              newRewardsEpoch,
              newRewardsEpoch
            );

          await expect(ybStaking.updateUnclaimedRewards(user2))
            .to.emit(ybStaking, "UnclaimedRewardsUpdated")
            .withArgs(
              user2.address,
              (rewards.assetRewards * stakeAmount2) /
                globalMinStakedAmountRewardsEpoch,
              (rewards.meldRewards * stakeAmount2) /
                globalMinStakedAmountRewardsEpoch,
              (rewards.assetRewards * stakeAmount2) /
                globalMinStakedAmountRewardsEpoch +
                (newRewards.assetRewards * stakeAmount2) /
                  globalMinStakedAmountRewardsEpoch,
              (rewards.meldRewards * stakeAmount2) /
                globalMinStakedAmountRewardsEpoch +
                (newRewards.meldRewards * stakeAmount2) /
                  globalMinStakedAmountRewardsEpoch,
              newRewardsEpoch,
              newRewardsEpoch
            );
        });

        it("Should emit the right rewards after updating unclaimed rewards for different epochs together", async function () {
          const {
            user1,
            user2,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            usdc,
            meld,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "30000"
          );

          const stakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "40000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount1);
          await mockYBCaller.setStakeAmount(user2, stakeAmount2);

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            0n,
            0n,
          ]);

          expect(await ybStorage.getStakerUnclaimedRewards(user2)).to.eqls([
            0n,
            0n,
          ]);

          // Advance to epoch 5 and set rewards for epoch 2-4
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsAmountUSDC = ["250", "320", "410"];
          const rewardsAmountMeld = ["1000", "1200", "1500"];

          let totalRewardsUSDCUser1 = 0n;
          let totalRewardsMELDUser1 = 0n;

          let totalRewardsUSDCUser2 = 0n;
          let totalRewardsMELDUser2 = 0n;

          for (let epoch = 2; epoch < currentEpoch; epoch++) {
            const rewards = {
              assetRewards: await convertToCurrencyDecimals(
                await usdc.getAddress(),
                rewardsAmountUSDC[epoch - 2]
              ),
              meldRewards: await convertToCurrencyDecimals(
                await meld.getAddress(),
                rewardsAmountMeld[epoch - 2]
              ),
            };
            await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);
            const globalMinStakedAmountRewardsEpoch =
              await ybStorage.getMinStakedAmountPerEpoch(epoch);
            totalRewardsUSDCUser1 +=
              (rewards.assetRewards * stakeAmount1) /
              globalMinStakedAmountRewardsEpoch;
            totalRewardsMELDUser1 +=
              (rewards.meldRewards * stakeAmount1) /
              globalMinStakedAmountRewardsEpoch;
            totalRewardsUSDCUser2 +=
              (rewards.assetRewards * stakeAmount2) /
              globalMinStakedAmountRewardsEpoch;
            totalRewardsMELDUser2 +=
              (rewards.meldRewards * stakeAmount2) /
              globalMinStakedAmountRewardsEpoch;
          }

          // Update unclaimed rewards

          await expect(ybStaking.updateUnclaimedRewards(user1))
            .to.emit(ybStaking, "UnclaimedRewardsUpdated")
            .withArgs(
              user1.address,
              0n,
              0n,
              totalRewardsUSDCUser1,
              totalRewardsMELDUser1,
              2n,
              currentEpoch - 1n
            );

          await expect(ybStaking.updateUnclaimedRewards(user2))
            .to.emit(ybStaking, "UnclaimedRewardsUpdated")
            .withArgs(
              user2.address,
              0n,
              0n,
              totalRewardsUSDCUser2,
              totalRewardsMELDUser2,
              2n,
              currentEpoch - 1n
            );
        });

        it("Should have the correct state after updating unclaimed rewards for multiple users", async function () {
          const {
            user1,
            user2,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            rewards,
            usdc,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "18000"
          );

          const stakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "25000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount1);
          await mockYBCaller.setStakeAmount(user2, stakeAmount2);

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            0n,
            0n,
          ]);

          expect(await ybStorage.getStakerUnclaimedRewards(user2)).to.eqls([
            0n,
            0n,
          ]);

          // Advance to epoch 3 and set rewards for epoch 2
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsEpoch = currentEpoch - 1n;

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(rewards, rewardsEpoch);

          const globalMinStakedAmountRewardsEpoch =
            await ybStorage.getMinStakedAmountPerEpoch(rewardsEpoch);

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);
          await ybStaking.updateUnclaimedRewards(user2);

          // Check user state

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            (rewards.assetRewards * stakeAmount1) /
              globalMinStakedAmountRewardsEpoch,
            (rewards.meldRewards * stakeAmount1) /
              globalMinStakedAmountRewardsEpoch,
          ]);

          expect(await ybStorage.getStakerUnclaimedRewards(user2)).to.eqls([
            (rewards.assetRewards * stakeAmount2) /
              globalMinStakedAmountRewardsEpoch,
            (rewards.meldRewards * stakeAmount2) /
              globalMinStakedAmountRewardsEpoch,
          ]);
        });

        it("Should have the correct state after updating unclaimed rewards for multiple users two epochs in a row", async function () {
          const {
            user1,
            user2,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            rewards,
            usdc,
            meld,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "570"
          );

          const stakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "13000"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount1);
          await mockYBCaller.setStakeAmount(user2, stakeAmount2);

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            0n,
            0n,
          ]);

          expect(await ybStorage.getStakerUnclaimedRewards(user2)).to.eqls([
            0n,
            0n,
          ]);

          // Advance to epoch 3 and set rewards for epoch 2
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsEpoch = currentEpoch - 1n;

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(rewards, rewardsEpoch);

          const globalMinStakedAmountRewardsEpoch =
            await ybStorage.getMinStakedAmountPerEpoch(rewardsEpoch);

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);
          await ybStaking.updateUnclaimedRewards(user2);

          // Advance to epoch 4 and set rewards for epoch 3
          await time.increase(epochSize);
          const newCurrentEpoch = await ybStorage.getCurrentEpoch();

          expect(newCurrentEpoch).to.be.equal(4n);

          const newRewardsEpoch = newCurrentEpoch - 1n;

          const newRewards = {
            assetRewards: await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "290"
            ),
            meldRewards: await convertToCurrencyDecimals(
              await meld.getAddress(),
              "1300"
            ),
          };

          await ybStaking
            .connect(rewardsSetter)
            .setRewards(newRewards, newRewardsEpoch);

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);
          await ybStaking.updateUnclaimedRewards(user2);

          // Check user state

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            (rewards.assetRewards * stakeAmount1) /
              globalMinStakedAmountRewardsEpoch +
              (newRewards.assetRewards * stakeAmount1) /
                globalMinStakedAmountRewardsEpoch,
            (rewards.meldRewards * stakeAmount1) /
              globalMinStakedAmountRewardsEpoch +
              (newRewards.meldRewards * stakeAmount1) /
                globalMinStakedAmountRewardsEpoch,
          ]);

          expect(await ybStorage.getStakerUnclaimedRewards(user2)).to.eqls([
            (rewards.assetRewards * stakeAmount2) /
              globalMinStakedAmountRewardsEpoch +
              (newRewards.assetRewards * stakeAmount2) /
                globalMinStakedAmountRewardsEpoch,
            (rewards.meldRewards * stakeAmount2) /
              globalMinStakedAmountRewardsEpoch +
              (newRewards.meldRewards * stakeAmount2) /
                globalMinStakedAmountRewardsEpoch,
          ]);
        });

        it("Should have the correct state after updating unclaimed rewards for different epochs together", async function () {
          const {
            user1,
            user2,
            rewardsSetter,
            ybStaking,
            ybStorage,
            mockYBCaller,
            epochSize,
            usdc,
            meld,
          } = await loadFixture(rewardsFixture);

          // Set stake amount for epoch1

          const stakeAmount1 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "26000"
          );

          const stakeAmount2 = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "34700"
          );

          await mockYBCaller.setStakeAmount(user1, stakeAmount1);
          await mockYBCaller.setStakeAmount(user2, stakeAmount2);

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            0n,
            0n,
          ]);

          expect(await ybStorage.getStakerUnclaimedRewards(user2)).to.eqls([
            0n,
            0n,
          ]);

          // Advance to epoch 5 and set rewards for epoch 2-4
          await time.increase(epochSize * 2n);
          const currentEpoch = await ybStorage.getCurrentEpoch();

          expect(currentEpoch).to.be.equal(3n);

          const rewardsAmountUSDC = ["160", "370", "110"];
          const rewardsAmountMeld = ["1520", "1260", "1300"];

          let totalRewardsUSDCUser1 = 0n;
          let totalRewardsMELDUser1 = 0n;

          let totalRewardsUSDCUser2 = 0n;
          let totalRewardsMELDUser2 = 0n;

          for (let epoch = 2; epoch < currentEpoch; epoch++) {
            const rewards = {
              assetRewards: await convertToCurrencyDecimals(
                await usdc.getAddress(),
                rewardsAmountUSDC[epoch - 2]
              ),
              meldRewards: await convertToCurrencyDecimals(
                await meld.getAddress(),
                rewardsAmountMeld[epoch - 2]
              ),
            };
            await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);
            const globalMinStakedAmountRewardsEpoch =
              await ybStorage.getMinStakedAmountPerEpoch(epoch);
            totalRewardsUSDCUser1 +=
              (rewards.assetRewards * stakeAmount1) /
              globalMinStakedAmountRewardsEpoch;
            totalRewardsMELDUser1 +=
              (rewards.meldRewards * stakeAmount1) /
              globalMinStakedAmountRewardsEpoch;
            totalRewardsUSDCUser2 +=
              (rewards.assetRewards * stakeAmount2) /
              globalMinStakedAmountRewardsEpoch;
            totalRewardsMELDUser2 +=
              (rewards.meldRewards * stakeAmount2) /
              globalMinStakedAmountRewardsEpoch;
          }

          // Update unclaimed rewards

          await ybStaking.updateUnclaimedRewards(user1);
          await ybStaking.updateUnclaimedRewards(user2);

          // Check user state

          expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
            totalRewardsUSDCUser1,
            totalRewardsMELDUser1,
          ]);

          expect(await ybStorage.getStakerUnclaimedRewards(user2)).to.eqls([
            totalRewardsUSDCUser2,
            totalRewardsMELDUser2,
          ]);

          expect(
            await ybStorage.getStakerLastEpochRewardsUpdated(user1)
          ).to.be.equal(currentEpoch - 1n);

          expect(
            await ybStorage.getStakerLastEpochRewardsUpdated(user2)
          ).to.be.equal(currentEpoch - 1n);

          expect(
            await ybStorage.getStakerLastEpochRewardsUpdated(user1)
          ).to.be.equal(currentEpoch - 1n);

          expect(
            await ybStorage.getStakerLastEpochRewardsUpdated(user2)
          ).to.be.equal(currentEpoch - 1n);
        });
      }); // End of Happy path multiple users updateUnclaimedRewards
    }); // End of multiple users updateUnclaimedRewards
  }); // End of updateUnclaimedRewards

  context("claimRewards", function () {
    context("Happy test cases", function () {
      it("Should not emit any event when claiming rewards for a user with no rewards", async function () {
        const { user1, usdc, ybStaking, mockYBCaller } =
          await loadFixture(rewardsFixture);

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "22000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        await expect(ybStaking.connect(user1).claimRewards())
          .to.not.emit(ybStaking, "UnclaimedRewardsUpdated")
          .to.not.emit(ybStaking, "RewardsClaimed")
          .to.not.emit(ybStaking, "TokenWithdrawn");
      });

      it("Should emit the right events when claiming rewards for a user with rewards", async function () {
        const {
          user1,
          rewardsSetter,
          ybStaking,
          ybStorage,
          mockYBCaller,
          epochSize,
          rewards,
          usdc,
          meld,
        } = await loadFixture(rewardsFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "20000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3 and set rewards for epoch 2
        await time.increase(epochSize * 2n);
        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(3n);

        const rewardsEpoch = currentEpoch - 1n;

        await ybStaking
          .connect(rewardsSetter)
          .setRewards(rewards, rewardsEpoch);

        // Claim rewards

        await expect(ybStaking.connect(user1).claimRewards())
          .to.emit(ybStaking, "UnclaimedRewardsUpdated")
          .withArgs(
            user1.address,
            0n,
            0n,
            rewards.assetRewards,
            rewards.meldRewards,
            rewardsEpoch,
            rewardsEpoch
          )
          .to.emit(ybStaking, "RewardsClaimed")
          .withArgs(
            user1.address,
            user1.address,
            rewards.assetRewards,
            rewards.meldRewards
          )
          .to.emit(ybStaking, "TokenWithdrawn")
          .withArgs(
            await usdc.getAddress(),
            user1.address,
            rewards.assetRewards
          )
          .to.emit(ybStaking, "TokenWithdrawn")
          .withArgs(
            await meld.getAddress(),
            user1.address,
            rewards.meldRewards
          );
      });

      it("Should not emit events after claiming rewards twice", async function () {
        const { user1, usdc, ybStaking, mockYBCaller } =
          await loadFixture(rewardsFixture);

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "22000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        await expect(ybStaking.connect(user1).claimRewards())
          .to.not.emit(ybStaking, "UnclaimedRewardsUpdated")
          .to.not.emit(ybStaking, "RewardsClaimed")
          .to.not.emit(ybStaking, "TokenWithdrawn");
      });

      it("Should have the correct state after claiming rewards if there are no rewards available", async function () {
        const { user1, usdc, meld, ybStaking, mockYBCaller, ybStorage } =
          await loadFixture(rewardsFixture);

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "14000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        await ybStaking.connect(user1).claimRewards();

        expect(await usdc.balanceOf(user1)).to.be.equal(0n);
        expect(await meld.balanceOf(user1)).to.be.equal(0n);

        expect(await usdc.balanceOf(ybStaking)).to.be.equal(0n);
        expect(await meld.balanceOf(ybStaking)).to.be.equal(0n);

        expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
          0n,
          0n,
        ]);
      });

      it("Should have the correct state after claiming rewards", async function () {
        const {
          user1,
          rewardsSetter,
          ybStaking,
          ybStorage,
          mockYBCaller,
          epochSize,
          rewards,
          usdc,
          meld,
        } = await loadFixture(rewardsFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "20000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3 and set rewards for epoch 2
        await time.increase(epochSize * 2n);
        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(3n);

        const rewardsEpoch = currentEpoch - 1n;

        await ybStaking
          .connect(rewardsSetter)
          .setRewards(rewards, rewardsEpoch);

        // Claim rewards

        await ybStaking.connect(user1).claimRewards();

        expect(await usdc.balanceOf(user1)).to.be.equal(rewards.assetRewards);
        expect(await meld.balanceOf(user1)).to.be.equal(rewards.meldRewards);

        expect(await usdc.balanceOf(ybStaking)).to.be.equal(0n);
        expect(await meld.balanceOf(ybStaking)).to.be.equal(0n);

        expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
          0n,
          0n,
        ]);
      });

      it("Should have the correct state after claiming rewards for two epochs in a row", async function () {
        const {
          user1,
          rewardsSetter,
          ybStaking,
          ybStorage,
          mockYBCaller,
          epochSize,
          rewards,
          usdc,
          meld,
        } = await loadFixture(rewardsFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "30000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3 and set rewards for epoch 2
        await time.increase(epochSize * 2n);
        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(3n);

        const rewardsEpoch = currentEpoch - 1n;

        await ybStaking
          .connect(rewardsSetter)
          .setRewards(rewards, rewardsEpoch);

        expect(await ybStorage.getStakerCumulativeRewards(user1)).eqls([
          0n,
          0n,
        ]);

        // Claim rewards

        await ybStaking.connect(user1).claimRewards();

        expect(await ybStorage.getStakerCumulativeRewards(user1)).eqls([
          rewards.assetRewards,
          rewards.meldRewards,
        ]);

        // Advance to epoch 4 and set rewards for epoch 3
        await time.increase(epochSize);
        const newCurrentEpoch = await ybStorage.getCurrentEpoch();

        expect(newCurrentEpoch).to.be.equal(4n);

        const newRewardsEpoch = newCurrentEpoch - 1n;

        const newRewards = {
          assetRewards: await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "530"
          ),
          meldRewards: await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1600"
          ),
        };

        await ybStaking
          .connect(rewardsSetter)
          .setRewards(newRewards, newRewardsEpoch);

        // Claim rewards

        await ybStaking.connect(user1).claimRewards();

        expect(await usdc.balanceOf(user1)).to.be.equal(
          rewards.assetRewards + newRewards.assetRewards
        );
        expect(await meld.balanceOf(user1)).to.be.equal(
          rewards.meldRewards + newRewards.meldRewards
        );

        expect(await usdc.balanceOf(ybStaking)).to.be.equal(0n);
        expect(await meld.balanceOf(ybStaking)).to.be.equal(0n);

        expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
          0n,
          0n,
        ]);

        expect(await ybStorage.getStakerCumulativeRewards(user1)).eqls([
          rewards.assetRewards + newRewards.assetRewards,
          rewards.meldRewards + newRewards.meldRewards,
        ]);
      });

      it("Should have the correct state after claiming rewards for different epochs together", async function () {
        const {
          user1,
          rewardsSetter,
          ybStaking,
          ybStorage,
          mockYBCaller,
          epochSize,
          usdc,
          meld,
        } = await loadFixture(rewardsFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "30000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 5 and set rewards for epoch 2-4
        await time.increase(epochSize * 2n);
        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(3n);

        const rewardsAmountUSDC = ["250", "320", "410"];
        const rewardsAmountMeld = ["1000", "1200", "1500"];

        let totalRewardsUSDC = 0n;
        let totalRewardsMELD = 0n;

        for (let epoch = 2; epoch < currentEpoch; epoch++) {
          const rewards = {
            assetRewards: await convertToCurrencyDecimals(
              await usdc.getAddress(),
              rewardsAmountUSDC[epoch - 2]
            ),
            meldRewards: await convertToCurrencyDecimals(
              await meld.getAddress(),
              rewardsAmountMeld[epoch - 2]
            ),
          };
          await ybStaking.connect(rewardsSetter).setRewards(rewards, epoch);
          totalRewardsUSDC += rewards.assetRewards;
          totalRewardsMELD += rewards.meldRewards;
        }

        expect(await ybStorage.getStakerCumulativeRewards(user1)).eqls([
          0n,
          0n,
        ]);

        // Claim rewards

        await ybStaking.connect(user1).claimRewards();

        expect(await usdc.balanceOf(user1)).to.be.equal(totalRewardsUSDC);
        expect(await meld.balanceOf(user1)).to.be.equal(totalRewardsMELD);

        expect(await usdc.balanceOf(ybStaking)).to.be.equal(0n);
        expect(await meld.balanceOf(ybStaking)).to.be.equal(0n);

        expect(await ybStorage.getStakerUnclaimedRewards(user1)).to.eqls([
          0n,
          0n,
        ]);
        expect(await ybStorage.getStakerCumulativeRewards(user1)).eqls([
          totalRewardsUSDC,
          totalRewardsMELD,
        ]);
      });

      it("Should be able to claim rewards on behalf of a user using genius loan", async function () {
        const {
          addressesProvider,
          lendingPool,
          yieldBoostStakingUSDC,
          usdc,
          meld,
          depositor,
          rando,
          rewardsSetter,
          ybStorage,
          epochSize,
          rewards,
        } = await loadFixture(realProtocolRewards);
        // Advance to epoch 3 and set rewards for epoch 2
        await time.increase(epochSize * 2n);
        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(3n);

        const rewardsEpoch = currentEpoch - 1n;

        await yieldBoostStakingUSDC
          .connect(rewardsSetter)
          .setRewards(rewards, rewardsEpoch);

        // Grant genius role to rando
        await addressesProvider.grantRole(
          await addressesProvider.GENIUS_LOAN_ROLE(),
          rando
        );

        // Accept genius role
        await lendingPool.connect(depositor).setUserAcceptGeniusLoan(true);

        const prevDepositorUsdcBalance = await usdc.balanceOf(depositor);
        const prevDepositorMeldBalance = await meld.balanceOf(depositor);

        // Claim rewards
        await yieldBoostStakingUSDC
          .connect(rando)
          .claimRewardsOnBehalfOf(depositor);

        expect(await usdc.balanceOf(depositor)).to.be.equal(
          prevDepositorUsdcBalance
        );
        expect(await meld.balanceOf(depositor)).to.be.equal(
          prevDepositorMeldBalance
        );

        expect(await usdc.balanceOf(rando)).to.be.equal(rewards.assetRewards);
        expect(await meld.balanceOf(rando)).to.be.equal(rewards.meldRewards);

        expect(await usdc.balanceOf(yieldBoostStakingUSDC)).to.be.equal(0n);
        expect(await meld.balanceOf(yieldBoostStakingUSDC)).to.be.equal(0n);

        expect(await ybStorage.getStakerUnclaimedRewards(depositor)).to.eqls([
          0n,
          0n,
        ]);
      });
    }); // End of Happy test cases claimRewards

    context("Error test cases", function () {
      it("Should revert when trying to claim rewards for a non-staker", async function () {
        const { rando, ybStaking } = await loadFixture(rewardsFixture);

        await expect(
          ybStaking.connect(rando).claimRewards()
        ).to.be.revertedWith(ProtocolErrors.YB_STAKER_DOES_NOT_EXIST);
      });

      it("Should revert when trying to claim rewards on behalf of a user without the genius loan role", async function () {
        const {
          addressesProvider,
          lendingPool,
          yieldBoostStakingUSDC,
          depositor,
          rando,
          rewardsSetter,
          ybStorage,
          epochSize,
          rewards,
        } = await loadFixture(realProtocolRewards);
        // Advance to epoch 3 and set rewards for epoch 2
        await time.increase(epochSize * 2n);
        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(3n);

        const rewardsEpoch = currentEpoch - 1n;

        await yieldBoostStakingUSDC
          .connect(rewardsSetter)
          .setRewards(rewards, rewardsEpoch);

        // Accept genius role
        await lendingPool.connect(depositor).setUserAcceptGeniusLoan(true);

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.GENIUS_LOAN_ROLE()}`;

        // Claim rewards
        await expect(
          yieldBoostStakingUSDC.connect(rando).claimRewardsOnBehalfOf(depositor)
        ).to.be.revertedWith(expectedException);
      });

      it("Should be able to claim rewards on behalf of a user using that has not accepted genius loan", async function () {
        const {
          addressesProvider,
          yieldBoostStakingUSDC,
          depositor,
          rando,
          rewardsSetter,
          ybStorage,
          epochSize,
          rewards,
        } = await loadFixture(realProtocolRewards);
        // Advance to epoch 3 and set rewards for epoch 2
        await time.increase(epochSize * 2n);
        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(3n);

        const rewardsEpoch = currentEpoch - 1n;

        await yieldBoostStakingUSDC
          .connect(rewardsSetter)
          .setRewards(rewards, rewardsEpoch);

        // Grant genius role to rando
        await addressesProvider.grantRole(
          await addressesProvider.GENIUS_LOAN_ROLE(),
          rando
        );

        // Claim rewards
        await expect(
          yieldBoostStakingUSDC.connect(rando).claimRewardsOnBehalfOf(depositor)
        ).to.be.revertedWith(ProtocolErrors.YB_USER_NOT_ACCEPT_GENIUS_LOAN);
      });
    }); // End of Error test cases claimRewards
  }); // End of claimRewards

  context("Stuck rewards", function () {
    context("Happy test cases", function () {
      it("Should not emit an event if staker leaves before rewards are assigned but no full epochs without rewards have passed", async function () {
        const { user1, ybStaking, mockYBCaller, epochSize, usdc } =
          await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "23000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        await time.increase(epochSize);

        // Staker leaves before rewards are set but doesn't affect the user

        await expect(mockYBCaller.setStakeAmount(user1, 0n)).to.not.emit(
          ybStaking,
          "StuckRewardsAvoided"
        );
      });
      it("Should not emit an event if staker leaves and rewards are assigned", async function () {
        const {
          user1,
          ybStaking,
          mockYBCaller,
          epochSize,
          usdc,
          rewards,
          rewardsSetter,
        } = await loadFixture(rewardsFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "120000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        await time.increase(epochSize * 2n);

        // Set rewards for epoch 2

        await ybStaking.connect(rewardsSetter).setRewards(rewards, 2n);

        // Staker leaves

        await expect(mockYBCaller.setStakeAmount(user1, 0n)).to.not.emit(
          ybStaking,
          "StuckRewardsAvoided"
        );
      });

      it("Should emit an event when removing stakedAmountPerEpoch from staker and global position if staker leaves before rewards are assigned", async function () {
        const { user1, ybStaking, mockYBCaller, ybStorage, epochSize, usdc } =
          await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "20000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3
        await time.increase(epochSize * 2n);

        // Rewards have not been set for epoch 2

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(3n);

        // Staker leaves before rewards are set

        await expect(mockYBCaller.setStakeAmount(user1, 0n))
          .to.emit(ybStaking, "StuckRewardsAvoided")
          .withArgs(user1.address, currentEpoch - 1n, stakeAmount, stakeAmount);
      });

      it("Should emit events when removing stakedAmountPerEpoch from staker and global position if staker leaves before rewards are assigned for multiple epochs", async function () {
        const { user1, ybStaking, mockYBCaller, ybStorage, epochSize, usdc } =
          await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "20000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 5
        await time.increase(epochSize * 4n);

        // Rewards have not been set for epoch 2-4

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(5n);

        // Staker leaves before rewards are set

        await expect(mockYBCaller.setStakeAmount(user1, 0n))
          .to.emit(ybStaking, "StuckRewardsAvoided")
          .withArgs(user1.address, 2n, stakeAmount, stakeAmount)
          .to.emit(ybStaking, "StuckRewardsAvoided")
          .withArgs(user1.address, 3n, stakeAmount, stakeAmount)
          .to.emit(ybStaking, "StuckRewardsAvoided")
          .withArgs(user1.address, 4n, stakeAmount, stakeAmount);
      });

      it("Should emit events when removing stakedAmountPerEpoch from staker and global position if staker leaves before rewards are assigned for multiple epochs with different amounts", async function () {
        const { user1, ybStaking, mockYBCaller, ybStorage, epochSize, usdc } =
          await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "20000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance epoch
        await time.increase(epochSize);

        // Update stake

        const stakeAmountEpoch2 = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "3000"
        );
        await mockYBCaller.setStakeAmount(user1, stakeAmountEpoch2);

        // Advance epoch
        await time.increase(epochSize);

        // Update stake

        const stakeAmountEpoch3 = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "4100"
        );
        await mockYBCaller.setStakeAmount(user1, stakeAmountEpoch3);

        // Advance epoch
        await time.increase(epochSize);

        const currentEpoch = await ybStorage.getCurrentEpoch();
        expect(currentEpoch).to.be.equal(4n);

        // Rewards have not been set for epoch 2 and 3

        // Staker leaves before rewards are set

        await expect(mockYBCaller.setStakeAmount(user1, 0n))
          .to.emit(ybStaking, "StuckRewardsAvoided")
          .withArgs(user1.address, 2n, stakeAmountEpoch2, stakeAmountEpoch2)
          .to.emit(ybStaking, "StuckRewardsAvoided")
          .withArgs(user1.address, 3n, stakeAmountEpoch2, stakeAmountEpoch3);
      });
      it("Should remove stakedAmountPerEpoch from staker and global position if staker leaves before rewards are assigned", async function () {
        const {
          user1,

          mockYBCaller,
          ybStorage,
          epochSize,
          usdc,
        } = await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "20000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3
        await time.increase(epochSize * 2n);

        // Rewards have not been set for epoch 2

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(3n);

        // Staker leaves before rewards are set

        await mockYBCaller.setStakeAmount(user1, 0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(0n);
      });

      it("Should remove stakedAmountPerEpoch from staker and global position if staker leaves before rewards are assigned for multiple epochs", async function () {
        const {
          user1,

          mockYBCaller,
          ybStorage,
          epochSize,
          usdc,
        } = await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "6000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 5
        await time.increase(epochSize * 4n);

        // Rewards have not been set for epoch 2-4

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(5n);

        // Staker leaves before rewards are set

        await mockYBCaller.setStakeAmount(user1, 0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 4n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 4n)
        ).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(4n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(4n)).to;
      });

      it("Should remove stakedAmountPerEpoch from staker and global position if staker leaves before rewards are assigned for multiple epochs with different amounts", async function () {
        const {
          user1,

          mockYBCaller,
          ybStorage,
          epochSize,
          usdc,
        } = await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "6000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance epoch
        await time.increase(epochSize);

        // Update stake

        const stakeAmountEpoch2 = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "3000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmountEpoch2);

        // Advance epoch

        await time.increase(epochSize);

        // Update stake

        const stakeAmountEpoch3 = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "4100"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmountEpoch3);

        // Advance epoch

        await time.increase(epochSize);

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(4n);

        // Rewards have not been set for epoch 2 and 3

        // Staker leaves before rewards are set

        await mockYBCaller.setStakeAmount(user1, 0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 4n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 4n)
        ).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(4n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(4n)).to.be.equal(0n);
      });

      it("Should remove stakedAmountPerEpoch from staker and global position if staker leaves before rewards are assigned for multiple epochs with different amounts and multiple users", async function () {
        const { user1, user2, mockYBCaller, ybStorage, epochSize, usdc } =
          await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "6000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance epoch
        await time.increase(epochSize);

        // Update stake

        const stakeAmountEpoch2 = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "3000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmountEpoch2);

        // Advance epoch

        await time.increase(epochSize);

        // Update stake

        const stakeAmountEpoch3 = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "4100"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmountEpoch3);

        const stakeAmountEpoch3User2 = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "8700"
        );

        await mockYBCaller.setStakeAmount(user2, stakeAmountEpoch3User2);

        // Advance epoch

        await time.increase(epochSize);

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(currentEpoch).to.be.equal(4n);

        // Rewards have not been set for epoch 2 and 3

        // Staker leaves before rewards are set

        await mockYBCaller.setStakeAmount(user1, 0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 4n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 4n)
        ).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(
          stakeAmountEpoch3User2
        );

        expect(await ybStorage.getMinStakedAmountPerEpoch(4n)).to.be.equal(
          stakeAmountEpoch3User2
        );
        expect(await ybStorage.getLastStakedAmountPerEpoch(4n)).to.be.equal(
          stakeAmountEpoch3User2
        );
      });
    }); // End of Happy test Stuck rewards
  }); // End of Stuck rewards

  context("updateStakerPreviousEpochs(address)", function () {
    context("Happy test cases", function () {
      it("Should update staker previous epochs for a staker", async function () {
        const { user1, ybStaking, mockYBCaller, ybStorage, epochSize, usdc } =
          await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "23000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3

        await time.increase(epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);

        // Update staker previous epochs

        await ybStaking["updateStakerPreviousEpochs(address)"](user1);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(stakeAmount);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(stakeAmount);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerLastEpochStakingUpdated(user1)
        ).to.be.equal(currentEpoch);
      });
    }); // End of Happy test cases updateStakerPreviousEpochs(address)

    context("Error test cases", function () {
      it("Should revert when trying to update staker previous epochs for a non-staker", async function () {
        const { rando, ybStaking } = await loadFixture(rewardsFixture);

        await expect(
          ybStaking["updateStakerPreviousEpochs(address)"](rando)
        ).to.be.revertedWith(ProtocolErrors.YB_STAKER_DOES_NOT_EXIST);
      });
    }); // End of Error test cases updateStakerPreviousEpochs(address)
  }); // End of updateStakerPreviousEpochs(address)

  context("updateStakerPreviousEpochs(address,uint256)", function () {
    context("Happy test cases", function () {
      it("Should update staker previous epochs for a staker until current epoch", async function () {
        const { user1, ybStaking, mockYBCaller, ybStorage, epochSize, usdc } =
          await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "23000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3

        await time.increase(epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);

        // Update staker previous epochs

        await ybStaking["updateStakerPreviousEpochs(address,uint256)"](
          user1,
          currentEpoch
        );

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(stakeAmount);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(stakeAmount);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerLastEpochStakingUpdated(user1)
        ).to.be.equal(currentEpoch);
      });
      it("Should update staker previous epochs for a staker until an epoch before current one", async function () {
        const { user1, ybStaking, mockYBCaller, ybStorage, epochSize, usdc } =
          await loadFixture(stakingFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "23000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3

        await time.increase(epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);

        // Update staker previous epochs

        await ybStaking["updateStakerPreviousEpochs(address,uint256)"](
          user1,
          currentEpoch - 1n
        );

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 1n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(stakeAmount);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
        ).to.be.equal(stakeAmount);

        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
        ).to.be.equal(0n);

        expect(
          await ybStorage.getStakerLastEpochStakingUpdated(user1)
        ).to.be.equal(currentEpoch - 1n);
      });
    }); // End of Happy test cases updateStakerPreviousEpochs(address,uint256)

    context("Error test cases", function () {
      it("Should revert when trying to update staker previous epochs for a non-staker", async function () {
        const { rando, ybStaking } = await loadFixture(rewardsFixture);

        await expect(
          ybStaking["updateStakerPreviousEpochs(address,uint256)"](rando, 1n)
        ).to.be.revertedWith(ProtocolErrors.YB_STAKER_DOES_NOT_EXIST);
      });

      it("Should revert when trying to update staker previous epochs for a staker with an epoch higher than the current epoch", async function () {
        const { user1, ybStaking, mockYBCaller, usdc } =
          await loadFixture(rewardsFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "23000"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        await expect(
          ybStaking["updateStakerPreviousEpochs(address,uint256)"](user1, 2n)
        ).to.be.revertedWith(ProtocolErrors.YB_INVALID_EPOCH);
      });
    }); // End of Error test cases updateStakerPreviousEpochs(address,uint256)
  }); // End of updateStakerPreviousEpochs(address,uint256)

  context("updateGlobalPreviousEpochs(uint256)", function () {
    context("Happy test cases", function () {
      it("Should update global previous epochs until current epoch", async function () {
        const { ybStaking, mockYBCaller, ybStorage, user1, usdc, epochSize } =
          await loadFixture(rewardsFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "1700"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3

        await time.increase(epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(await ybStorage.getMinStakedAmountPerEpoch(1n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(1n)).to.be.equal(
          stakeAmount
        );

        expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(0n);

        // Update global previous epochs

        await ybStaking.updateGlobalPreviousEpochs(currentEpoch);

        expect(await ybStorage.getMinStakedAmountPerEpoch(1n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(1n)).to.be.equal(
          stakeAmount
        );

        expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(
          stakeAmount
        );
        expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(
          stakeAmount
        );

        expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(
          stakeAmount
        );
        expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(
          stakeAmount
        );

        expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
          currentEpoch
        );
      });
      it("Should update global previous epochs for an epoch lower than the current epoch", async function () {
        const { ybStaking, ybStorage, mockYBCaller, user1, usdc, epochSize } =
          await loadFixture(rewardsFixture);

        // Set stake amount for epoch1

        const stakeAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "1700"
        );

        await mockYBCaller.setStakeAmount(user1, stakeAmount);

        // Advance to epoch 3

        await time.increase(epochSize * 2n);

        const currentEpoch = await ybStorage.getCurrentEpoch();

        expect(await ybStorage.getMinStakedAmountPerEpoch(1n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(1n)).to.be.equal(
          stakeAmount
        );

        expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(0n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(0n);

        // Update global previous epochs

        await ybStaking.updateGlobalPreviousEpochs(currentEpoch - 1n);

        expect(await ybStorage.getMinStakedAmountPerEpoch(1n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(1n)).to.be.equal(
          stakeAmount
        );

        expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(
          stakeAmount
        );
        expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(
          stakeAmount
        );

        expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(0n);

        expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(
          currentEpoch - 1n
        );
      });
    }); // End of Happy test cases updateGlobalPreviousEpochs(uint256)

    context("Error test cases", function () {
      it("Should revert when trying to update global previous epochs for an epoch higher than the current epoch", async function () {
        const { ybStaking } = await loadFixture(rewardsFixture);

        await expect(
          ybStaking.updateGlobalPreviousEpochs(2n)
        ).to.be.revertedWith(ProtocolErrors.YB_INVALID_EPOCH);
      });
    }); // End of Error test cases updateGlobalPreviousEpochs(uint256)
  }); // End of updateGlobalPreviousEpochs(uint256)

  context("Epochs", function () {
    it("Should get the right epoch values", async function () {
      const { ybStorage } = await loadFixture(stakingFixture);

      expect(await ybStorage.getEpoch(0)).to.equal(0n);
      expect(
        await ybStorage.getEpoch((await ybStorage.getInitTimestamp()) - 10n)
      ).to.equal(0n);

      expect(await ybStorage.getEpochStart(0)).to.equal(0n);

      expect(await ybStorage.getEpochEnd(0)).to.equal(0n);

      expect(await ybStorage.getEpochEnd(7)).to.equal(
        (await ybStorage.getEpochStart(7)) + (await ybStorage.getEpochSize())
      );
    });
  }); // End of Epochs

  context("More complex scenarios", function () {
    it("Should have the right values for a staker that leaves and then comes back", async function () {
      const { user1, usdc, mockYBCaller, ybStorage, epochSize } =
        await loadFixture(stakingFixture);

      // Advance to epoch 3

      await time.increase(epochSize * 2n);

      const epoch3 = await ybStorage.getCurrentEpoch();
      expect(epoch3).to.be.equal(3n);

      // Set stake amount

      const stakeAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "23000"
      );

      await mockYBCaller.setStakeAmount(user1, stakeAmount);

      // Check values

      expect(await ybStorage.isStaker(user1)).to.be.equal(true);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 1n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 1n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
      ).to.be.equal(stakeAmount);

      expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
        stakeAmount
      );

      expect(
        await ybStorage.getStakerLastEpochStakingUpdated(user1)
      ).to.be.equal(3n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(1n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(1n)).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(
        stakeAmount
      );

      expect(await ybStorage.getTotalStakedAmount()).to.be.equal(stakeAmount);

      // Advance 2 epochs

      await time.increase(epochSize * 2n);

      const epoch5 = await ybStorage.getCurrentEpoch();
      expect(epoch5).to.be.equal(5n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 4n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 4n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 5n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 5n)
      ).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(4n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(4n)).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(5n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(5n)).to.be.equal(0n);

      // Staker leaves

      await mockYBCaller.setStakeAmount(user1, 0n);

      // Since there are no rewards, all min and last info should be 0 (stuck rewards avoidance)

      expect(await ybStorage.isStaker(user1)).to.be.equal(false);

      for (let i = 1n; i <= epoch5; i++) {
        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, i)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, i)
        ).to.be.equal(0n);
        expect(await ybStorage.getMinStakedAmountPerEpoch(i)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(i)).to.be.equal(0n);
      }

      expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(0n);
      expect(await ybStorage.getTotalStakedAmount()).to.be.equal(0n);

      // Advance 3 epochs

      await time.increase(epochSize * 3n);

      const epoch8 = await ybStorage.getCurrentEpoch();
      expect(epoch8).to.be.equal(8n);

      // Staker comes back

      const newStakeAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "500"
      );

      await mockYBCaller.setStakeAmount(user1, newStakeAmount);

      // Check values

      expect(await ybStorage.isStaker(user1)).to.be.equal(true);

      for (let i = 1n; i < epoch8; i++) {
        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, i)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, i)
        ).to.be.equal(0n);
        expect(await ybStorage.getMinStakedAmountPerEpoch(i)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(i)).to.be.equal(0n);
      }

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, epoch8)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, epoch8)
      ).to.be.equal(newStakeAmount);

      expect(await ybStorage.getMinStakedAmountPerEpoch(epoch8)).to.be.equal(
        0n
      );
      expect(await ybStorage.getLastStakedAmountPerEpoch(epoch8)).to.be.equal(
        newStakeAmount
      );

      expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
        newStakeAmount
      );
      expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
        newStakeAmount
      );
    });

    it("Should have the right values for a staker that leaves and then comes back but with rewards set", async function () {
      const {
        user1,
        rewardsSetter,
        rewards,
        usdc,
        ybStaking,
        ybStorage,
        mockYBCaller,
        epochSize,
      } = await loadFixture(rewardsFixture);

      // Advance to epoch 3

      await time.increase(epochSize * 2n);

      const epoch3 = await ybStorage.getCurrentEpoch();
      expect(epoch3).to.be.equal(3n);

      // Set stake amount

      const stakeAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "3100"
      );

      await mockYBCaller.setStakeAmount(user1, stakeAmount);

      // Check values

      expect(await ybStorage.isStaker(user1)).to.be.equal(true);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 1n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 1n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
      ).to.be.equal(stakeAmount);

      expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
        stakeAmount
      );

      expect(
        await ybStorage.getStakerLastEpochStakingUpdated(user1)
      ).to.be.equal(3n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(1n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(1n)).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(
        stakeAmount
      );

      expect(await ybStorage.getTotalStakedAmount()).to.be.equal(stakeAmount);

      // Advance 2 epochs

      await time.increase(epochSize * 2n);

      const epoch5 = await ybStorage.getCurrentEpoch();
      expect(epoch5).to.be.equal(5n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 4n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 4n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 5n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 5n)
      ).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(4n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(4n)).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(5n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(5n)).to.be.equal(0n);

      // Set rewards

      for (let i = 2n; i < epoch5; i++) {
        await ybStaking.connect(rewardsSetter).setRewards(rewards, i);
      }

      // Staker leaves

      await expect(mockYBCaller.setStakeAmount(user1, 0n)).not.to.emit(
        ybStaking,
        "StuckRewardsAvoided"
      );

      // Since there are rewards, all min and last info should stay the same, except for current epoch

      expect(await ybStorage.isStaker(user1)).to.be.equal(false);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
      ).to.be.equal(stakeAmount);

      expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(
        stakeAmount
      );

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 4n)
      ).to.be.equal(stakeAmount);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 4n)
      ).to.be.equal(stakeAmount);

      expect(await ybStorage.getMinStakedAmountPerEpoch(4n)).to.be.equal(
        stakeAmount
      );
      expect(await ybStorage.getLastStakedAmountPerEpoch(4n)).to.be.equal(
        stakeAmount
      );

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 5n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 5n)
      ).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(5n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(5n)).to.be.equal(0n);

      expect(await ybStorage.getLastEpochRewardsUpdated()).to.be.equal(4n);

      expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(0n);
      expect(await ybStorage.getTotalStakedAmount()).to.be.equal(0n);

      // Advance 3 epochs

      await time.increase(epochSize * 3n);

      const epoch8 = await ybStorage.getCurrentEpoch();
      expect(epoch8).to.be.equal(8n);

      // Staker comes back

      const newStakeAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "1500"
      );

      await mockYBCaller.setStakeAmount(user1, newStakeAmount);

      // Check values

      expect(await ybStorage.isStaker(user1)).to.be.equal(true);

      for (let i = 5n; i < epoch8; i++) {
        expect(
          await ybStorage.getStakerMinStakedAmountPerEpoch(user1, i)
        ).to.be.equal(0n);
        expect(
          await ybStorage.getStakerLastStakedAmountPerEpoch(user1, i)
        ).to.be.equal(0n);
        expect(await ybStorage.getMinStakedAmountPerEpoch(i)).to.be.equal(0n);
        expect(await ybStorage.getLastStakedAmountPerEpoch(i)).to.be.equal(0n);
      }

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, epoch8)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, epoch8)
      ).to.be.equal(newStakeAmount);

      expect(await ybStorage.getMinStakedAmountPerEpoch(epoch8)).to.be.equal(
        0n
      );
      expect(await ybStorage.getLastStakedAmountPerEpoch(epoch8)).to.be.equal(
        newStakeAmount
      );

      expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
        newStakeAmount
      );
      expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
        newStakeAmount
      );

      expect(
        await ybStorage.getStakerLastEpochStakingUpdated(user1)
      ).to.be.equal(epoch8);

      expect(await ybStorage.getLastEpochStakingUpdated()).to.be.equal(epoch8);
    });

    it("Audit 12: Should have the right values for the global min, if a new staker comes and an old one leaves", async function () {
      const { user1, user2, user3, usdc, mockYBCaller, ybStorage, epochSize } =
        await loadFixture(stakingFixture);

      // Advance to epoch 3

      await time.increase(epochSize * 2n);

      const epoch3 = await ybStorage.getCurrentEpoch();
      expect(epoch3).to.be.equal(3n);

      // Set stake amount for user 1 and user 2

      const stakeAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "1000"
      );

      await mockYBCaller.setStakeAmount(user1, stakeAmount);
      await mockYBCaller.setStakeAmount(user2, stakeAmount);

      // Check values

      // Check that users are stakers
      expect(await ybStorage.isStaker(user1)).to.be.equal(true);
      expect(await ybStorage.isStaker(user2)).to.be.equal(true);

      // Check that user 1 has the right values
      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 1n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 1n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 2n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 2n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user1, 3n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user1, 3n)
      ).to.be.equal(stakeAmount);

      expect(await ybStorage.getStakerStakedAmount(user1)).to.be.equal(
        stakeAmount
      );
      expect(
        await ybStorage.getStakerLastEpochStakingUpdated(user1)
      ).to.be.equal(3n);

      // Check that user 2 has the right values
      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user2, 1n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user2, 1n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user2, 2n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user2, 2n)
      ).to.be.equal(0n);

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user2, 3n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user2, 3n)
      ).to.be.equal(stakeAmount);

      expect(await ybStorage.getStakerStakedAmount(user2)).to.be.equal(
        stakeAmount
      );
      expect(
        await ybStorage.getStakerLastEpochStakingUpdated(user2)
      ).to.be.equal(3n);

      // Check global values

      expect(await ybStorage.getMinStakedAmountPerEpoch(1n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(1n)).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(2n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(2n)).to.be.equal(0n);

      expect(await ybStorage.getMinStakedAmountPerEpoch(3n)).to.be.equal(0n);
      expect(await ybStorage.getLastStakedAmountPerEpoch(3n)).to.be.equal(
        stakeAmount * 2n
      );

      expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
        stakeAmount * 2n
      );

      // Advance 2 epochs

      await time.increase(epochSize * 2n);

      const epoch5 = await ybStorage.getCurrentEpoch();
      expect(epoch5).to.be.equal(5n);

      // Set stake amount for user 3
      await mockYBCaller.setStakeAmount(user3, stakeAmount);

      // Staker 2 leaves
      await mockYBCaller.setStakeAmount(user2, 0n);

      // Check values for user 2 - should be empty
      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user2, 5n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user2, 5n)
      ).to.be.equal(0n);

      // Check values for user 3 - Min=0, last=amount

      expect(
        await ybStorage.getStakerMinStakedAmountPerEpoch(user3, 5n)
      ).to.be.equal(0n);
      expect(
        await ybStorage.getStakerLastStakedAmountPerEpoch(user3, 5n)
      ).to.be.equal(stakeAmount);

      // Check global values

      // Min should only contain user 1, since user 2 left and 3 just joined
      expect(await ybStorage.getMinStakedAmountPerEpoch(5n)).to.be.equal(
        stakeAmount
      );

      // Last should contain user 1 and 3
      expect(await ybStorage.getLastStakedAmountPerEpoch(5n)).to.be.equal(
        stakeAmount * 2n
      );

      // Total should contain user 1 and 3
      expect(await ybStorage.getTotalStakedAmount()).to.be.equal(
        stakeAmount * 2n
      );
    });
  }); // End of More complex scenarios
});

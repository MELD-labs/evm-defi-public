import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ProtocolErrors } from "./helpers/types";
import { ZeroAddress } from "ethers";
import { MeldBankerNFT, MeldBankerNFTMetadata } from "../typechain-types";
import {
  allocateAndApproveTokens,
  deployLibraries,
  setUpTestFixture,
} from "./helpers/utils/utils";

describe("MeldBankerNft", function () {
  async function setUpMinimalFixture() {
    const [deployer, user, rando, bankerAdmin] = await ethers.getSigners();

    const AddressesProvider =
      await ethers.getContractFactory("AddressesProvider");
    const addressesProvider = await AddressesProvider.deploy(deployer);

    await addressesProvider.grantRole(
      await addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE(),
      bankerAdmin
    );

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

    await addressesProvider.setLendingPool(lendingPool);

    const MeldBankerNft = await ethers.getContractFactory("MeldBankerNFT");
    const meldBankerNft = (await MeldBankerNft.deploy(
      addressesProvider
    )) as MeldBankerNFT;

    const MeldBankerNftMetadata = await ethers.getContractFactory(
      "MeldBankerNFTMetadata"
    );
    const meldBankerNftMetadata = (await MeldBankerNftMetadata.deploy(
      addressesProvider
    )) as MeldBankerNFTMetadata;

    return {
      deployer,
      user,
      rando,
      bankerAdmin,
      addressesProvider,
      meldBankerNft,
      meldBankerNftMetadata,
      AddressesProvider,
      LendingPool,
    };
  }

  async function twoAddressesProvidersFixture() {
    const setUpMinimalFixtureVars = await loadFixture(setUpMinimalFixture);
    const newAddressesProvider =
      await setUpMinimalFixtureVars.AddressesProvider.deploy(
        setUpMinimalFixtureVars.user
      );
    const newLendingPool = await setUpMinimalFixtureVars.LendingPool.deploy();
    await newLendingPool.initialize(newAddressesProvider);

    await newAddressesProvider
      .connect(setUpMinimalFixtureVars.user)
      .setLendingPool(newLendingPool);
    return {
      ...setUpMinimalFixtureVars,
      newAddressesProvider,
    };
  }

  async function twoAddressesProvidersNoLendingPoolFixture() {
    const setUpMinimalFixtureVars = await loadFixture(setUpMinimalFixture);
    const AddressesProvider =
      await ethers.getContractFactory("AddressesProvider");
    const newAddressesProvider = await AddressesProvider.deploy(
      setUpMinimalFixtureVars.user
    );
    return {
      ...setUpMinimalFixtureVars,
      newAddressesProvider,
    };
  }

  async function metadataFixture() {
    const setUpMinimalFixtureVars = await loadFixture(setUpMinimalFixture);
    const MeldBankerNftMetadata = await ethers.getContractFactory(
      "MeldBankerNFTMetadata"
    );
    const meldBankerNftMetadata = await MeldBankerNftMetadata.deploy(
      setUpMinimalFixtureVars.addressesProvider
    );
    await setUpMinimalFixtureVars.meldBankerNft.setMetadataAddress(
      meldBankerNftMetadata
    );
    return {
      ...setUpMinimalFixtureVars,
      meldBankerNftMetadata,
    };
  }

  async function nftMinterFixture() {
    const metadataFixtureVars = await loadFixture(metadataFixture);
    const MeldBankerNftMinter = await ethers.getContractFactory(
      "MeldBankerNFTMinter"
    );
    const addressesProvider = metadataFixtureVars.addressesProvider;
    await addressesProvider.setMeldBankerNFT(metadataFixtureVars.meldBankerNft);
    const meldBankerNftMinter =
      await MeldBankerNftMinter.deploy(addressesProvider);
    await addressesProvider
      .connect(metadataFixtureVars.deployer)
      .grantRole(
        await addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE(),
        meldBankerNftMinter
      );

    return {
      ...metadataFixtureVars,
      meldBankerNftMinter,
    };
  }

  async function lockedMeldBankerNFTFixture() {
    const { owner, bankerAdmin, depositor, usdc, ...contracts } =
      await setUpTestFixture();

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

    // The fixture mints tokens 1 and 2, so need to mint a different tokenId here
    const tokenId = 3n;

    await contracts.meldBankerNft
      .connect(bankerAdmin)
      .mint(depositor, tokenId, true);

    await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        depositor.address,
        true,
        tokenId
      );

    return {
      bankerAdmin,
      depositor,
      tokenId,
      ...contracts,
    };
  }

  context("MeldBankerNft", function () {
    context("Constructor", function () {
      context("Error test cases", function () {
        it("Should revert if the AddressesProvider does not have a lending pool", async function () {
          const [deployer] = await ethers.getSigners();

          const AddressesProvider =
            await ethers.getContractFactory("AddressesProvider");
          const addressesProvider = await AddressesProvider.deploy(deployer);

          const MeldBankerNft =
            await ethers.getContractFactory("MeldBankerNFT");
          await expect(
            MeldBankerNft.deploy(addressesProvider)
          ).to.be.revertedWith(ProtocolErrors.MB_INVALID_LENDING_POOL);
        });
      });
    });
    context("Mint", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right events minting a golden NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          const mintTx = await meldBankerNft
            .connect(bankerAdmin)
            .mint(user, tokenId, golden);
          await expect(mintTx)
            .to.emit(meldBankerNft, "Transfer")
            .withArgs(ZeroAddress, user.address, tokenId);

          await expect(mintTx)
            .to.emit(meldBankerNft, "Mint")
            .withArgs(bankerAdmin.address, user.address, tokenId, golden);
        });
        it("Should emit the right events minting a non-golden NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = false;

          const mintTx = await meldBankerNft
            .connect(bankerAdmin)
            .mint(user, tokenId, golden);
          await expect(mintTx)
            .to.emit(meldBankerNft, "Transfer")
            .withArgs(ZeroAddress, user.address, tokenId);

          await expect(mintTx)
            .to.emit(meldBankerNft, "Mint")
            .withArgs(bankerAdmin.address, user.address, tokenId, golden);
        });
        it("Should emit the right events minting an NFT with id > 1", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 5n;
          const golden = false;

          const mintTx = await meldBankerNft
            .connect(bankerAdmin)
            .mint(user, tokenId, golden);
          await expect(mintTx)
            .to.emit(meldBankerNft, "Transfer")
            .withArgs(ZeroAddress, user.address, tokenId);

          await expect(mintTx)
            .to.emit(meldBankerNft, "Mint")
            .withArgs(bankerAdmin.address, user.address, tokenId, golden);
        });
        it("Should have the correct values after minting a golden NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);

          expect(await meldBankerNft.ownerOf(tokenId)).to.equal(user.address);
          expect(await meldBankerNft.isGolden(tokenId)).to.equal(golden);
          expect(await meldBankerNft.exists(tokenId)).to.be.true;
          expect(await meldBankerNft.totalSupply()).to.equal(1);
          expect(await meldBankerNft.getTotalMintedNfts()).to.equal(1);
          expect(await meldBankerNft.balanceOf(user.address)).to.equal(1);
          expect(await meldBankerNft.getAllTokensByOwner(user.address)).to.eqls(
            [tokenId]
          );
          expect(
            await meldBankerNft.tokenOfOwnerByIndex(user.address, 0)
          ).to.equal(tokenId);
        });
        it("Should have the correct values after minting a non-golden NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = false;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);

          expect(await meldBankerNft.ownerOf(tokenId)).to.equal(user.address);
          expect(await meldBankerNft.isGolden(tokenId)).to.equal(golden);
          expect(await meldBankerNft.exists(tokenId)).to.be.true;
          expect(await meldBankerNft.totalSupply()).to.equal(1);
          expect(await meldBankerNft.getTotalMintedNfts()).to.equal(1);
          expect(await meldBankerNft.balanceOf(user.address)).to.equal(1);
          expect(await meldBankerNft.getAllTokensByOwner(user.address)).to.eqls(
            [tokenId]
          );
          expect(
            await meldBankerNft.tokenOfOwnerByIndex(user.address, 0)
          ).to.equal(tokenId);
        });
        it("Should have the correct values after minting an NFT with id > 1", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 2n;
          const golden = false;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);

          expect(await meldBankerNft.ownerOf(tokenId)).to.equal(user.address);
          expect(await meldBankerNft.isGolden(tokenId)).to.equal(golden);
          expect(await meldBankerNft.exists(tokenId)).to.be.true;
          expect(await meldBankerNft.totalSupply()).to.equal(1);
          expect(await meldBankerNft.getTotalMintedNfts()).to.equal(1);
          expect(await meldBankerNft.balanceOf(user.address)).to.equal(1);
          expect(await meldBankerNft.getAllTokensByOwner(user.address)).to.eqls(
            [tokenId]
          );
          expect(
            await meldBankerNft.tokenOfOwnerByIndex(user.address, 0)
          ).to.equal(tokenId);
        });
      }); // end context Mint Happy Path test cases
      context("Error test cases", function () {
        it("Should revert if the caller does not have the BNKR_NFT_MINTER_BURNER_ROLE", async function () {
          const { user, meldBankerNft, addressesProvider } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          const expectedException = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE()}`;
          await expect(
            meldBankerNft.connect(user).mint(user, tokenId, golden)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the token ID is already minted", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);

          await expect(
            meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden)
          ).to.be.revertedWith("ERC721: token already minted");
        });
        it("Should revert if the token ID is 0", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 0n;
          const golden = true;

          await expect(
            meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden)
          ).to.be.revertedWith(ProtocolErrors.MB_INVALID_NFT_ID);
        });
        it("Should revert if the destination address is the zero address", async function () {
          const { bankerAdmin, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          await expect(
            meldBankerNft
              .connect(bankerAdmin)
              .mint(ZeroAddress, tokenId, golden)
          ).to.be.revertedWith("ERC721: mint to the zero address");
        });
      }); // end context Mint Error test cases
    }); // end context Mint
    context("Burn", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right events burning a golden NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);

          const burnTx = await meldBankerNft.connect(bankerAdmin).burn(tokenId);
          await expect(burnTx)
            .to.emit(meldBankerNft, "Transfer")
            .withArgs(user.address, ZeroAddress, tokenId);

          await expect(burnTx)
            .to.emit(meldBankerNft, "Burn")
            .withArgs(bankerAdmin.address, user.address, tokenId, golden);
        });
        it("Should emit the right events burning a non-golden NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = false;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);

          const burnTx = await meldBankerNft.connect(bankerAdmin).burn(tokenId);
          await expect(burnTx)
            .to.emit(meldBankerNft, "Transfer")
            .withArgs(user.address, ZeroAddress, tokenId);

          await expect(burnTx)
            .to.emit(meldBankerNft, "Burn")
            .withArgs(bankerAdmin.address, user.address, tokenId, golden);
        });
        it("Should have the correct values after burning a golden NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);
          await meldBankerNft.connect(bankerAdmin).burn(tokenId);

          expect(await meldBankerNft.totalSupply()).to.equal(0);
          expect(await meldBankerNft.getTotalMintedNfts()).to.equal(1);
          expect(await meldBankerNft.balanceOf(user.address)).to.equal(0);
        });
        it("Should have the correct values after burning a non-golden NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = false;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);
          await meldBankerNft.connect(bankerAdmin).burn(tokenId);

          expect(await meldBankerNft.totalSupply()).to.equal(0);
          expect(await meldBankerNft.getTotalMintedNfts()).to.equal(1);
          expect(await meldBankerNft.balanceOf(user.address)).to.equal(0);
        });
      }); // end context Burn Happy Path test cases
      context("Error test cases", function () {
        it("Should revert if the caller does not have the BNKR_NFT_MINTER_BURNER_ROLE", async function () {
          const { user, bankerAdmin, meldBankerNft, addressesProvider } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);

          const expectedException = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE()}`;
          await expect(
            meldBankerNft.connect(user).burn(tokenId)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the NFT is blocked", async function () {
          const { bankerAdmin, tokenId, meldBankerNft } = await loadFixture(
            lockedMeldBankerNFTFixture
          );

          await expect(
            meldBankerNft.connect(bankerAdmin).burn(tokenId)
          ).to.be.revertedWith(ProtocolErrors.MB_NFT_BLOCKED);
        });
      }); // end context Burn Error test cases
    }); // end context Burn

    context("Transfer", function () {
      // Not extensively tested. Just want to make sure the transfer is not available if the NFT is blocked
      context("Happy Path test cases", function () {
        it("Should emit the right events transferring an NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);

          const transferTx = await meldBankerNft
            .connect(user)
            .transferFrom(user.address, bankerAdmin.address, tokenId);
          await expect(transferTx)
            .to.emit(meldBankerNft, "Transfer")
            .withArgs(user.address, bankerAdmin.address, tokenId);
        });
        it("Should have the correct values after transferring an NFT", async function () {
          const { bankerAdmin, user, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const tokenId = 1n;
          const golden = true;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, golden);
          await meldBankerNft
            .connect(user)
            .transferFrom(user.address, bankerAdmin.address, tokenId);

          expect(await meldBankerNft.ownerOf(tokenId)).to.equal(
            bankerAdmin.address
          );
          expect(await meldBankerNft.isGolden(tokenId)).to.equal(golden);
          expect(await meldBankerNft.exists(tokenId)).to.be.true;
          expect(await meldBankerNft.totalSupply()).to.equal(1);
          expect(await meldBankerNft.getTotalMintedNfts()).to.equal(1);
          expect(await meldBankerNft.balanceOf(bankerAdmin.address)).to.equal(
            1
          );
          expect(
            await meldBankerNft.tokenOfOwnerByIndex(bankerAdmin.address, 0)
          ).to.equal(tokenId);
        });
      }); // end context Transfer Happy Path test cases
      context("Error test cases", function () {
        it("Should revert if the NFT is blocked", async function () {
          const { bankerAdmin, tokenId, meldBankerNft, depositor } =
            await loadFixture(lockedMeldBankerNFTFixture);

          await expect(
            meldBankerNft
              .connect(depositor)
              .transferFrom(depositor.address, bankerAdmin.address, tokenId)
          ).to.be.revertedWith(ProtocolErrors.MB_NFT_BLOCKED);
        });
      }); // end context Transfer Error test cases
    }); // end context Transfer

    context("Set Metadata address", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right events setting the metadata address", async function () {
          const { deployer, rando, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const newMetadataAddress = rando.address;

          await expect(
            meldBankerNft
              .connect(deployer)
              .setMetadataAddress(newMetadataAddress)
          )
            .to.emit(meldBankerNft, "MetadataAddressUpdated")
            .withArgs(deployer.address, ZeroAddress, newMetadataAddress);
        });
        it("Should emit the right events setting the metadata address and then updating it again", async function () {
          const { deployer, user, rando, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const metadataAddress = user.address;
          const newMetadataAddress = rando.address;

          await meldBankerNft
            .connect(deployer)
            .setMetadataAddress(metadataAddress);

          await expect(
            meldBankerNft
              .connect(deployer)
              .setMetadataAddress(newMetadataAddress)
          )
            .to.emit(meldBankerNft, "MetadataAddressUpdated")
            .withArgs(deployer.address, metadataAddress, newMetadataAddress);
        });
        it("Should have the correct values after setting the metadata address", async function () {
          const { deployer, rando, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const newMetadataAddress = rando.address;

          await meldBankerNft
            .connect(deployer)
            .setMetadataAddress(newMetadataAddress);

          expect(await meldBankerNft.nftMetadata()).to.equal(
            newMetadataAddress
          );
        });
        it("Should have the correct values after setting the metadata address and then updating it again", async function () {
          const { deployer, user, rando, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const metadataAddress = user.address;
          const newMetadataAddress = rando.address;

          await meldBankerNft
            .connect(deployer)
            .setMetadataAddress(metadataAddress);

          await meldBankerNft
            .connect(deployer)
            .setMetadataAddress(newMetadataAddress);

          expect(await meldBankerNft.nftMetadata()).to.equal(
            newMetadataAddress
          );
        });
      }); // end context Set Metadata address Happy Path test cases
      context("Error test cases", function () {
        it("Should revert if the caller does not have the DEFAULT_ADMIN_ROLE", async function () {
          const { user, rando, addressesProvider, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const newMetadataAddress = rando.address;

          const expectedException = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await addressesProvider.DEFAULT_ADMIN_ROLE()}`;
          await expect(
            meldBankerNft.connect(user).setMetadataAddress(newMetadataAddress)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the metadata address is the zero address", async function () {
          const { deployer, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const newMetadataAddress = ZeroAddress;

          await expect(
            meldBankerNft
              .connect(deployer)
              .setMetadataAddress(newMetadataAddress)
          ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });
      }); // end context Set Metadata address Error test cases
    }); // end context Set Metadata address

    context("Update Addresses Provider", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right events updating the addresses provider", async function () {
          const {
            deployer,
            addressesProvider,
            newAddressesProvider,
            meldBankerNft,
          } = await loadFixture(twoAddressesProvidersFixture);

          await expect(
            meldBankerNft
              .connect(deployer)
              .updateAddressesProvider(newAddressesProvider)
          )
            .to.emit(meldBankerNft, "AddressesProviderUpdated")
            .withArgs(
              deployer.address,
              await addressesProvider.getAddress(),
              await newAddressesProvider.getAddress()
            );
        });
        it("Should have the correct values after updating the addresses provider", async function () {
          const { deployer, user, rando, newAddressesProvider, meldBankerNft } =
            await loadFixture(twoAddressesProvidersFixture);

          await meldBankerNft
            .connect(deployer)
            .updateAddressesProvider(newAddressesProvider);

          // Now deployer is not the admin of the MeldBankerNFT
          // so it should not be able to, for example, set the metadata address

          const newMetadataAddress = rando.address;

          const expectedException = `AccessControl: account ${deployer.address.toLowerCase()} is missing role ${await newAddressesProvider.DEFAULT_ADMIN_ROLE()}`;

          await expect(
            meldBankerNft
              .connect(deployer)
              .setMetadataAddress(newMetadataAddress)
          ).to.be.revertedWith(expectedException);

          // But the new admin (user account) should be able to

          await expect(
            meldBankerNft.connect(user).setMetadataAddress(newMetadataAddress)
          ).not.to.be.reverted;
        });
      }); // end context Update Addresses Provider Happy Path test cases

      context("Error test cases", function () {
        it("Should revert if the caller does not have the DEFAULT_ADMIN_ROLE", async function () {
          const { user, rando, addressesProvider, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const newAddressesProvider = rando.address;

          const expectedException = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await addressesProvider.DEFAULT_ADMIN_ROLE()}`;
          await expect(
            meldBankerNft
              .connect(user)
              .updateAddressesProvider(newAddressesProvider)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the new addresses provider is the zero address", async function () {
          const { deployer, meldBankerNft } =
            await loadFixture(setUpMinimalFixture);
          const newAddressesProvider = ZeroAddress;

          await expect(
            meldBankerNft
              .connect(deployer)
              .updateAddressesProvider(newAddressesProvider)
          ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });
        it("Should revert if the new addresses provider does not have a lending pool", async function () {
          const { deployer, meldBankerNft, newAddressesProvider } =
            await loadFixture(twoAddressesProvidersNoLendingPoolFixture);

          await expect(
            meldBankerNft
              .connect(deployer)
              .updateAddressesProvider(newAddressesProvider)
          ).to.be.revertedWith(ProtocolErrors.MB_INVALID_LENDING_POOL);
        });
      }); // end context Update Addresses Provider Error test cases
    }); // end context Update Addresses Provider
  }); // end context MeldBankerNft

  context("MeldBankerNftMetadata", function () {
    context("Set Metadata", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right events setting the metadata of an NFT", async function () {
          const { bankerAdmin, meldBankerNftMetadata } =
            await loadFixture(metadataFixture);
          const tokenId = 1n;
          const metadata = "Some metadata";

          await expect(
            meldBankerNftMetadata
              .connect(bankerAdmin)
              .setMetadata(tokenId, metadata)
          )
            .to.emit(meldBankerNftMetadata, "MetadataSet")
            .withArgs(bankerAdmin.address, tokenId, metadata);
        });

        it("Should have the correct values after setting the metadata of an NFT", async function () {
          const { user, bankerAdmin, meldBankerNft, meldBankerNftMetadata } =
            await loadFixture(metadataFixture);
          const tokenId = 1n;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, true);
          const metadata = "Some metadata";

          await meldBankerNftMetadata
            .connect(bankerAdmin)
            .setMetadata(tokenId, metadata);

          expect(await meldBankerNftMetadata.getMetadata(tokenId)).to.equal(
            metadata
          );
          expect(await meldBankerNft.tokenURI(tokenId)).to.equal(metadata);
        });

        it("Should have the correct values after setting the metadata of an NFT and then updating it again", async function () {
          const { user, bankerAdmin, meldBankerNft, meldBankerNftMetadata } =
            await loadFixture(metadataFixture);
          const tokenId = 1n;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId, true);
          const metadata = "Some metadata";
          const newMetadata = "Some new metadata";

          await meldBankerNftMetadata
            .connect(bankerAdmin)
            .setMetadata(tokenId, metadata);

          await meldBankerNftMetadata
            .connect(bankerAdmin)
            .setMetadata(tokenId, newMetadata);

          expect(await meldBankerNftMetadata.getMetadata(tokenId)).to.equal(
            newMetadata
          );
          expect(await meldBankerNft.tokenURI(tokenId)).to.equal(newMetadata);
        });

        it("Should have the correct values after setting the metadata of two different NFTs", async function () {
          const { user, bankerAdmin, meldBankerNft, meldBankerNftMetadata } =
            await loadFixture(metadataFixture);
          const tokenId1 = 1n;
          const tokenId2 = 2n;

          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId1, true);
          await meldBankerNft.connect(bankerAdmin).mint(user, tokenId2, true);
          const metadata1 = "Some metadata 1";
          const metadata2 = "Some metadata 2";

          await meldBankerNftMetadata
            .connect(bankerAdmin)
            .setMetadata(tokenId1, metadata1);
          await meldBankerNftMetadata
            .connect(bankerAdmin)
            .setMetadata(tokenId2, metadata2);

          expect(await meldBankerNftMetadata.getMetadata(tokenId1)).to.equal(
            metadata1
          );
          expect(await meldBankerNft.tokenURI(tokenId1)).to.equal(metadata1);
          expect(await meldBankerNftMetadata.getMetadata(tokenId2)).to.equal(
            metadata2
          );
          expect(await meldBankerNft.tokenURI(tokenId2)).to.equal(metadata2);
        });
      }); // end context Happy Path test cases
      context("Error test cases", function () {
        it("Should revert if the caller does not have the BNKR_NFT_MINTER_BURNER_ROLE", async function () {
          const { user, meldBankerNftMetadata, addressesProvider } =
            await loadFixture(metadataFixture);
          const tokenId = 1n;
          const metadata = "Some metadata";

          const expectedException = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE()}`;
          await expect(
            meldBankerNftMetadata.connect(user).setMetadata(tokenId, metadata)
          ).to.be.revertedWith(expectedException);
        });
      }); // end context Error test cases
    }); // end context Set Metadata

    context("Update Addresses Provider", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right events updating the addresses provider", async function () {
          const {
            deployer,
            addressesProvider,
            newAddressesProvider,
            meldBankerNftMetadata,
          } = await loadFixture(twoAddressesProvidersFixture);

          await expect(
            meldBankerNftMetadata
              .connect(deployer)
              .updateAddressesProvider(newAddressesProvider)
          )
            .to.emit(meldBankerNftMetadata, "AddressesProviderUpdated")
            .withArgs(
              deployer.address,
              await addressesProvider.getAddress(),
              await newAddressesProvider.getAddress()
            );
        });
        it("Should have the correct values after updating the addresses provider", async function () {
          const {
            deployer,
            user,
            newAddressesProvider,
            meldBankerNftMetadata,
          } = await loadFixture(twoAddressesProvidersFixture);

          await meldBankerNftMetadata
            .connect(deployer)
            .updateAddressesProvider(newAddressesProvider);

          // Now deployer is not the admin of the MeldBankerNFTMetadata
          // so it should not be able to, for example, set the metadata of a token

          const nftRole =
            await newAddressesProvider.BNKR_NFT_MINTER_BURNER_ROLE();

          await newAddressesProvider.connect(user).grantRole(nftRole, user);

          const someMetadata = "Some metadata";
          const someTokenId = 17;

          const expectedException = `AccessControl: account ${deployer.address.toLowerCase()} is missing role ${nftRole}`;

          await expect(
            meldBankerNftMetadata
              .connect(deployer)
              .setMetadata(someTokenId, someMetadata)
          ).to.be.revertedWith(expectedException);

          // But the new admin (user account) should be able to

          await expect(
            meldBankerNftMetadata
              .connect(user)
              .setMetadata(someTokenId, someMetadata)
          ).not.to.be.reverted;
        });
      }); // end context Update Addresses Provider Happy Path test cases

      context("Error test cases", function () {
        it("Should revert if the caller does not have the DEFAULT_ADMIN_ROLE", async function () {
          const { user, rando, addressesProvider, meldBankerNftMetadata } =
            await loadFixture(setUpMinimalFixture);
          const newAddressesProvider = rando.address;

          const expectedException = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await addressesProvider.DEFAULT_ADMIN_ROLE()}`;
          await expect(
            meldBankerNftMetadata
              .connect(user)
              .updateAddressesProvider(newAddressesProvider)
          ).to.be.revertedWith(expectedException);
        });
        it("Should revert if the new addresses provider is the zero address", async function () {
          const { deployer, meldBankerNftMetadata } =
            await loadFixture(setUpMinimalFixture);
          const newAddressesProvider = ZeroAddress;

          await expect(
            meldBankerNftMetadata
              .connect(deployer)
              .updateAddressesProvider(newAddressesProvider)
          ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });
        it("Should revert if the new addresses provider does not have a lending pool", async function () {
          const { deployer, meldBankerNftMetadata, newAddressesProvider } =
            await loadFixture(twoAddressesProvidersNoLendingPoolFixture);

          await expect(
            meldBankerNftMetadata
              .connect(deployer)
              .updateAddressesProvider(newAddressesProvider)
          ).to.be.revertedWith(ProtocolErrors.MB_INVALID_LENDING_POOL);
        });
      }); // end context Update Addresses Provider Error test cases
    }); // end context Update Addresses Provider
  }); // end context MeldBankerNftMetadata

  context("MeldBankerNftMinter", function () {
    context("Constructor", function () {
      context("Error test cases", function () {
        it("Should revert if the AddressesProvider does not have a lending pool", async function () {
          const [deployer] = await ethers.getSigners();

          const AddressesProvider =
            await ethers.getContractFactory("AddressesProvider");
          const addressesProvider = await AddressesProvider.deploy(deployer);

          const MeldBankerNftMinter = await ethers.getContractFactory(
            "MeldBankerNFTMinter"
          );
          await expect(
            MeldBankerNftMinter.deploy(addressesProvider)
          ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });
      });
    });
    context("Mint", function () {
      context("Happy Path test cases", function () {
        it("Should emit the right events minting a golden NFT", async function () {
          const {
            user,
            bankerAdmin,
            meldBankerNft,
            meldBankerNftMetadata,
            meldBankerNftMinter,
          } = await loadFixture(nftMinterFixture);
          const tokenId = 1n;
          const golden = true;
          const metadata = "Some metadata";

          const mintTx = await meldBankerNftMinter
            .connect(bankerAdmin)
            .mint(user, tokenId, golden, metadata);
          await expect(mintTx)
            .to.emit(meldBankerNft, "Mint")
            .withArgs(
              await meldBankerNftMinter.getAddress(),
              user.address,
              tokenId,
              golden
            );
          await expect(mintTx)
            .to.emit(meldBankerNftMetadata, "MetadataSet")
            .withArgs(
              await meldBankerNftMinter.getAddress(),
              tokenId,
              metadata
            );
        });
        it("Should have the correct values after minting a golden NFT", async function () {
          const {
            user,
            bankerAdmin,
            meldBankerNft,
            meldBankerNftMetadata,
            meldBankerNftMinter,
          } = await loadFixture(nftMinterFixture);
          const tokenId = 1n;
          const golden = true;
          const metadata = "Some metadata";

          await meldBankerNftMinter
            .connect(bankerAdmin)
            .mint(user, tokenId, golden, metadata);

          expect(await meldBankerNft.ownerOf(tokenId)).to.equal(user.address);
          expect(await meldBankerNft.isGolden(tokenId)).to.equal(golden);
          expect(await meldBankerNft.exists(tokenId)).to.be.true;
          expect(await meldBankerNft.totalSupply()).to.equal(1);
          expect(await meldBankerNft.getTotalMintedNfts()).to.equal(1);
          expect(await meldBankerNft.balanceOf(user.address)).to.equal(1);
          expect(await meldBankerNft.getAllTokensByOwner(user.address)).to.eqls(
            [tokenId]
          );
          expect(
            await meldBankerNft.tokenOfOwnerByIndex(user.address, 0)
          ).to.equal(tokenId);
          expect(await meldBankerNftMetadata.getMetadata(tokenId)).to.equal(
            metadata
          );
          expect(await meldBankerNft.tokenURI(tokenId)).to.equal(metadata);
        });
      }); // end context Mint Happy Path test cases

      context("Error test cases", function () {
        it("Should revert if the caller does not have the BNKR_NFT_MINTER_BURNER_ROLE", async function () {
          const { user, meldBankerNftMinter, addressesProvider } =
            await loadFixture(nftMinterFixture);
          const tokenId = 1n;
          const golden = true;
          const metadata = "Some metadata";

          const expectedException = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE()}`;
          await expect(
            meldBankerNftMinter
              .connect(user)
              .mint(user, tokenId, golden, metadata)
          ).to.be.revertedWith(expectedException);
        });
      }); // end context Mint Error test cases
    }); // end context Mint
  }); // end context MeldBankerNftMinter
});

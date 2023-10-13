import { expect } from "chai";
import { ethers, deployments, waffle, network } from "hardhat";
import {
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getEntryPoint,
} from "./utils/setupHelper";
import { AddressZero } from "@ethersproject/constants";

describe("Smart Account Factory", async () => {
  const [deployer, smartAccountOwner, alice, charlie] =
    waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const mockToken = await getMockToken();

    const ecdsaModule = await getEcdsaOwnershipRegistryModule();

    const entryPoint = await getEntryPoint();

    return {
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      entryPoint: entryPoint,
    };
  });
  describe("Constructor", async () => {
    it("reverts with zero address provided as implementation", async () => {
      const SmartAccountFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );
      await expect(
        SmartAccountFactory.deploy(AddressZero, deployer.address)
      ).to.be.revertedWith("implementation cannot be zero");
    });

    it("sets non-zero address implementation", async () => {
      const { smartAccountImplementation } = await setupTests();
      const SmartAccountFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );
      const testFactory = await SmartAccountFactory.deploy(
        smartAccountImplementation.address,
        deployer.address
      );
      await testFactory.deployed();
      expect(await testFactory.basicImplementation()).to.equal(
        smartAccountImplementation.address
      );
    });

    it("deploys Default Callback Handler instance", async () => {
      const { smartAccountImplementation } = await setupTests();
      const SmartAccountFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );
      const testFactory = await SmartAccountFactory.deploy(
        smartAccountImplementation.address,
        deployer.address
      );
      await testFactory.deployed();
      const callbackHandlerAddress = await testFactory.minimalHandler();
      const callbackHandler = await ethers.getContractAt(
        "DefaultCallbackHandler",
        callbackHandlerAddress
      );
      expect(await callbackHandler.NAME()).to.equal("Default Callback Handler");
    });

    it("successfully changes owner to a new one", async () => {
      const { smartAccountImplementation } = await setupTests();
      const SmartAccountFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );
      const testFactory = await SmartAccountFactory.deploy(
        smartAccountImplementation.address,
        charlie.address
      );
      await testFactory.deployed();
      expect(await testFactory.owner()).to.equal(charlie.address);
      expect(await testFactory.owner()).to.not.equal(deployer.address);
    });
  });

  describe("Stakeable", async () => {
    describe("addStake(): ", async () => {
      // positive cases
      it("can add stake to the EP", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 600;
        await smartAccountFactory.addStake(
          entryPoint.address,
          validUnstakeDelay,
          {
            value: stakeAmount,
          }
        );
        const depositInfo = await entryPoint.getDepositInfo(
          smartAccountFactory.address
        );
        expect(depositInfo.stake).to.equal(stakeAmount);
      });

      // negative cases
      it("reverts when wrong EntryPoint address is passed", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 600;
        const invalidEPAddress = AddressZero;
        await expect(
          smartAccountFactory.addStake(invalidEPAddress, validUnstakeDelay, {
            value: stakeAmount,
          })
        ).to.be.revertedWith("Invalid EP address");
      });

      it("reverts when unstake delay not specified", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const invalidUnstakeDelay = 0;
        await expect(
          smartAccountFactory.addStake(
            entryPoint.address,
            invalidUnstakeDelay,
            { value: stakeAmount }
          )
        ).to.be.revertedWith("must specify unstake delay");
      });

      it("reverts when trying to decrease unstake time", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 600;
        const invalidUnstakeDelay = validUnstakeDelay - 2;
        // add stake
        await smartAccountFactory.addStake(entryPoint.address, 600, {
          value: stakeAmount,
        });
        const depositInfo = await entryPoint.getDepositInfo(
          smartAccountFactory.address
        );
        await expect(
          smartAccountFactory.addStake(
            entryPoint.address,
            invalidUnstakeDelay,
            { value: stakeAmount }
          )
        ).to.be.revertedWith("cannot decrease unstake time");
      });

      it("reverts when stake value not specified", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        const invalidStakeAmount = ethers.utils.parseEther("0");
        const validUnstakeDelay = 600;
        await expect(
          smartAccountFactory.addStake(entryPoint.address, validUnstakeDelay, {
            value: invalidStakeAmount,
          })
        ).to.be.revertedWith("no stake specified");
      });

      it("reverts when typecasted stake overflows", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        const overflowedStakeAmount = ethers.utils.parseEther(
          "5192296858534827.628530496329220095"
        );
        const validUnstakeDelay = 600;
        await expect(
          smartAccountFactory.addStake(entryPoint.address, validUnstakeDelay, {
            value: overflowedStakeAmount,
          })
        ).to.be.revertedWith("stake overflow");
      });
    });

    describe("unlockStake(): ", async () => {
      // positive cases
      it("can unlock stake", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        // staking first
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 600;
        await smartAccountFactory.addStake(
          entryPoint.address,
          validUnstakeDelay,
          {
            value: stakeAmount,
          }
        );
        // unstake
        const tx = await smartAccountFactory.unlockStake(entryPoint.address);
        await expect(tx).to.emit(entryPoint, "StakeUnlocked");
      });

      // negative cases
      it("reverts when wrong EntryPoint address is passed ", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        // staking first
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 600;
        await smartAccountFactory.addStake(
          entryPoint.address,
          validUnstakeDelay,
          {
            value: stakeAmount,
          }
        );
        // unstaking with wrong entryPoint address
        const invalidEPAddress = AddressZero;
        await expect(
          smartAccountFactory.unlockStake(invalidEPAddress)
        ).to.be.revertedWith("Invalid EP address");
      });

      it("reverts when amount is not staked yet", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        // calling unstake() without staking first
        await expect(
          smartAccountFactory.unlockStake(entryPoint.address)
        ).to.be.revertedWith("not staked");
      });

      it("reverts when amount is already unstaked", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        // staking first
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 600;
        await smartAccountFactory.addStake(
          entryPoint.address,
          validUnstakeDelay,
          {
            value: stakeAmount,
          }
        );
        // unstake()
        await smartAccountFactory.unlockStake(entryPoint.address);
        // calling unstake() again
        await expect(
          smartAccountFactory.unlockStake(entryPoint.address)
        ).to.be.revertedWith("already unstaking");
      });
    });

    describe("withdrawStake(): ", async () => {
      // positive cases
      it("can withdraw Stake", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();

        // staking first
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 1;
        await smartAccountFactory.addStake(
          entryPoint.address,
          validUnstakeDelay,
          {
            value: stakeAmount,
          }
        );

        // Increase time (600 seconds)
        // Mine additional blocks
        const blocksToWait = 10;
        const currentBlockNumber = await ethers.provider.getBlockNumber();
        const targetBlockNumber = currentBlockNumber + blocksToWait;
        while ((await ethers.provider.getBlockNumber()) < targetBlockNumber) {
          await ethers.provider.send("evm_mine", []);
        }
        // withdrawing
        await smartAccountFactory.unlockStake(entryPoint.address);
        const tx = await smartAccountFactory.withdrawStake(
          entryPoint.address,
          alice.address
        );
        await expect(tx).to.emit(entryPoint, "StakeWithdrawn");
      });

      // negative cases
      it("reverts when wrong EntryPoint address is passed ", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();

        // staking first
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 1;
        await smartAccountFactory.addStake(
          entryPoint.address,
          validUnstakeDelay,
          {
            value: stakeAmount,
          }
        );

        // Increase time (600 seconds)
        // Mine additional blocks
        const blocksToWait = 10;
        const currentBlockNumber = await ethers.provider.getBlockNumber();
        const targetBlockNumber = currentBlockNumber + blocksToWait;
        while ((await ethers.provider.getBlockNumber()) < targetBlockNumber) {
          await ethers.provider.send("evm_mine", []);
        }

        // withdrawing with wrong entryPoint address
        const invalidEPAddress = AddressZero;
        await expect(
          smartAccountFactory.withdrawStake(invalidEPAddress, alice.address)
        ).to.be.revertedWith("Invalid EP address");
      });

      it("reverts on empty stake withdraw", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        // withdrawing
        await expect(
          smartAccountFactory.withdrawStake(entryPoint.address, alice.address)
        ).to.be.revertedWith("No stake to withdraw");
      });

      it("reverts when not calling unlockWithdraw() first", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        // staking first
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 1;
        await smartAccountFactory.addStake(
          entryPoint.address,
          validUnstakeDelay,
          {
            value: stakeAmount,
          }
        );

        // waiting for additional blocks
        const blocksToWait = 10;
        const currentBlockNumber = await ethers.provider.getBlockNumber();
        const targetBlockNumber = currentBlockNumber + blocksToWait;
        while ((await ethers.provider.getBlockNumber()) < targetBlockNumber) {
          await ethers.provider.send("evm_mine", []);
        }
        // withdrawing
        await expect(
          smartAccountFactory.withdrawStake(entryPoint.address, alice.address)
        ).to.be.revertedWith("must call unlockStake() first");
      });

      it("reverts when calling before stake withdrawal", async () => {
        const { smartAccountFactory, smartAccountImplementation, entryPoint } =
          await setupTests();
        // staking first
        const stakeAmount = ethers.utils.parseEther("1.234256");
        const validUnstakeDelay = 600;
        await smartAccountFactory.addStake(
          entryPoint.address,
          validUnstakeDelay,
          {
            value: stakeAmount,
          }
        );
        // waiting for additional blocks
        const blocksToWait = 10;
        const currentBlockNumber = await ethers.provider.getBlockNumber();
        const targetBlockNumber = currentBlockNumber + blocksToWait;
        while ((await ethers.provider.getBlockNumber()) < targetBlockNumber) {
          await ethers.provider.send("evm_mine", []);
        }
        // withdrawing
        await smartAccountFactory.unlockStake(entryPoint.address);
        await expect(
          smartAccountFactory.withdrawStake(entryPoint.address, alice.address)
        ).to.be.revertedWith("Stake withdrawal is not due");
      });
    });
  });

  describe("Deploy CounterFactual Account", async () => {
    it("should deploy and init Smart Account and emit event", async () => {
      const { smartAccountFactory, ecdsaModule, smartAccountImplementation } =
        await setupTests();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );

      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

      const deploymentTx =
        await smartAccountFactory.deployCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );
      expect(deploymentTx)
        .to.emit(smartAccountFactory, "AccountCreation")
        .withArgs(
          expectedSmartAccountAddress,
          ecdsaModule.address,
          smartAccountDeploymentIndex
        );

      const smartAccount = await ethers.getContractAt(
        "SmartAccount",
        expectedSmartAccountAddress
      );
      expect(await smartAccount.getImplementation()).to.equal(
        await smartAccountFactory.basicImplementation()
      );
      expect(await smartAccount.entryPoint()).to.equal(
        await smartAccountImplementation.entryPoint()
      );
      expect(await smartAccount.isModuleEnabled(ecdsaModule.address)).to.equal(
        true
      );
      expect(await ecdsaModule.getOwner(smartAccount.address)).to.equal(
        smartAccountOwner.address
      );
      expect(await smartAccount.nonce(0)).to.equal(0);
    });

    it("should revert if already deployed", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );
      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );
      await smartAccountFactory.deployCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

      const expectedSmartAccountAddress2 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

      expect(expectedSmartAccountAddress).to.equal(
        expectedSmartAccountAddress2
      );
      await expect(
        smartAccountFactory.deployCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        )
      ).to.be.revertedWith("Create2 call failed");
    });

    it("should lead to different SA address when deploying SA with other owner", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );
      const ecdsaOwnershipSetupData2 =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await alice.getAddress()]
        );
      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

      const expectedSmartAccountAddress2 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData2,
          smartAccountDeploymentIndex
        );

      expect(expectedSmartAccountAddress).to.not.equal(
        expectedSmartAccountAddress2
      );
    });

    it("should revert if wrong setup data provided", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();

      const ecdsaOwnershipSetupData = "0xeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeE";
      const smartAccountDeploymentIndex = 0;

      await expect(
        smartAccountFactory.deployCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        )
      ).to.be.revertedWith("");
    });

    it("does not not allow to steal funds from counterfactual account", async () => {
      const { smartAccountFactory, mockToken, ecdsaModule } =
        await setupTests();
      const mockTokensToMint = ethers.utils.parseEther("1000000");

      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );
      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );
      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

      await mockToken.mint(expectedSmartAccountAddress, mockTokensToMint);

      const fakeSetupData = (
        await ethers.getContractFactory("MockToken")
      ).interface.encodeFunctionData("transfer", [
        await alice.getAddress(),
        mockTokensToMint,
      ]);

      await expect(
        smartAccountFactory.deployCounterFactualAccount(
          mockToken.address,
          fakeSetupData,
          smartAccountDeploymentIndex
        )
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      expect(await mockToken.balanceOf(expectedSmartAccountAddress)).to.equal(
        mockTokensToMint
      );
      expect(await mockToken.balanceOf(alice.address)).to.equal(0);
    });
  });

  describe("Deploy Account", async () => {
    it("should deploy and init Smart Account and emit event", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );

      const deploymentTx = await smartAccountFactory.deployAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData
      );
      expect(deploymentTx).to.emit(
        smartAccountFactory,
        "AccountCreationWithoutIndex"
      );

      const receipt = await deploymentTx.wait();
      const deployedSmartAccountAddress = receipt.events[1].args[0];

      const smartAccount = await ethers.getContractAt(
        "SmartAccount",
        deployedSmartAccountAddress
      );
      expect(await smartAccount.isModuleEnabled(ecdsaModule.address)).to.equal(
        true
      );
      expect(await ecdsaModule.getOwner(smartAccount.address)).to.equal(
        smartAccountOwner.address
      );
    });

    it("should revert if wrong setup data provided", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();

      const ecdsaOwnershipSetupData = "0xeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeE";

      await expect(
        smartAccountFactory.deployAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData
        )
      ).to.be.revertedWith("");
    });
  });
});

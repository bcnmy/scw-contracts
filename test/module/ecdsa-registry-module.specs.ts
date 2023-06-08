import { expect } from "chai";
import hre , { ethers, deployments, waffle } from "hardhat";
import { AddressZero } from "../aa-core/testutils";
import { makeEcdsaModuleUserOp, makeEcdsaModuleUserOpWithPaymaster, fillAndSign } from "../utils/userOp";
import {getEntryPoint,getSmartAccountFactory, getEcdsaOwnershipRegistryModule,deployContract} from "../utils/setupHelper";
import { EntryPoint } from "../../typechain";

describe("NEW::: ECDSA Registry Module: ", async()=>{

    const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();
    const smartAccountDeploymentIndex = 0;

    const setupTests = deployments.createFixture(async( {deployments, getNamedAccounts} ) =>{
        await deployments.fixture();

        // Deploy EntryPoint
        const entryPoint = await getEntryPoint();
        // Deploy SmartAccountFactory
        const SAFactory = await getSmartAccountFactory();
        // Deploy ECDSA Module
        const EcdsaRegistryModule = await getEcdsaOwnershipRegistryModule();

        return {
            entryPoint: entryPoint,
            SAFactory: SAFactory,
            EcdsaRegistryModule: EcdsaRegistryModule,
        };
    });

    describe("initForSmartAccount: ", async() =>{
        // Pass in EOA address in setupData for calling initForSmartAccount function and SA is succesfully deployed
        it("Deploys Smart Account with EOA as owner", async()=>{
            const {SAFactory,EcdsaRegistryModule} = await setupTests();

            let EcdsaOwnershipSetupData = EcdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [await smartAccountOwner.getAddress()]
              );

            const expectedSmartAccountAddress = await SAFactory.getAddressForCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
            await SAFactory.deployCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
            const userSA = await hre.ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);

            expect( await EcdsaRegistryModule.smartAccountOwners(userSA.address)).to.be.equal(await smartAccountOwner.getAddress());

        });

        // Pass in non(EOA) as owner in the setupData and check for revert
        it("Reverts when trying to set Smart Contract as owner of the Smart Account", async()=>{
            const {SAFactory,EcdsaRegistryModule} = await setupTests();

            const randomContractCode = `
            contract random {
                function returnAddress() public view returns(address){
                    return address(this);
                }
            }
            `;
            const randomContract = await deployContract(deployer,randomContractCode);


            let EcdsaOwnershipSetupData = EcdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [await randomContract.address]
              );

            // Getting the address of the to be deployed SA does not get revert as it's just a bunch of abi.encode operations
            const expectedSmartAccountAddress = await SAFactory.getAddressForCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
            // This should revert
            await expect(SAFactory.deployCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex)).to.reverted;
            // Extra checks
            // smartAccountOwners mapping should point to address(0)
            expect( await EcdsaRegistryModule.smartAccountOwners(expectedSmartAccountAddress)).to.be.equal(AddressZero);
        });

        // Listen for AlreadyInitedForSmartAccount(msg.sender) error
        it("Reverts when calling again after initialization", async()=>{
            const {SAFactory,EcdsaRegistryModule,entryPoint} = await setupTests();

            let EcdsaOwnershipSetupData = EcdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [await smartAccountOwner.getAddress()]
              );

            const expectedSmartAccountAddress = await SAFactory.getAddressForCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
            await SAFactory.deployCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
            const userSA = await hre.ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);

            await deployer.sendTransaction({
                to: userSA.address,
                value: ethers.utils.parseEther("10"),
            });

            // Send txs to ECDSARegistryModule.initForSmartAccount and check for revert
            // Construct userOp
            const txnData = EcdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [bob.getAddress()],
            );
            const userOp = await fillAndSign(
                {
                    sender: userSA.address,
                    callData: txnData
                },
                smartAccountOwner,
                entryPoint,
                'nonce'
            );
            let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
                ["bytes", "address"],
                [userOp.signature, EcdsaRegistryModule.address]
            );
            userOp.signature = signatureWithModuleAddress;

            const tx = await entryPoint.handleOps([userOp], alice.address);
            await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");
        });
    });

    describe("setOwner(): ",async()=>{
        // Deploy userSA with registering alice.getAddress() as owner with EcdsaRegistryModule
        // Make helper function for constructing userOp

        // Positive case
        it("Call setOwner() from userSA and changes owner ", async()=>{
            // assert via smartAccountOwners mapping of EcdsaRegistryModule
        });

        // Negative case
        it("Reverts while setting Smart Contract Address as owner via setOwner() ", async()=>{

        });
    });

    // Main thing to test out here is _verifySignature() that it calls internally
    describe("validateUserOp(): ", async()=>{

        // Construct a valid userOp and check if it does not revert
        it("Successful transaction for a valid UserOp ", async()=>{});

        // Next cases will be for sending userOps with incorrect signatures i.e. wrong signature length,etc.
        // To be done via meddling with fillAndSign() helper function

    });

    // Expects a hash prepended with 'x\x19Ethereum Signed Message:\n32'
    describe("isValidSignature(): ", async()=>{

        // Getting EIP1271_MAGIC_VALUE
        it(" ", async()=>{});

        // Getting bytes4(0xffffffff)
        it(" ", async()=>{});
    });

});

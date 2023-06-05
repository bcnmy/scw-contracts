import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { deployFactory } from "../../scripts/utils";
import { buildecdsaModuleAuthorizedForwardTx } from "../../src/utils/execution";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import { makeEcdsaModuleUserOp, makeEcdsaModuleUserOpWithPaymaster } from "../utils/userOp";

describe("NEW::: Smart Account Getters", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const mockToken = await getMockToken();
    
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory("EcdsaOwnershipRegistryModule");
      
    let ecdsaOwnershipSetupData = EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;

    const userSA = await getSmartAccountWithModule(ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex);

    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));
    
    return {
      entryPoint: await getEntryPoint(),
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  it ("getChainId returns correct chainId", async () => {
    const { 
      userSA
    } = await setupTests();
    const chainIdReturned = await userSA.getChainId();
    const chainIdExpected = (await ethers.provider.getNetwork()).chainId;
    expect(chainIdReturned).to.equal(chainIdExpected);
  });

  it ("domainSeparator returns correct Domain Separator", async () => {
    const { 
      userSA
    } = await setupTests();
    // Domain Seperators keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");
    const DOMAIN_SEPARATOR_TYPEHASH =
        "0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218";
    const domainSeparatorReturned = await userSA.domainSeparator();
    const domainSeparatorExpected = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "uint256", "address"],
        [DOMAIN_SEPARATOR_TYPEHASH, await userSA.getChainId(), userSA.address]
      )
    );
    expect(domainSeparatorReturned).to.equal(domainSeparatorExpected);
  });

  it ("getDeposit returns correct EntryPoint deposit", async () => {
    const {
      userSA
    } = await setupTests();
    const amountToDeposit = ethers.utils.parseEther("1");
    userSA.addDeposit({value: amountToDeposit});
    expect(await userSA.getDeposit()).to.equal(amountToDeposit);
  });

  it ("supports ERC165 Interface", async () => {
    const {
      userSA
    } = await setupTests();
    const ERC165InterfaceId = "0x01ffc9a7";
    expect(await userSA.supportsInterface(ERC165InterfaceId)).to.equal(true);
  });

  it ("nonce returns correct nonce", async () => {
    const {
      userSA, 
      entryPoint
    } = await setupTests();
    expect(await userSA.nonce()).to.equal(await entryPoint.getNonce(userSA.address, 0));
  }

  

  )



});

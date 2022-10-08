import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { ethers as originalEthers } from "ethers";
import { SessionKeyModule, TestToken } from "../../typechain";
import { assert } from "console";

describe("Lock", function () {
  let sessionKeyModule: SessionKeyModule;
  let token: TestToken;
  let accounts: any;
  let owner: string;

  const sessionKey = "0x4a2ECE16897cc331570D029564F8A9B12F731481";
  const sessionKeyPrivateKey =
    "42a2acfd6eda24ef49d232e127d6998f8917b0aaea0a7d6d88026932adc688eb";

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    owner = await accounts[0].getAddress();

    const TestToken = await ethers.getContractFactory("TestToken");
    token = await TestToken.deploy();
    await token.deployed();

    await token.mint(owner, ethers.utils.parseEther("1000000"));

    console.log("Test token deployed at: ", token.address);

    const sessionKeyModuleFactory = await hre.ethers.getContractFactory(
      "SessionKeyModule"
    );
    sessionKeyModule = await sessionKeyModuleFactory.deploy();
  });

  it("Set and verify session with permission", async function () {
    const startTimestamp = 1665239610;
    const endTimestamp = 1665326010;
    const sessionParam = {
      startTimestamp: startTimestamp,
      endTimestamp: endTimestamp,
      enable: true,
    };

    const ABI = ["function transfer(address to, uint256 amount)"];
    const iface = new originalEthers.utils.Interface(ABI);
    const encodedData = iface.encodeFunctionData("transfer", [
      "0x1234567890123456789012345678901234567890",
      "10000000000",
    ]);

    const transferFunctionSignature = encodedData.slice(0, 10);

    console.log(transferFunctionSignature);
    const permissionParam = {
      whitelistDestination: token.address,
      whitelistMethods: [transferFunctionSignature],
      tokenAmount: 100000000,
    };

    const session = await sessionKeyModule.createSession(
      sessionKey,
      [permissionParam],
      sessionParam
    );
    await session.wait();

    const sessionInfo = await sessionKeyModule.getSessionInfo(sessionKey);

    assert(
      sessionInfo.startTimestamp.toNumber() === startTimestamp,
      "Start timestamp doesn't match"
    );
    assert(
      sessionInfo.endTimestamp.toNumber() === endTimestamp,
      "End timestamp doesn't match"
    );
    assert(sessionInfo.enable, "Session is not enabled");
    const whitelistedAddress = await sessionKeyModule.getWhitelistDestinations(
      sessionKey
    );
    const whitelistedMethods = await sessionKeyModule.getWhitelistMethods(
      sessionKey,
      token.address
    );

    assert(
      whitelistedAddress.length > 0,
      "Destination address are not whitelisted properly"
    );
    assert(
      whitelistedAddress[0] === token.address,
      "Whitelisted address does not match"
    );

    assert(
      whitelistedMethods.length > 0,
      "Destination contract methods are not whitelisted properly"
    );
    assert(
      whitelistedMethods[0] === transferFunctionSignature,
      "Whitelisted Destination contract methods does not match"
    );

    // console.log(sessionInfo);
    // console.log(whitelistedAddress);
  });
});

import { expect } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";
import {
  AddressResolver,
  AddressResolver__factory,
  SmartAccountFactory,
  SmartAccountFactoryV1,
  SmartAccountFactoryV1__factory,
} from "../../typechain-types";

// WIP
describe("Deploy some Factories, Accounts, the Address Resolver and test getters", function () {
  let entryPointAddress: string;
  let deployer: Signer;
  let factoryV1: SmartAccountFactoryV1;
  let factoryV2: SmartAccountFactory;
  let addressResolver: AddressResolver;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();
    deployer = accounts[0];

    addressResolver = await new AddressResolver__factory().deploy();
    await addressResolver.deployed();
    // console.log("addressResolver deployed ", addressResolver.address);

    // Deploy Factory V1

    // ^ needs impl V1

    // Deploy Factory V2

    // ^ needs impl V2
  });

  // it("Deploy Accounts using factories on different indexes and resolve SA address", async function () {});
});

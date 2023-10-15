import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { AddressZero } from "@ethersproject/constants";

describe("Proxy ", async () => {
  const [randomAddress] = waffle.provider.getWallets();

  describe("constructor", async () => {
    it("should revert with invalid implementation address", async () => {
      const Proxy = await ethers.getContractFactory(
        "contracts/smart-account/Proxy.sol:Proxy"
      );
      await expect(Proxy.deploy(AddressZero)).to.be.revertedWith(
        "NotSmartContract"
      );
    });

    it("should store implementation at the slot with address encoded as proxy address", async () => {
      const MockTokenFactory = await ethers.getContractFactory("MockToken");
      const mockToken = await MockTokenFactory.deploy();
      const implementationAddress = await mockToken.address;

      const Proxy = await ethers.getContractFactory(
        "contracts/smart-account/Proxy.sol:Proxy"
      );
      const proxy = await Proxy.deploy(implementationAddress);
      await proxy.deployed();

      const recordedAddress = ethers.utils.getAddress(
        (
          await ethers.provider.getStorageAt(proxy.address, proxy.address)
        ).slice(-40)
      );
      expect(recordedAddress).to.equal(implementationAddress);
    });

    it("reverts when trying to initiate by EOA parameter", async () => {
      const EOAimplementationAddress = randomAddress.address;

      const Proxy = await ethers.getContractFactory(
        "contracts/smart-account/Proxy.sol:Proxy"
      );
      await expect(Proxy.deploy(EOAimplementationAddress)).to.be.revertedWith(
        "NotSmartContract"
      );
    });
  });
});

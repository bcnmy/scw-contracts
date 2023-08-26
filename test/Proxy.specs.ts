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
        "Invalid implementation address"
      );
    });

    it("should store implementation at the slot with address encoded as proxy address", async () => {
      const implementationAddress = randomAddress.address;
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
  });
  describe("call", async () => {
    it("reverts when trying to delegatecall to the EOA implementation", async () => {
      const implementationAddress = randomAddress.address;
      const Proxy = await ethers.getContractFactory(
        "contracts/smart-account/Proxy.sol:Proxy"
      );
      let proxy = await Proxy.deploy(implementationAddress);
      await proxy.deployed();
      proxy = await ethers.getContractAt("SmartAccount", proxy.address);
      await expect(proxy.getImplementation()).to.be.reverted;
    });
  });
});

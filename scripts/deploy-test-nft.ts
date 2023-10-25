import { Wallet } from "ethers";
import { ethers } from "hardhat";

(async () => {
  const [signer] = await ethers.getSigners();
  const wallet = signer;
  console.log(`Deploying contract with the account: ${wallet.address}`);

  if ((await wallet.getBalance()) < ethers.utils.parseEther("0.1")) {
    await signer.sendTransaction({
      to: wallet.address,
      value: ethers.utils.parseEther("0.1"),
    });
  }

  const factory = await ethers.getContractFactory("BiconomySdkNft", signer);
  const contract = await factory.deploy();
  await contract.deployed();

  console.log(`Contract deployed at ${contract.address}`);
  console.log(await contract.name());
})();

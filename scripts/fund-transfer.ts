import { formatEther, parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";

const to = "0xDb7dEe591333b2ff1eF13A91204E17665f3Ef2B7";
const value = parseEther("1");

(async () => {
  const [signer] = await ethers.getSigners();
  console.log(`Sending ${value} to ${to} from ${signer.address} `);
  console.log(
    `Sender Balance before: ${formatEther(await signer.getBalance())}`
  );
  console.log(
    `Recipient Balance before: ${formatEther(
      await ethers.provider.getBalance(to)
    )}`
  );

  const { hash, wait } = await signer.sendTransaction({ to, value });
  console.log(`Transaction hash: ${hash}`);
  await wait();

  console.log(
    `Sender Balance after: ${formatEther(await signer.getBalance())}`
  );
  console.log(
    `Recipient Balance after: ${formatEther(
      await ethers.provider.getBalance(to)
    )}`
  );
})();

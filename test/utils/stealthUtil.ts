import BN from "bn.js";
import { ec as EC } from "elliptic";
import { Wallet, utils, Signer } from "ethers";

const abiCoder = new utils.AbiCoder();
const ec = new EC("secp256k1");

export const getStealthAddressFromSigner = async (owner: Signer) => {
  const message = utils.arrayify("0x01");
  const sig = await owner.signMessage(message);
  const publicKey = utils.recoverPublicKey(utils.hashMessage(message), sig);
  const ownerPub = ec
    .keyFromPublic(utils.arrayify(publicKey), "hex")
    .getPublic();

  const ephemeralKey = ec.genKeyPair();
  const ephemeralPriv = ephemeralKey.getPrivate();

  const sharedSecret = ownerPub.mul(ephemeralPriv);
  const hashSharedSecret = utils.keccak256(
    abiCoder.encode(
      ["uint256", "uint256"],
      [sharedSecret.getX().toString(), sharedSecret.getY().toString()]
    )
  );

  const dhkey = ownerPub.mul(ec.keyFromPrivate(hashSharedSecret).getPrivate());

  const stealthPublic = ownerPub.add(
    ec.keyFromPrivate(hashSharedSecret).getPublic()
  );
  const compressPublic = "0x" + stealthPublic.encodeCompressed("hex");
  const stealthAddress = utils.computeAddress(compressPublic);

  return {
    stealthAddress: stealthAddress,
    stealthPub: stealthPublic.getX().toString(),
    dhkey: dhkey.getX().toString(),
    ephemeralPub: ephemeralKey.getPublic().getX().toString(),
    stealthPrefix: stealthPublic.getY().isEven() ? "0x02" : "0x03",
    dhkeyPrefix: dhkey.getY().isEven() ? "0x02" : "0x03",
    ephemeralPrefix: ephemeralKey.getPublic().getY().isEven() ? "0x02" : "0x03",
    hashSharedSecret,
  };
};

export const getStealthAddressFromWallet = async (owner: Wallet) => {
  const ownerPub = ec
    .keyFromPrivate(utils.arrayify(owner.privateKey))
    .getPublic();

  const ephemeralKey = ec.genKeyPair();
  const ephemeralPriv = ephemeralKey.getPrivate();

  const sharedSecret = ownerPub.mul(ephemeralPriv);
  const hashSharedSecret = utils.keccak256(
    abiCoder.encode(
      ["uint256", "uint256"],
      [sharedSecret.getX().toString(), sharedSecret.getY().toString()]
    )
  );

  const sharedPub = ec.keyFromPrivate(hashSharedSecret).getPublic();

  const stealthPrivate = ec
    .keyFromPrivate(hashSharedSecret)
    .getPrivate()
    .add(ec.keyFromPrivate(utils.arrayify(owner.privateKey)).getPrivate())
    .mod(ec.g.curve.n);
  const padStealthPrivate = stealthPrivate.toString("hex", 64);
  const wallet = new Wallet(utils.arrayify("0x" + padStealthPrivate));

  const dhkey = ownerPub.mul(ec.keyFromPrivate(hashSharedSecret).getPrivate());
  const stealthPub = ownerPub.add(sharedPub);

  return {
    stealthWallet: wallet,
    stealthAddress: wallet.address,
    stealthPub: stealthPub.getX().toString(),
    dhkey: dhkey.getX().toString(),
    ephemeralPub: ephemeralKey.getPublic().getX().toString(),
    stealthPrefix: stealthPub.getY().isEven() ? "0x02" : "0x03",
    dhkeyPrefix: dhkey.getY().isEven() ? "0x02" : "0x03",
    ephemeralPrefix: ephemeralKey.getPublic().getY().isEven() ? "0x02" : "0x03",
    hashSharedSecret,
  };
};

export const getAggregateSig = async (
  owner: Signer,
  sharedSecret: string,
  message: Uint8Array
) => {
  const sharedKey = ec.keyFromPrivate(sharedSecret);

  const hashMessage = utils.hashMessage(message);
  const ethesignatureHash = await owner.signMessage(message);
  const signature = {
    r: new BN(ethesignatureHash.slice(2, 66), "hex"),
    s: new BN(ethesignatureHash.slice(66, 130), "hex"),
  };

  const aggs = signature.s
    .mul(
      sharedKey
        .getPrivate()
        .mul(signature.r)
        .add(new BN(utils.arrayify(hashMessage), 16))
    )
    .umod(ec.g.curve.n);

  return utils.concat([
    "0x" + signature.r.toString(16, 32),
    "0x" + aggs.toString(16, 32),
  ]);
};

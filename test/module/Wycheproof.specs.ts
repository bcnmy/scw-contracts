import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";
import testVectors from "./PasskeyModule/ecdsa_secp256r1_sha256_test.json";
import { sha256 } from "ethereumjs-util";
// import elliptic from "elliptic";
// const ec = new elliptic.ec("p256");

describe("Passkeys Registry Module:", function () {
  // const [alice] = waffle.provider.getWallets();
  let secp256r1: Contract;

  it("Deploy spec256r1 contract", async () => {
    const secp256rInstance = await ethers.getContractFactory("Secp256r1");
    const secp256r1Deployment = await secp256rInstance.deploy();
    secp256r1 = secp256rInstance.attach(secp256r1Deployment.address);
  });

  it("check the test vectors", async () => {
    for (const tests of testVectors.testGroups) {
      const pubX = BigNumber.from("0x" + tests.key.wx);
      const pubY = BigNumber.from("0x" + tests.key.wy);

      for (const test of tests.tests) {
        const signatureHex = test.sig;

        // asn1 to decode DER-encoded signature as hex-string and get R and S
        const { R, S } = getDecodedSignature(signatureHex);
        if (R === 0 || S === 0 || R === "" || S === "") {
          expect(test.result === "invalid").to.be.equal(true);
          continue;
        }
        console.log("r and s", R, S);
        const rValue = BigNumber.from("0x" + R);
        const sValue = BigNumber.from("0x" + S);
        const hash =
          "0x" + sha256(Buffer.from(test.msg, "hex")).toString("hex");

        console.log(
          {
            pubKeyX: pubX,
            pubKeyY: pubY,
            keyId: "",
          },
          rValue,
          sValue,
          hash
        );

        const res = await secp256r1.Verify(
          {
            pubKeyX: pubX,
            pubKeyY: pubY,
            keyId: "",
          },
          rValue,
          sValue,
          hash
        );
        expect(res).to.equal(test.result === "valid");
      }
    }
  });

  function getDecodedSignature(signatureHex: string) {
    if (signatureHex.substr(0, 2) !== "30") {
      // TODO: check must invalid signature.
      return { R: 0, S: 0 };
    }

    let offset = 2;

    // Extract length of the sequence
    const lengthIndicator = parseInt(signatureHex.substr(offset, 2), 16);

    // Check if length is a single byte or multi-byte
    if ((lengthIndicator & 0x80) === 0) {
      // Length is a single byte
      offset += 2;
    } else {
      const numBytes = lengthIndicator & 0x7f;
      offset += 2 + numBytes * 2;
    }

    // Extract R
    if (signatureHex.substr(offset, 2) !== "02") {
      // TODO: check must invalid signature.
      return { R: 0, S: 0 };
    }
    offset += 2;

    const rLength = parseInt(signatureHex.substr(offset, 2), 16) * 2;
    offset += 2;

    const rValue = signatureHex.substr(offset, rLength);
    offset += rLength;

    // Extract S
    if (signatureHex.substr(offset, 2) !== "02") {
      // TODO: check must invalid signature.
      return { R: 0, S: 0 };
    }
    offset += 2;

    const sLength = parseInt(signatureHex.substr(offset, 2), 16) * 2;
    offset += 2;

    const sValue = signatureHex.substr(offset, sLength);

    return {
      R: rValue,
      S: sValue,
    };
  }
});

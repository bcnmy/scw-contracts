import { ethers } from "hardhat";
import {
  arrayify,
  // defaultAbiCoder,
  // hexConcat,
  parseEther,
  // solidityKeccak256,
} from "ethers/lib/utils";
import {
  BigNumber,
  // BigNumberish,
  // Contract,
  // ContractReceipt,
  Wallet,
} from "ethers";
/* import {
  IERC20,
  EntryPoint,
  EntryPoint__factory,
  SimpleWallet__factory,
} from "../typechain"; */
// import { BytesLike } from "@ethersproject/bytes";
// import { expect } from "chai";
// import { debugTransaction } from "./debugTx";
import { keccak256 } from "ethereumjs-util";

export const AddressZero = ethers.constants.AddressZero;
export const HashZero = ethers.constants.HashZero;
export const ONE_ETH = parseEther("1");
export const TWO_ETH = parseEther("2");
export const FIVE_ETH = parseEther("5");

export const tostr = (x: any) => (x != null ? x.toString() : "null");

let counter = 0;
// create non-random account, so gas calculations are deterministic
export function createWalletOwner(): Wallet {
  const privateKey = keccak256(
    Buffer.from(arrayify(BigNumber.from(++counter)))
  );
  return new ethers.Wallet(privateKey, ethers.provider);
  // return new ethers.Wallet('0x'.padEnd(66, privkeyBase), ethers.provider);
}

const panicCodes: { [key: number]: string } = {
  // from https://docs.soliditylang.org/en/v0.8.0/control-structures.html
  0x01: "assert(false)",
  0x11: "arithmetic overflow/underflow",
  0x12: "divide by zero",
  0x21: "invalid enum value",
  0x22: "storage byte array that is incorrectly encoded",
  0x31: ".pop() on an empty array.",
  0x32: "array sout-of-bounds or negative index",
  0x41: "memory overflow",
  0x51: "zero-initialized variable of internal function type",
};

export async function getBalance(address: string): Promise<number> {
  const balance = await ethers.provider.getBalance(address);
  return parseInt(balance.toString());
}

export function rethrow(): (e: Error) => void {
  const callerStack = new Error().stack
    ?.replace(/Error.*\n.*at.*\n/, "")
    .replace(/.*at.* \(internal[\s\S]*/, "");

  // if (arguments[0] != null) {
  //   throw new Error("must use .catch(rethrow()), and NOT .catch(rethrow)");
  // }
  return function (e: Error) {
    const solstack = e.stack?.match(/((?:.* at .*\.sol.*\n)+)/);
    const stack = (solstack != null ? solstack[1] : "") + callerStack;
    // const regex = new RegExp('error=.*"data":"(.*?)"').compile()
    const found = /error=.*?"data":"(.*?)"/.exec(e.message);
    let message: string;
    if (found != null) {
      const data = found[1];
      message =
        decodeRevertReason(data) ?? e.message + " - " + data.slice(0, 100);
    } else {
      message = e.message;
    }
    const err = new Error(message);
    err.stack = "Error: " + message + "\n" + stack;
    throw err;
  };
}

export function decodeRevertReason(
  data: string,
  nullIfNoMatch = true
): string | null {
  const methodSig = data.slice(0, 10);
  const dataParams = "0x" + data.slice(10);

  if (methodSig === "0x08c379a0") {
    const [err] = ethers.utils.defaultAbiCoder.decode(["string"], dataParams);
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `Error(${err})`;
  } else if (methodSig === "0x00fa072b") {
    const [opindex, paymaster, msg] = ethers.utils.defaultAbiCoder.decode(
      ["uint256", "address", "string"],
      dataParams
    );
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `FailedOp(${opindex}, ${
      paymaster !== AddressZero ? paymaster : "none"
    }, ${msg})`;
  } else if (methodSig === "0x4e487b71") {
    const [code] = ethers.utils.defaultAbiCoder.decode(["uint256"], dataParams);
    return `Panic(${panicCodes[code] ?? code} + ')`;
  }
  if (!nullIfNoMatch) {
    return data;
  }
  return null;
}

export function callDataCost(data: string): number {
  return ethers.utils
    .arrayify(data)
    .map((x) => (x === 0 ? 4 : 16))
    .reduce((sum, x) => sum + x);
}

export const Erc20 = [
  "function transfer(address _receiver, uint256 _value) public returns (bool success)",
  "function transferFrom(address, address, uint256) public returns (bool)",
  "function approve(address _spender, uint256 _value) public returns (bool success)",
  "function allowance(address _owner, address _spender) public view returns (uint256 remaining)",
  "function balanceOf(address _owner) public view returns (uint256 balance)",
  "event Approval(address indexed _owner, address indexed _spender, uint256 _value)",
];

export const Erc20Interface = new ethers.utils.Interface(Erc20);

export const SignMessageLib = [
  "function signMessageOnchain(bytes calldata _data) external",
];

export const SignMessageLibInterface = new ethers.utils.Interface(
  SignMessageLib
);

export const encodeTransfer = (
  target: string,
  amount: string | number
): string => {
  return Erc20Interface.encodeFunctionData("transfer", [target, amount]);
};

export const encodeTransferFrom = (
  from: string,
  target: string,
  amount: string | number
): string => {
  return Erc20Interface.encodeFunctionData("transferFrom", [
    from,
    target,
    amount,
  ]);
};

export const encodeSignMessage = (data: string): string => {
  return SignMessageLibInterface.encodeFunctionData("signMessageOnchain", [
    data,
  ]);
};

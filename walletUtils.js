// eslint-disable-next-line node/no-unpublished-require
const ethers = require("ethers");

const fs = require("fs");
const mnemonic = fs.readFileSync(".secret").toString().trim();

const makeKeyList = (
  num = 5,
  mn = mnemonic,
  index = 0,
  path = "m/44'/60'/0'/0/"
) => {
  return [];
};

const makeSignerList = (
  num = 1,
  mn = mnemonic,
  index = 0,
  path = "m/44'/60'/0'/0/"
) => {
    return [];
};

const localWallet = (
  b,
  num = 1,
  mn = mnemonic,
  index = 0,
  path = "m/44'/60'/0'/0/"
) => {
    return [];
};

const ganacheWallet = (
  b,
  num = 1,
  mn = mnemonic,
  index = 0,
  path = "m/44'/60'/0'/0/"
) => {
    return [];
};

const walletUtils = () => {};
walletUtils.makeKeyList = makeKeyList;
walletUtils.makeSignerList = makeSignerList;
walletUtils.localWallet = localWallet;
walletUtils.ganacheWallet = ganacheWallet;

module.exports = walletUtils;

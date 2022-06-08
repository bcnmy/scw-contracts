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
  const accounts = [];
  let i;
  for (i = 0; i < num; i++) {
    accounts.push(ethers.Wallet.fromMnemonic(mn, path + i).privateKey);
  }
  return accounts;
};

const makeSignerList = (
  num = 1,
  mn = mnemonic,
  index = 0,
  path = "m/44'/60'/0'/0/"
) => {
  const accounts = [];
  let i;
  for (i = 0; i < num; i++) {
    accounts.push(ethers.Wallet.fromMnemonic(mn, path + i));
  }
  return accounts;
};

const localWallet = (
  b,
  num = 1,
  mn = mnemonic,
  index = 0,
  path = "m/44'/60'/0'/0/"
) => {
  const hdW = makeKeyList(num, mn, index, path);
  const lW = [];
  let i;
  for (i = 0; i < hdW.length; i++) {
    lW.push({ privateKey: hdW[i], balance: b });
  }
  return lW;
};

const ganacheWallet = (
  b,
  num = 1,
  mn = mnemonic,
  index = 0,
  path = "m/44'/60'/0'/0/"
) => {
  const hdW = makeKeyList(num, mn, index, path);
  const lW = [];
  let i;
  for (i = 0; i < hdW.length; i++) {
    lW.push({ secretKey: hdW[i], balance: b });
  }
  return lW;
};

const walletUtils = () => {};
walletUtils.makeKeyList = makeKeyList;
walletUtils.makeSignerList = makeSignerList;
walletUtils.localWallet = localWallet;
walletUtils.ganacheWallet = ganacheWallet;

module.exports = walletUtils;

module.exports = {
  configureYulOptimizer: true,
  skipFiles: [
  'references', 
  'smart-contract-wallet/test',
  'smart-contract-wallet/SmartWalletNoAuth.sol',
  'smart-contract-wallet/utils',
],
};
module.exports = {
  configureYulOptimizer: true,
  skipFiles: [
  'references', 
  'smart-contract-wallet/test',
  'smart-contract-wallet/SmartAccountNoAuth.sol',
  'smart-contract-wallet/utils',
],
providerOptions: {
  allowUnlimitedContractSize: true,
},
};
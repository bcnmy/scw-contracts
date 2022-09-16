// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "../aa-4337/interfaces/IWallet.sol";

interface ISmartWallet is IWallet {
    function init(address _owner, address _entryPoint, address _handler) external;
    
    //@review
    // function execTransaction() external;
}
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;
import "../../SmartWallet.sol";

contract WhitelistModule {

    mapping(address => bool) public whitelisted;
    address public moduleOwner;

    constructor(address _owner) {
        moduleOwner = _owner;
    }

    modifier onlyOwner {
        require(msg.sender == moduleOwner, "sender not authorized");
        _;
    }

    function whitelistDestination(address payable _target) external onlyOwner {
        require(_target != address(0),"Destination target can not be zero address");
        whitelisted[_target] = true;
    }
    
    function authCall(SmartWallet _safe, address payable _to, uint96 _amount, bytes memory _data) external { // Could have some access control from here like guardians!
       require(_to != address(0),"Target can not be zero address");
       require(whitelisted[_to] == true,"Unauthorized :: Target must be whitelised!");
       require(_safe.execTransactionFromModule(_to, _amount, _data, Enum.Operation.Call), "Could not execute ether transfer");
    }

    // If value transfer required from wallet
    /*function handlePayment(
        BaseWallet safe,
        uint256 gasUsed,
        uint256 dataGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver
    )
        private
    {
        uint256 amount = (gasUsed - gasleft() + dataGas) * gasPrice;
        // solium-disable-next-line security/no-tx-origin
        address receiver = refundReceiver == address(0) ? tx.origin : refundReceiver;
        if (gasToken == address(0)) {
            // solium-disable-next-line security/no-send
            require(safe.execTransactionFromModule(receiver, amount, "", Enum.Operation.Call), "Could not pay gas costs with ether");
        } else {
            bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", receiver, amount);
            require(safe.execTransactionFromModule(gasToken, 0, data, Enum.Operation.Call), "Could not pay gas costs with token");
        }
    }*/
}
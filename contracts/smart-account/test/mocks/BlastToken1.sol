// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../interfaces/IBlast.sol";

contract BlastToken1 is ERC20 {

    address public constant BLAST = 0x4300000000000000000000000000000000000002;

    constructor() ERC20("TST1", "MockToken") {
        IBlast(BLAST).configureClaimableGas();
        IBlast(BLAST).configureAutomaticYield();
    }

    function mint(address sender, uint256 amount) external {
        _mint(sender, amount);
    }

    function claimYield(address recipient, uint256 amount) external {
	  //This function is public meaning anyone can claim the yield
		IBlast(BLAST).claimYield(address(0), recipient, amount);
    }

	function claimAllYield(address recipient) external {
	  //This function is public meaning anyone can claim the yield
		IBlast(BLAST).claimAllYield(address(0), recipient);
    }

    function claimAllGas(address recipient) external {
	    // This function is public meaning anyone can claim the gas
		IBlast(BLAST).claimAllGas(address(0), recipient);
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }

    receive() external payable {
    }

}

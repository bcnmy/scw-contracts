// SPDX-License-Identifier: MIT

pragma solidity ^0.8.23;

import {SATestBase} from "./SATestBase.sol";
import "registry/test/utils/BaseTest.t.sol";

contract RhinestoneTestBase is SATestBase, BaseTest {
    function setUp() public virtual override(SATestBase, BaseTest) {
        SATestBase.setUp();
        BaseTest.setUp();

        vm.label(address(instancel1.registry), "Rhinestone Registry");
    }
}

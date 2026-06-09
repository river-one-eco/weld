// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.34;

import { IERC20 } from "./IERC20.sol";
import { A, B }   from "./AB.sol";

interface IThing {

    event Did(address indexed who, uint256 amount);

    function doIt(uint256 a, address b) external;

    function removeThing(address _contract, bytes32 _kind) external onlyOwner;

}

contract Thing {

    mapping (address => uint256) balances;

    struct S {
        address target;    // the target
        bytes4  selector;  // the selector
        uint64  minDelay;  // the delay
    }

    function setUp(address admin, uint64 delay) external onlyOwner {
        uint256 x = compute();

        require(x != 0, "Thing/zero");

        doThing(x, 1);

        emit Did(msg.sender, x);

        for (uint256 i; i < 3; ++i) {
            _step(i);
        }

        // done
        return;
    }

    function removeInstanceForGivenKind(address _contractAddr, bytes32 _instanceKind)
        external
        onlyTimelockExecutor
    {
        _removeInstance(_contractAddr, _instanceKind);
    }

}

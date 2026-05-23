// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PriceVotingWithdrawal {
    constructor(IERC20 _token, uint256 _votingEnd) {
        // TODO: store token and votingEnd somewhere your read functions can return them
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PriceVoting {
    constructor(IERC20 _token, uint256 _votingEnd) {
        // TODO: store token and votingEnd somewhere your read functions can return them
    }

    // ----- Write functions -----

    function vote(uint256 price, uint256 amount) external {
        // TODO
    }

    function finalize() external {
        // TODO
    }

    function claim() external {
        // TODO
    }

    // ----- Read functions (required interface) -----

    function token() external view returns (IERC20) {
        // TODO: return the token address
    }

    function votingEnd() external view returns (uint256) {
        // TODO: return the voting end timestamp
    }

    function weightOf(uint256 price) external view returns (uint256) {
        // TODO: return the total weight for a given price
    }

    function lockedOf(address voter) external view returns (uint256) {
        // TODO: return how many tokens `voter` has locked in the contract
    }

    function leader() external view returns (uint256 price, uint256 weight) {
        // TODO: return the current leading price and its accumulated weight
    }

    function currentTokenPrice() external view returns (uint256) {
        // TODO: return the finalized price
    }

    function finalized() external view returns (bool) {
        // TODO: return whether finalize() has been called
    }
}

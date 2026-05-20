// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "./IERC20.sol";

contract Token is IERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    // TODO: declare storage for totalSupply, balances, and allowances.

    constructor(string memory name_, string memory symbol_, uint256 initialSupply) {
        name = name_;
        symbol = symbol_;
        // TODO: credit `initialSupply` to msg.sender and emit a Transfer event
        //       from the zero address to msg.sender for the same amount.
    }

    function totalSupply() external view returns (uint256) {
        // TODO
    }

    function balanceOf(address account) external view returns (uint256) {
        // TODO
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        // TODO
    }

    function transfer(address to, uint256 value) external returns (bool) {
        // TODO
    }

    function approve(address spender, uint256 value) external returns (bool) {
        // TODO
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        // TODO
    }
}

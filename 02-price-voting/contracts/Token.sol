// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Token is IERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    constructor(string memory name_, string memory symbol_, uint256 initialSupply) {
        name = name_;
        symbol = symbol_;
    }

    function totalSupply() external view returns (uint256) {
        return 0;
    }

    function balanceOf(address account) external view returns (uint256) {
        return 0;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return 0;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return false;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        return false;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        return false;
    }
}

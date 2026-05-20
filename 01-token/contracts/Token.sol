// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "./IERC20.sol";

contract Token is IERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 private supply;
    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowed;

    error InsufficientBalance();
    error InsufficientAllowance();
    error TransferToZeroAddress();
    error ApproveToZeroAddress();

    constructor(string memory name_, string memory symbol_, uint256 initialSupply) {
        name = name_;
        symbol = symbol_;
        supply = initialSupply;
        balances[msg.sender] = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function totalSupply() external view returns (uint256) {
        return supply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return allowed[owner][spender];
    }

    function transfer(address to, uint256 value) external returns (bool) {
        if (to == address(0)) {
            revert TransferToZeroAddress();
        }

        uint256 senderBalance = balances[msg.sender];
        uint256 receiverBalance = balances[to];

        if (senderBalance < value) {
            revert InsufficientBalance();
        }

        balances[msg.sender] = senderBalance - value;
        balances[to] = receiverBalance + value;

        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        if (spender == address(0)) {
            revert ApproveToZeroAddress();
        }

        allowed[msg.sender][spender] = value;

        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        if (to == address(0)) {
            revert TransferToZeroAddress();
        }
        if (allowed[from][msg.sender] < value) {
            revert InsufficientAllowance();
        }
        if (balances[from] < value) {
            revert InsufficientBalance();
        }

        allowed[from][msg.sender] = allowed[from][msg.sender] - value;
        balances[from] = balances[from] - value;
        balances[to] = balances[to] + value;

        emit Transfer(from, to, value);
        return true;
    }
}

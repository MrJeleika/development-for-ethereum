// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// PriceVoting with mid-voting withdrawal.
// Reuses the structure from the previous task. The only change is that
// voters can withdraw their locked tokens at any time, including during
// the voting period. On withdrawal we decrement weightOf[price] so the
// price's weight stays accurate, and the leader pointer keeps reflecting
// whichever price has the highest weight.

contract PriceVotingWithdrawal {
    IERC20 public token;
    uint256 public votingEnd;

    // price -> total weight currently locked behind that price
    mapping(uint256 => uint256) public weightOf;
    // voter -> total amount of tokens they have locked
    mapping(address => uint256) public lockedOf;
    // voter -> price -> how much that voter locked behind that specific price
    // (needed so withdraw knows which price's weight to reduce)
    mapping(address => mapping(uint256 => uint256)) public lockedFor;

    // current leader
    uint256 public leaderPrice;
    uint256 public leaderWeight;

    uint256 public currentTokenPrice;
    bool public finalized;

    error VotingEnded();
    error VotingActive();
    error AlreadyFinalized();
    error ZeroAmount();
    error InsufficientLocked();
    error TransferFailed();

    event Voted(address indexed voter, uint256 indexed price, uint256 amount);
    event Withdrawn(address indexed voter, uint256 indexed price, uint256 amount);
    event PriceFinalized(uint256 indexed price, uint256 weight);

    constructor(IERC20 _token, uint256 _votingEnd) {
        token = _token;
        votingEnd = _votingEnd;
    }

    function vote(uint256 price, uint256 amount) external {
        if (block.timestamp >= votingEnd) revert VotingEnded();
        if (amount == 0) revert ZeroAmount();

        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        lockedOf[msg.sender] += amount;
        lockedFor[msg.sender][price] += amount;
        weightOf[price] += amount;

        // update leader if this price now has the highest weight
        if (weightOf[price] > leaderWeight) {
            leaderPrice = price;
            leaderWeight = weightOf[price];
        }

        emit Voted(msg.sender, price, amount);
    }

    function withdraw(uint256 price, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 locked = lockedFor[msg.sender][price];
        if (locked < amount) revert InsufficientLocked();

        // CEI: decrement accounting before transferring tokens out.
        lockedFor[msg.sender][price] = locked - amount;
        lockedOf[msg.sender] -= amount;
        weightOf[price] -= amount;

        emit Withdrawn(msg.sender, price, amount);

        bool ok = token.transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();
    }

    function finalize() external {
        if (block.timestamp < votingEnd) revert VotingActive();
        if (finalized) revert AlreadyFinalized();

        finalized = true;
        if (leaderWeight > 0) {
            currentTokenPrice = leaderPrice;
        }

        emit PriceFinalized(leaderPrice, leaderWeight);
    }

    function leader() external view returns (uint256 price, uint256 weight) {
        return (leaderPrice, leaderWeight);
    }
}

// ============================================================================
// Reflection
// ============================================================================
//
// I reused the same leader pointer pattern from the previous task. On every
// vote() I compare the price's new weight against the cached leaderWeight
// and update the pointer when it grows past the current best. withdraw()
// just decrements weightOf[price] alongside lockedFor and lockedOf, so the
// weight totals stay accurate as voters move tokens out.
//
// The simpler pattern from the previous task would only break if I didn't
// keep weightOf in sync on withdrawal. Since I decrement it on every
// withdraw(), the leader pointer continues to reflect the heaviest price
// when finalize() runs.
//
// ============================================================================

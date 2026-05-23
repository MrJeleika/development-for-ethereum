// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// PriceVoting contract for the 02 task.
// Users vote for a price by locking tokens. After voting ends anyone can
// call finalize() to pick the winner, and voters can call claim() to get
// their tokens back.

contract PriceVoting {
    IERC20 public token;
    uint256 public votingEnd;

    // price -> total weight locked behind that price
    mapping(uint256 => uint256) public weightOf;
    // voter -> total amount of tokens they have locked
    mapping(address => uint256) public lockedOf;

    // current leader (price with most weight so far)
    uint256 public leaderPrice;
    uint256 public leaderWeight;

    uint256 public currentTokenPrice;
    bool public finalized;

    error VotingEnded();
    error VotingActive();
    error AlreadyFinalized();
    error ZeroAmount();
    error NothingToClaim();
    error TransferFailed();

    event Voted(address indexed voter, uint256 indexed price, uint256 amount);
    event PriceFinalized(uint256 indexed price, uint256 weight);
    event Claimed(address indexed voter, uint256 amount);

    constructor(IERC20 _token, uint256 _votingEnd) {
        token = _token;
        votingEnd = _votingEnd;
    }

    function vote(uint256 price, uint256 amount) external {
        if (block.timestamp >= votingEnd) revert VotingEnded();
        if (amount == 0) revert ZeroAmount();

        // pull tokens from the voter
        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        // update accounting
        lockedOf[msg.sender] = lockedOf[msg.sender] + amount;
        weightOf[price] = weightOf[price] + amount;

        // update leader if this price now has the highest weight
        if (weightOf[price] > leaderWeight) {
            leaderPrice = price;
            leaderWeight = weightOf[price];
        }

        emit Voted(msg.sender, price, amount);
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

    function claim() external {
        if (block.timestamp < votingEnd) revert VotingActive();

        uint256 amount = lockedOf[msg.sender];
        if (amount == 0) revert NothingToClaim();

        // CEI: zero the locked balance before the external token call to
        // prevent reentrancy through tokens with transfer hooks.
        lockedOf[msg.sender] = 0;

        emit Claimed(msg.sender, amount);

        bool ok = token.transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();
    }

    // required getter from the spec
    function leader() external view returns (uint256 price, uint256 weight) {
        return (leaderPrice, leaderWeight);
    }
}

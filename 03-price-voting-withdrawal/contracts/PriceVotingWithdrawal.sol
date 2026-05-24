// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// PriceVotingWithdrawal — mid-voting withdrawal supported.
//
// Design choice: hybrid lazy + authoritative.
//
// During the voting period the contract maintains a cheap lazy leader
// pointer, updated only on vote() when a new weight exceeds the cached
// best. Withdrawals do NOT touch the pointer (that would require knowing
// the new max, i.e. iteration). This keeps vote() and withdraw() O(1).
//
// After voting ends, finalize() does one authoritative scan over every
// distinct price ever voted on, computes the true max from the current
// weightOf values (post-withdrawals), and snapshots it as the winner.
// That way the read path is fast during voting and the settlement step
// is correct even after arbitrary mid-voting withdrawals.
//
// Reflection: the naive task-02 pattern (cached leader only updated on
// vote) goes stale after a leader's voter withdraws — the cached weight
// stays high and no future vote can dethrone it because the comparison
// is against the stale cache. The authoritative scan in finalize() side-
// steps that problem entirely by recomputing from current weights.

contract PriceVotingWithdrawal {
    IERC20 public token;
    uint256 public votingEnd;

    mapping(uint256 => uint256) public weightOf;
    mapping(address => uint256) public lockedOf;
    mapping(address => mapping(uint256 => uint256)) public lockedFor;

    // every distinct price that has ever received a vote
    uint256[] public allPrices;
    mapping(uint256 => bool) public priceSeen;

    // lazy pointer used for cheap reads during voting
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

        if (!priceSeen[price]) {
            priceSeen[price] = true;
            allPrices.push(price);
        }

        lockedOf[msg.sender] += amount;
        lockedFor[msg.sender][price] += amount;
        uint256 newWeight = weightOf[price] + amount;
        weightOf[price] = newWeight;

        // optimistic lazy pointer; finalize() does the real check
        if (newWeight > leaderWeight) {
            leaderPrice = price;
            leaderWeight = newWeight;
        }

        emit Voted(msg.sender, price, amount);
    }

    function withdraw(uint256 price, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 locked = lockedFor[msg.sender][price];
        if (locked < amount) revert InsufficientLocked();

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

        // authoritative O(n) scan over every distinct price.
        // recomputes the true leader using current weightOf, which
        // already reflects every withdrawal.
        uint256 bestPrice = 0;
        uint256 bestWeight = 0;
        uint256 n = allPrices.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 p = allPrices[i];
            uint256 w = weightOf[p];
            if (w > bestWeight) {
                bestPrice = p;
                bestWeight = w;
            }
        }

        if (bestWeight > 0) {
            currentTokenPrice = bestPrice;
        }

        emit PriceFinalized(bestPrice, bestWeight);
    }

    function leader() external view returns (uint256 price, uint256 weight) {
        return (leaderPrice, leaderWeight);
    }
}

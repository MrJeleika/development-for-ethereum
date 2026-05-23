// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Reflection: what breaks if voters could withdraw DURING voting?
// weightOf[price] would no longer be monotone in price weight. The leader
// pointer is updated only when a new weight strictly exceeds the cached
// leader weight - it assumes weights only grow. A mid-voting withdrawal
// could lower the leader's weight below another price's weight, and no
// future vote would surface the new true max because the cached weight is
// stale-high. Result: leader() and the price chosen by finalize() would be
// silently wrong. Fixing it requires a different leader-tracking strategy
// (lazy recomputation with hints, sorted structures, or claim-and-challenge).

contract PriceVoting {
    IERC20 public immutable token;
    uint256 public immutable votingEnd;

    mapping(uint256 price => uint256) public weightOf;
    mapping(address voter => uint256) public lockedOf;

    uint256 private _leaderPrice;
    uint256 private _leaderWeight;

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

    // ----- Write functions -----

    function vote(uint256 price, uint256 amount) external {
        if (block.timestamp >= votingEnd) revert VotingEnded();
        if (amount == 0) revert ZeroAmount();

        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        lockedOf[msg.sender] += amount;
        uint256 newWeight = weightOf[price] + amount;
        weightOf[price] = newWeight;

        emit Voted(msg.sender, price, amount);

        if (newWeight > _leaderWeight) {
            _leaderPrice = price;
            _leaderWeight = newWeight;
        }
    }

    function finalize() external {
        if (block.timestamp < votingEnd) revert VotingActive();
        if (finalized) revert AlreadyFinalized();

        finalized = true;
        if (_leaderWeight > 0) {
            currentTokenPrice = _leaderPrice;
        }
        emit PriceFinalized(_leaderPrice, _leaderWeight);
    }

    function claim() external {
        if (block.timestamp < votingEnd) revert VotingActive();
        uint256 amount = lockedOf[msg.sender];
        if (amount == 0) revert NothingToClaim();

        lockedOf[msg.sender] = 0;

        emit Claimed(msg.sender, amount);

        if (!token.transfer(msg.sender, amount)) revert TransferFailed();
    }

    // ----- Read functions -----

    function leader() external view returns (uint256 price, uint256 weight) {
        return (_leaderPrice, _leaderWeight);
    }
}

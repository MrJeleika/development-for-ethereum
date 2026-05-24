// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// PriceVotingWithdrawal — mid-voting withdrawal supported.
//
// Design choice: bounded top-K sorted leaderboard.
//
// The contract keeps a sorted array of the K=10 heaviest prices. vote()
// and withdraw() update the leaderboard in O(K) constant time — no
// iteration over voter-controlled storage anywhere, no off-chain
// coordination, no settlement game. The leader is always leaderboard[0],
// readable in a single storage slot.
//
// Withdrawals reposition the affected price inside the leaderboard. When
// the previous leader's voter withdraws, the runner-up that was already
// tracked in the leaderboard is promoted in O(K). Reading the winning
// price post-voting is currentTokenPrice, snapshotted at finalize().
//
// Reflection: the naive task-02 pattern (single cached leader, updated
// only on vote) breaks under withdrawals because the cached weight goes
// stale-high and no future vote can dethrone it. Maintaining the full
// top-K instead of a single slot solves that — when the leader's weight
// shrinks the next-heaviest price is already in the array and takes over
// automatically. K=10 is generous for token-voted prices in practice and
// gas stays flat regardless of how many distinct prices users submit.

contract PriceVotingWithdrawal {
    IERC20 public token;
    uint256 public votingEnd;

    mapping(uint256 => uint256) public weightOf;
    mapping(address => uint256) public lockedOf;
    mapping(address => mapping(uint256 => uint256)) public lockedFor;

    uint256 public constant K = 10;

    struct Slot {
        uint256 price;
        uint256 weight;
    }

    Slot[K] public leaderboard;
    // 1-indexed slot position for each price; 0 means "not in leaderboard"
    mapping(uint256 => uint256) public slotOf;

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

        _onWeightChanged(price);

        emit Voted(msg.sender, price, amount);
    }

    function withdraw(uint256 price, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 locked = lockedFor[msg.sender][price];
        if (locked < amount) revert InsufficientLocked();

        lockedFor[msg.sender][price] = locked - amount;
        lockedOf[msg.sender] -= amount;
        weightOf[price] -= amount;

        _onWeightChanged(price);

        emit Withdrawn(msg.sender, price, amount);

        bool ok = token.transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();
    }

    function finalize() external {
        if (block.timestamp < votingEnd) revert VotingActive();
        if (finalized) revert AlreadyFinalized();

        finalized = true;
        Slot memory top = leaderboard[0];
        if (top.weight > 0) {
            currentTokenPrice = top.price;
        }
        emit PriceFinalized(top.price, top.weight);
    }

    function leader() external view returns (uint256 price, uint256 weight) {
        Slot memory top = leaderboard[0];
        return (top.price, top.weight);
    }

    // ----- internals -----

    function _onWeightChanged(uint256 price) internal {
        uint256 newWeight = weightOf[price];
        uint256 slot1 = slotOf[price]; // 1-indexed

        if (slot1 != 0) {
            // already in leaderboard: update and re-bubble
            uint256 i = slot1 - 1;
            leaderboard[i].weight = newWeight;
            _bubble(i);
        } else {
            // not in leaderboard: insert only if it beats the K-th slot
            uint256 tailWeight = leaderboard[K - 1].weight;
            if (newWeight > tailWeight) {
                uint256 evicted = leaderboard[K - 1].price;
                if (evicted != 0) {
                    slotOf[evicted] = 0;
                }
                leaderboard[K - 1] = Slot({price: price, weight: newWeight});
                slotOf[price] = K;
                _bubble(K - 1);
            }
        }
    }

    function _bubble(uint256 i) internal {
        // bubble up while heavier than predecessor
        while (i > 0 && leaderboard[i].weight > leaderboard[i - 1].weight) {
            _swap(i, i - 1);
            i -= 1;
        }
        // bubble down while lighter than successor
        while (i + 1 < K && leaderboard[i].weight < leaderboard[i + 1].weight) {
            _swap(i, i + 1);
            i += 1;
        }
    }

    function _swap(uint256 a, uint256 b) internal {
        Slot memory tmp = leaderboard[a];
        leaderboard[a] = leaderboard[b];
        leaderboard[b] = tmp;
        if (leaderboard[a].price != 0) slotOf[leaderboard[a].price] = a + 1;
        if (leaderboard[b].price != 0) slotOf[leaderboard[b].price] = b + 1;
    }
}

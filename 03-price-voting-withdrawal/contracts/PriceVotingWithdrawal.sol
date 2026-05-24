// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ============================================================================
// Required call order
// ============================================================================
//
// The contract has three sequential phases gated by timestamps:
//
//   [0,                    votingEnd) - VOTING
//     - vote(price, amount): lock tokens behind a price.
//     - withdraw(price, amount): pull tokens back out.
//
//   [votingEnd,            settleEnd) - SETTLEMENT
//     - propagate(candidate): only callable by voters (lockedOf > 0).
//       Verifies, in O(1), that weightOf[candidate] > weightOf[leaderPrice]
//       reading both weights fresh from storage. If so, updates the leader
//       pointer and records msg.sender as the propagator. The caller's
//       claimedLeaderOf is set to `candidate` regardless of whether the
//       pointer moved (so a voter who propagates the price already at the
//       top still registers their claim).
//     - vote / withdraw revert during settlement so weights cannot be
//       moved mid-propagation.
//
//   [settleEnd,            infinity) - CLAIM
//     - claim(): if the caller propagated the actual winning price, they
//       receive their lockedOf back. Otherwise their lockedOf is moved
//       into the forfeited pool.
//     - claimBonus(): the propagator (the address that last moved the
//       leader pointer during settlement, which is the same address that
//       first propagated the actual winning price) sweeps the entire
//       current forfeited pool. They should call this AFTER all other
//       voters have called claim() so the pool is fully formed.
//
// Reflection
//
// I picked a lazy leader pointer that anyone can poke after voting ends,
// guarded by a deposit-and-slash game. propagate(candidate) does no
// iteration - it only reads weightOf[candidate] and weightOf[leaderPrice]
// and compares them. The work pushed off-chain is "find the price with
// the highest current weight"; the contract verifies the hint in two SLOADs.
//
// The naive pattern from the previous task (update leader pointer only on
// vote, never refresh it on withdrawal) breaks here because mid-voting
// withdrawals can shrink a leader's weight below another price's weight.
// The cached pointer is stale-high and no future vote can dethrone it
// because the comparison is against the stale cached weight, not the
// current weightOf. Reading weightOf fresh on every propagate fixes that.
//
// The slashing layer (forfeited tokens flow to the first correct
// propagator) creates an incentive for at least one voter to do the
// off-chain work and propagate the true max, so the contract converges on
// the right answer without on-chain iteration.
//
// ============================================================================

contract PriceVotingWithdrawal {
    IERC20 public token;
    uint256 public votingEnd;
    uint256 public settleEnd;

    // price -> total weight locked behind that price
    mapping(uint256 => uint256) public weightOf;
    // voter -> total amount of tokens they have locked
    mapping(address => uint256) public lockedOf;
    // voter -> price -> how much that voter locked behind that specific price
    mapping(address => mapping(uint256 => uint256)) public lockedFor;

    // current best-known leader. The pointer is updated optimistically on
    // every vote, but withdrawals can leave it stale. It is corrected
    // during settlement by propagate().
    uint256 public leaderPrice;
    // address that last moved the leader pointer during settlement; entitled
    // to sweep the forfeited pool.
    address public propagator;

    // voter -> the price they propagated as the winner during settlement
    mapping(address => uint256) public claimedLeaderOf;
    mapping(address => bool) public hasPropagated;
    mapping(address => bool) public hasClaimed;

    // sum of locked tokens forfeited by wrong/no-claim voters
    uint256 public forfeitedPool;
    bool public bonusClaimed;

    error VotingPhaseOnly();
    error SettlementPhaseOnly();
    error ClaimPhaseOnly();
    error ZeroAmount();
    error InsufficientLocked();
    error NotAVoter();
    error NotABetterCandidate();
    error AlreadyClaimed();
    error NotPropagator();
    error BonusAlreadyClaimed();
    error TransferFailed();

    event Voted(address indexed voter, uint256 indexed price, uint256 amount);
    event Withdrawn(address indexed voter, uint256 indexed price, uint256 amount);
    event Propagated(address indexed voter, uint256 indexed price, uint256 weight);
    event Claimed(address indexed voter, uint256 amount, bool correct);
    event BonusClaimed(address indexed propagator, uint256 amount);

    constructor(IERC20 _token, uint256 _votingEnd, uint256 _settleDuration) {
        token = _token;
        votingEnd = _votingEnd;
        settleEnd = _votingEnd + _settleDuration;
    }

    // ----- VOTING phase -----

    function vote(uint256 price, uint256 amount) external {
        if (block.timestamp >= votingEnd) revert VotingPhaseOnly();
        if (amount == 0) revert ZeroAmount();

        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        lockedOf[msg.sender] += amount;
        lockedFor[msg.sender][price] += amount;
        uint256 newWeight = weightOf[price] + amount;
        weightOf[price] = newWeight;

        // optimistic leader pointer update; may go stale on later withdrawals
        if (newWeight > weightOf[leaderPrice]) {
            leaderPrice = price;
        }

        emit Voted(msg.sender, price, amount);
    }

    function withdraw(uint256 price, uint256 amount) external {
        if (block.timestamp >= votingEnd) revert VotingPhaseOnly();
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

    // ----- SETTLEMENT phase -----

    function propagate(uint256 candidate) external {
        if (block.timestamp < votingEnd || block.timestamp >= settleEnd) revert SettlementPhaseOnly();
        if (lockedOf[msg.sender] == 0) revert NotAVoter();

        uint256 candidateWeight = weightOf[candidate];
        uint256 currentLeaderWeight = weightOf[leaderPrice];

        if (candidateWeight > currentLeaderWeight) {
            leaderPrice = candidate;
            propagator = msg.sender;
            emit Propagated(msg.sender, candidate, candidateWeight);
        } else if (candidate == leaderPrice) {
            // Candidate matches the current pointer. If no one has claimed
            // propagator status yet (e.g., the vote-time pointer is already
            // correct), the first caller takes it.
            if (propagator == address(0)) {
                propagator = msg.sender;
                emit Propagated(msg.sender, candidate, candidateWeight);
            }
        } else {
            // candidate is strictly worse than current leader; pointless claim
            revert NotABetterCandidate();
        }

        claimedLeaderOf[msg.sender] = candidate;
        hasPropagated[msg.sender] = true;
    }

    // ----- CLAIM phase -----

    function claim() external {
        if (block.timestamp < settleEnd) revert ClaimPhaseOnly();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        uint256 myLocked = lockedOf[msg.sender];
        if (myLocked == 0) revert InsufficientLocked();

        hasClaimed[msg.sender] = true;
        lockedOf[msg.sender] = 0;

        bool correct = hasPropagated[msg.sender] && claimedLeaderOf[msg.sender] == leaderPrice;

        if (!correct) {
            // forfeit: tokens stay in the contract, accounted for in the pool
            forfeitedPool += myLocked;
            emit Claimed(msg.sender, 0, false);
            return;
        }

        emit Claimed(msg.sender, myLocked, true);

        bool ok = token.transfer(msg.sender, myLocked);
        if (!ok) revert TransferFailed();
    }

    function claimBonus() external {
        if (block.timestamp < settleEnd) revert ClaimPhaseOnly();
        if (msg.sender != propagator) revert NotPropagator();
        if (bonusClaimed) revert BonusAlreadyClaimed();

        uint256 amount = forfeitedPool;
        bonusClaimed = true;
        forfeitedPool = 0;

        emit BonusClaimed(msg.sender, amount);

        if (amount > 0) {
            bool ok = token.transfer(msg.sender, amount);
            if (!ok) revert TransferFailed();
        }
    }

    // ----- Reads -----

    function leader() external view returns (uint256 price, uint256 weight) {
        return (leaderPrice, weightOf[leaderPrice]);
    }

    function currentTokenPrice() external view returns (uint256) {
        if (block.timestamp < settleEnd) return 0;
        return leaderPrice;
    }
}

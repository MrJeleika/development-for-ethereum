// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// PriceVotingWithdrawal — sorted doubly-linked list with caller hints.
//
// Design choice: maintain a doubly-linked list of every distinct price
// that has been voted on, sorted descending by weight. head is always
// the current leader. Every state-changing call (vote, withdraw) takes
// (prevHint, nextHint) telling the contract where the affected price
// belongs in the list after the weight change. The contract verifies the
// hint in O(1) by:
//
//   1. Weight ordering:
//        - weightOf[prevHint] >= newWeight  (allows ties above)
//        - weightOf[nextHint] <  newWeight  (strict; ties stay above the
//          newcomer, enforcing "first-to-arrive at a given weight wins")
//      with the sentinel value 0 meaning "no neighbor on that side" (i.e.
//      inserting at head or at tail).
//   2. Structural adjacency:
//        - expected next of prevHint == nextHint
//        - expected prev of nextHint == prevHint
//      This is the security-critical check: without it an attacker can
//      pass a weight-valid (prev, next) pair that isn't actually adjacent
//      in the current list and splice the leader out of the chain. With
//      it, every reachable insertion point is structurally one specific
//      slot.
//
// vote / withdraw are O(1) given correct hints. Hints can be computed
// off-chain by walking the public list (head + nodes mapping) — voters
// or any keeper can produce them. A mid-voting withdrawal that drops
// the leader's weight is handled the same way as any other reposition:
// the caller passes hints for the leader's new (lower) slot, the leader
// is unlinked and re-spliced, and head naturally advances to the next
// node in the chain.
//
// Reflection: the naive task-02 pattern (single cached leader, updated
// only on vote when newWeight > leaderWeight) goes stale-high after a
// leader withdrawal — the cached weight stays at the pre-withdrawal
// value and no later vote can dethrone it. The sorted list avoids that
// failure mode entirely: leader is always read from the current head,
// and the head is always whoever has the most weight in the list, because
// every weight change is followed by an immediate reposition.

contract PriceVotingWithdrawal {
    IERC20 public token;
    uint256 public votingEnd;

    mapping(uint256 => uint256) public weightOf;
    mapping(address => uint256) public lockedOf;
    mapping(address => mapping(uint256 => uint256)) public lockedFor;

    struct Node {
        uint256 prev;
        uint256 next;
        bool inList;
    }

    mapping(uint256 => Node) public nodes;
    uint256 public head;
    uint256 public tail;

    uint256 public currentTokenPrice;
    bool public finalized;

    error VotingEnded();
    error VotingActive();
    error AlreadyFinalized();
    error ZeroAmount();
    error InsufficientLocked();
    error InvalidPrice();
    error BadHint();
    error TransferFailed();

    event Voted(address indexed voter, uint256 indexed price, uint256 amount);
    event Withdrawn(address indexed voter, uint256 indexed price, uint256 amount);
    event PriceFinalized(uint256 indexed price, uint256 weight);

    constructor(IERC20 _token, uint256 _votingEnd) {
        token = _token;
        votingEnd = _votingEnd;
    }

    // ----- write -----

    function vote(uint256 price, uint256 amount, uint256 prevHint, uint256 nextHint) external {
        if (block.timestamp >= votingEnd) revert VotingEnded();
        if (amount == 0) revert ZeroAmount();
        if (price == 0) revert InvalidPrice();

        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        lockedOf[msg.sender] += amount;
        lockedFor[msg.sender][price] += amount;
        weightOf[price] += amount;

        _reposition(price, weightOf[price], prevHint, nextHint);

        emit Voted(msg.sender, price, amount);
    }

    function withdraw(uint256 price, uint256 amount, uint256 prevHint, uint256 nextHint) external {
        if (amount == 0) revert ZeroAmount();
        if (price == 0) revert InvalidPrice();
        uint256 locked = lockedFor[msg.sender][price];
        if (locked < amount) revert InsufficientLocked();

        lockedFor[msg.sender][price] = locked - amount;
        lockedOf[msg.sender] -= amount;
        weightOf[price] -= amount;

        _reposition(price, weightOf[price], prevHint, nextHint);

        emit Withdrawn(msg.sender, price, amount);

        bool ok = token.transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();
    }

    function finalize() external {
        if (block.timestamp < votingEnd) revert VotingActive();
        if (finalized) revert AlreadyFinalized();

        finalized = true;
        if (head != 0) {
            currentTokenPrice = head;
        }
        emit PriceFinalized(head, weightOf[head]);
    }

    // ----- read -----

    function leader() external view returns (uint256 price, uint256 weight) {
        return (head, weightOf[head]);
    }

    // ----- internal: linked-list maintenance -----

    function _reposition(uint256 price, uint256 newWeight, uint256 prevHint, uint256 nextHint) internal {
        // self-reference in hints is always wrong
        if (prevHint == price || nextHint == price) revert BadHint();

        // Drop weight-0 prices from the list entirely. If they vote again
        // later, they'll be re-inserted with fresh hints.
        if (nodes[price].inList) {
            _unlink(price);
        }
        if (newWeight == 0) {
            return;
        }

        _verifyHints(newWeight, prevHint, nextHint);

        nodes[price] = Node({prev: prevHint, next: nextHint, inList: true});
        if (prevHint == 0) {
            head = price;
        } else {
            nodes[prevHint].next = price;
        }
        if (nextHint == 0) {
            tail = price;
        } else {
            nodes[nextHint].prev = price;
        }
    }

    function _unlink(uint256 price) internal {
        Node memory n = nodes[price];
        if (n.prev == 0) {
            head = n.next;
        } else {
            nodes[n.prev].next = n.next;
        }
        if (n.next == 0) {
            tail = n.prev;
        } else {
            nodes[n.next].prev = n.prev;
        }
        delete nodes[price];
    }

    function _verifyHints(uint256 weight, uint256 prevHint, uint256 nextHint) internal view {
        // Weight bounds. Sentinel 0 means "no neighbor on this side."
        if (prevHint != 0) {
            if (!nodes[prevHint].inList) revert BadHint();
            if (weightOf[prevHint] < weight) revert BadHint();
        }
        if (nextHint != 0) {
            if (!nodes[nextHint].inList) revert BadHint();
            // strict: ties stay above the newcomer
            if (weightOf[nextHint] >= weight) revert BadHint();
        }

        // Structural adjacency: prevHint and nextHint must actually be
        // adjacent in the current list. Without this check an attacker
        // could supply any weight-valid pair and splice the real leader
        // out of the chain.
        uint256 expectedNext = (prevHint == 0) ? head : nodes[prevHint].next;
        if (expectedNext != nextHint) revert BadHint();

        uint256 expectedPrev = (nextHint == 0) ? tail : nodes[nextHint].prev;
        if (expectedPrev != prevHint) revert BadHint();
    }
}

# Task: Chainlink raffle

Build a raffle where players deposit a token, the deposit's USD value at entry time determines win probability, and a Chainlink VRF draw picks the winner after a deadline.

## Background

This task combines the two Chainlink primitives from the recent lectures. A price feed values each deposit in USD at the moment it's made, so deposits in a volatile token are weighted fairly regardless of price movement during the raffle. VRF picks the winner once the entry window closes, so the result is verifiably random and cannot be influenced by validators.

Randomness arrives asynchronously. `drawWinner` only requests a random number and returns. The VRF coordinator calls your `fulfillRandomWords` callback some blocks later with the result. Anything that depends on the random value happens at or after that callback, not in the original user transaction.

## Architecture

`contracts/Raffle.sol` is the on-chain contract. Players deposit, anyone triggers the draw after the deadline, and the winner claims the prize pool.

`contracts/mocks/Mocks.sol` exposes `VRFCoordinatorMock` and `PriceFeedMock` so tests can drive Chainlink behavior locally. No subscription, no testnet, no live LINK required.

`contracts/Token.sol` is the generic ERC-20 used for the deposit token (here: a WETH-style ERC-20, priced against an ETH/USD feed).

## On-chain behavior

### `deposit(uint256 amount)`

Player deposits `amount` of the deposit token while the raffle is open.

- Revert if `block.timestamp >= drawTime`.
- Revert if the draw has already been requested.
- Revert if `amount == 0`.
- Pull `amount` from `msg.sender` via `transferFrom`.
- Read the latest price from the price feed. Reject non-positive prices and stale data.
- The deposit's weight is `amount * price`, recorded at deposit time and never recalculated.
- Record the entry, increase the prize pool, emit `Deposited(msg.sender, amount, weight)`.

The same address may deposit multiple times. Each deposit is recorded as a separate entry.

### `drawWinner() → uint256`

Anyone calls this after the deadline to trigger the VRF request.

- Revert `TooEarly` if `block.timestamp < drawTime`.
- Revert `NoDepositors` if no one has entered.
- Revert if `drawWinner` was already called.
- Request a single random word from the VRF coordinator using `keyHash`, `subscriptionId`, `callbackGasLimit`, `REQUEST_CONFIRMATIONS`, and `NUM_WORDS`.
- Store the returned `requestId`.
- Emit `DrawRequested(requestId)`.

### `fulfillRandomWords(uint256 _requestId, uint256[] calldata randomWords)` (internal override)

The VRF callback.

- Verify the incoming `_requestId` matches the one stored.
- Store the random word.

Keep this callback minimal. No transfers, no loops over entries, no settlement logic. The callback runs under a gas limit and must succeed to deliver the result.

### `claim(uint256 entryIndex)`

- Revert if VRF has not yet responded.
- Revert if the prize has already been claimed.
- Revert with `InvalidClaim` if `entryIndex` does not identify a winning entry for `msg.sender`.
- Transfer the full prize pool to `msg.sender`.
- Set `winner = msg.sender`.
- Emit `Claimed(msg.sender, totalDeposited)`.

The contract receives `entryIndex` from the caller and verifies the claim. 

## Constraints

The contract must not import a third-party "raffle picker" or "weighted random" library. The data structure and verification logic are yours to design.

## Tests

A starter test in `tests/Raffle.test.ts` runs the happy path end-to-end: two deposits, time travel to the deadline, forced VRF response at a known position, winner claims. It fails until your four functions work. Don't edit it.

Add tests for the failure modes: zero deposits, deposits after the deadline, draws called before the deadline, draws with no entries, repeated draws, claims by non-winners, double claims, and the boundary positions of the weighted pick.
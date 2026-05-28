// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

// Raffle — deposit a token; each deposit's USD value at entry time (Chainlink feed)
// sets its weight. After drawTime, VRF picks a weighted winner; they claim the pot.
contract Raffle is VRFConsumerBaseV2Plus {
    using SafeERC20 for IERC20;

    enum State {
        OPEN,
        DRAWING
    }

    IERC20 public immutable token;
    AggregatorV3Interface public immutable priceFeed;
    uint256 public immutable drawTime;

    uint256 public immutable subscriptionId;
    bytes32 public immutable keyHash;
    uint32 public immutable callbackGasLimit;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant NUM_WORDS = 1;

    uint256 public constant MAX_PRICE_AGE = 1 hours;

    State public state;

    // One array slot per deposit; prefixWeights[i] is cumulative weight through entry i.
    address[] private entryOwners;
    uint256[] private prefixWeights;

    uint256 public totalWeight;
    uint256 public totalDeposited;
    uint256 public requestId;
    uint256 public randomWord;
    bool public claimed;

    error NotOpen();
    error TooEarly();
    error NoDepositors();
    error ZeroAmount();
    error BadPrice();
    error StalePrice();
    error InvalidRequest();
    error AlreadyFulfilled();
    error NotReady();
    error InvalidClaim();
    error AlreadyClaimed();

    event Deposited(address indexed who, uint256 amount, uint256 weight);
    event DrawRequested(uint256 requestId);
    event RandomWordReceived(uint256 randomWord);
    event Claimed(address indexed winner, uint256 entryIndex, uint256 amount);

    constructor(
        IERC20 _token,
        AggregatorV3Interface _priceFeed,
        uint256 _drawTime,
        address _coordinator,
        uint256 _subscriptionId,
        bytes32 _keyHash,
        uint32 _callbackGasLimit
    ) VRFConsumerBaseV2Plus(_coordinator) {
        token = _token;
        priceFeed = _priceFeed;
        drawTime = _drawTime;
        subscriptionId = _subscriptionId;
        keyHash = _keyHash;
        callbackGasLimit = _callbackGasLimit;
    }

    function deposit(uint256 amount) external {
        if (state != State.OPEN || block.timestamp >= drawTime) revert NotOpen();
        if (amount == 0) revert ZeroAmount();

        token.safeTransferFrom(msg.sender, address(this), amount);

        uint256 weight = amount * _price();

        totalDeposited += amount;
        totalWeight += weight;
        entryOwners.push(msg.sender);
        prefixWeights.push(totalWeight);

        emit Deposited(msg.sender, amount, weight);
    }

    function drawWinner() external returns (uint256) {
        if (state != State.OPEN) revert NotOpen();
        if (block.timestamp < drawTime) revert TooEarly();
        if (entryOwners.length == 0) revert NoDepositors();

        state = State.DRAWING;
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: callbackGasLimit,
                numWords: NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: false}))
            })
        );
        emit DrawRequested(requestId);
        return requestId;
    }

    function fulfillRandomWords(uint256 _requestId, uint256[] calldata randomWords) internal override {
        if (_requestId != requestId) revert InvalidRequest();
        if (randomWord != 0) revert AlreadyFulfilled();
        randomWord = randomWords[0];
        emit RandomWordReceived(randomWord);
    }

    /// @notice Winning depositor once the VRF word is recorded (O(log n) view).
    function winner() external view returns (address) {
        if (randomWord == 0) return address(0);
        return entryOwners[_winningEntryIndex(randomWord)];
    }

    /// @notice Claim using the winning entry index (caller must know their index).
    function claim(uint256 entryIndex) external {
        _claim(entryIndex);
    }

    /// @notice Claim when the caller owns the single winning entry (starter-test helper).
    function claim() external {
        _claim(_winningEntryIndex(randomWord));
    }

    function _claim(uint256 entryIndex) internal {
        if (randomWord == 0) revert NotReady();
        if (claimed) revert AlreadyClaimed();

        uint256 pick = randomWord % totalWeight;
        if (entryOwners[entryIndex] != msg.sender || !_entryWins(entryIndex, pick)) {
            revert InvalidClaim();
        }

        claimed = true;
        token.safeTransfer(msg.sender, totalDeposited);
        emit Claimed(msg.sender, entryIndex, totalDeposited);
    }

    function entryCount() external view returns (uint256) {
        return entryOwners.length;
    }

    function entryOwner(uint256 index) external view returns (address) {
        return entryOwners[index];
    }

    function prefixWeight(uint256 index) external view returns (uint256) {
        return prefixWeights[index];
    }

    function _entryWins(uint256 entryIndex, uint256 pick) internal view returns (bool) {
        if (entryIndex >= prefixWeights.length) return false;
        if (prefixWeights[entryIndex] <= pick) return false;
        if (entryIndex != 0 && prefixWeights[entryIndex - 1] > pick) return false;
        return true;
    }

    function _winningEntryIndex(uint256 word) internal view returns (uint256) {
        uint256 pick = word % totalWeight;
        uint256 lo = 0;
        uint256 hi = prefixWeights.length - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (prefixWeights[mid] > pick) {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        return lo;
    }

    function _price() internal view returns (uint256) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = priceFeed.latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (updatedAt == 0 || block.timestamp - updatedAt > MAX_PRICE_AGE) revert StalePrice();
        if (answeredInRound < roundId) revert StalePrice();
        return uint256(answer);
    }
}

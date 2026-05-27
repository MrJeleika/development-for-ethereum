// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

// Raffle — deposit a volatile token (BTC); your odds are your USD value at entry,
// priced by a Chainlink feed. After drawTime a Chainlink VRF draw picks a weighted
// winner, who claims the whole pot.
contract Raffle is VRFConsumerBaseV2Plus {
    enum State {
        OPEN,
        DRAWING,
        DONE
    }

    IERC20 public immutable token; // deposit token (BTC)
    AggregatorV3Interface public immutable priceFeed; // BTC/USD
    uint256 public immutable drawTime;

    uint256 public immutable subscriptionId;
    bytes32 public immutable keyHash;
    uint32 public immutable callbackGasLimit;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant NUM_WORDS = 1;

    State public state;
    address[] public depositors;
    mapping(address => uint256) public weightOf; // USD value snapshot at deposit
    uint256 public totalWeight;
    uint256 public totalDeposited; // BTC pot
    uint256 public requestId;
    address public winner;
    bool public claimed;

    error NotOpen();
    error TooEarly();
    error NoDepositors();
    error ZeroAmount();
    error NotDone();
    error NotWinner();
    error AlreadyClaimed();

    event Deposited(address indexed who, uint256 amount, uint256 weight);
    event DrawRequested(uint256 requestId);
    event WinnerPicked(address indexed winner);
    event Claimed(address indexed winner, uint256 amount);

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

        token.transferFrom(msg.sender, address(this), amount);

        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "bad price");
        uint256 weight = amount * uint256(price);

        if (weightOf[msg.sender] == 0) depositors.push(msg.sender);
        weightOf[msg.sender] += weight;
        totalWeight += weight;
        totalDeposited += amount;

        emit Deposited(msg.sender, amount, weight);
    }

    function drawWinner() external returns (uint256) {
        if (state != State.OPEN) revert NotOpen();
        if (block.timestamp < drawTime) revert TooEarly();
        if (depositors.length == 0) revert NoDepositors();

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

    function fulfillRandomWords(uint256, uint256[] calldata randomWords) internal override {
        uint256 pick = randomWords[0] % totalWeight;
        uint256 cumulative;
        for (uint256 i = 0; i < depositors.length; i++) {
            cumulative += weightOf[depositors[i]];
            if (pick < cumulative) {
                winner = depositors[i];
                break;
            }
        }
        state = State.DONE;
        emit WinnerPicked(winner);
    }

    function claim() external {
        if (state != State.DONE) revert NotDone();
        if (msg.sender != winner) revert NotWinner();
        if (claimed) revert AlreadyClaimed();

        claimed = true;
        token.transfer(winner, totalDeposited);
        emit Claimed(winner, totalDeposited);
    }

    function depositorsCount() external view returns (uint256) {
        return depositors.length;
    }
}

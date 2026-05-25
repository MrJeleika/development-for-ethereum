// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Merkle airdrop with two ways to claim: a Merkle proof (your address is on the
// list), or a signature from the admin over your address + amount.
//
// Reflection: the signed message has to include the claimer's address, or else
// the same signature could be replayed by anyone for that amount. It doesn't
// include the contract address / chainId, so a signature would also work on a
// second deployment with the same signer - an EIP-712 domain would fix that.
contract MerkleAirdrop {
    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    address public immutable signer;

    mapping(address => bool) public hasClaimed;

    error AlreadyClaimed();
    error InvalidProof();
    error InvalidSignature();

    event Claimed(address indexed account, uint256 amount);

    constructor(IERC20 _token, bytes32 _merkleRoot, address _signer) {
        token = _token;
        merkleRoot = _merkleRoot;
        signer = _signer;
    }

    function claim(uint256 amount, bytes32[] calldata proof) external {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        if (!_verify(proof, leaf)) revert InvalidProof();

        hasClaimed[msg.sender] = true;
        token.transfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function claimWithSignature(uint256 amount, uint8 v, bytes32 r, bytes32 s) external {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        bytes32 message = keccak256(abi.encodePacked(msg.sender, amount));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
        if (ecrecover(ethHash, v, r, s) != signer) revert InvalidSignature();

        hasClaimed[msg.sender] = true;
        token.transfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // walk the proof, hashing the smaller value first at each step
    function _verify(bytes32[] calldata proof, bytes32 leaf) internal view returns (bool) {
        bytes32 hash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            if (hash < proof[i]) {
                hash = keccak256(abi.encodePacked(hash, proof[i]));
            } else {
                hash = keccak256(abi.encodePacked(proof[i], hash));
            }
        }
        return hash == merkleRoot;
    }
}

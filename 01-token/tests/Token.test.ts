import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, zeroAddress } from "viem";

describe("Token", async () => {
  const { viem } = await network.connect();
  const [deployer, alice, bob] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const NAME = "Academy Token";
  const SYMBOL = "ACAD";
  const INITIAL_SUPPLY = parseEther("1000000");

  async function deploy() {
    return viem.deployContract("Token", [NAME, SYMBOL, INITIAL_SUPPLY]);
  }

  describe("metadata", () => {
    it("exposes name, symbol, and 18 decimals", async () => {
      const token = await deploy();
      assert.equal(await token.read.name(), NAME);
      assert.equal(await token.read.symbol(), SYMBOL);
      assert.equal(await token.read.decimals(), 18);
    });
  });

  describe("constructor", () => {
    it("credits the initial supply to the deployer", async () => {
      const token = await deploy();
      assert.equal(await token.read.totalSupply(), INITIAL_SUPPLY);
      assert.equal(await token.read.balanceOf([deployer.account.address]), INITIAL_SUPPLY);
    });

    it("emits a Transfer event from the zero address for the initial supply", async () => {
      const fromBlock = await publicClient.getBlockNumber();
      const token = await deploy();
      const events = await publicClient.getContractEvents({
        address: token.address,
        abi: token.abi,
        eventName: "Transfer",
        fromBlock,
        strict: true,
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].args.from.toLowerCase(), zeroAddress);
      assert.equal(events[0].args.to.toLowerCase(), deployer.account.address.toLowerCase());
      assert.equal(events[0].args.value, INITIAL_SUPPLY);
    });
  });

  describe("transfer", () => {
    it("moves tokens between accounts", async () => {
      const token = await deploy();
      const amount = parseEther("100");

      await token.write.transfer([alice.account.address, amount]);

      assert.equal(
        await token.read.balanceOf([deployer.account.address]),
        INITIAL_SUPPLY - amount,
      );
      assert.equal(await token.read.balanceOf([alice.account.address]), amount);
    });

    it("emits a Transfer event", async () => {
      const token = await deploy();
      const fromBlock = (await publicClient.getBlockNumber()) + 1n;
      const amount = parseEther("100");

      await token.write.transfer([alice.account.address, amount]);

      const events = await publicClient.getContractEvents({
        address: token.address,
        abi: token.abi,
        eventName: "Transfer",
        fromBlock,
        strict: true,
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].args.from.toLowerCase(), deployer.account.address.toLowerCase());
      assert.equal(events[0].args.to.toLowerCase(), alice.account.address.toLowerCase());
      assert.equal(events[0].args.value, amount);
    });

    it("leaves the total supply unchanged", async () => {
      const token = await deploy();
      await token.write.transfer([alice.account.address, parseEther("250")]);
      assert.equal(await token.read.totalSupply(), INITIAL_SUPPLY);
    });

    it("reverts when the sender has insufficient balance", async () => {
      const token = await deploy();
      await assert.rejects(
        token.write.transfer([deployer.account.address, 1n], { account: alice.account }),
        /InsufficientBalance/,
      );
    });

    it("reverts when transferring to the zero address", async () => {
      const token = await deploy();
      await assert.rejects(
        token.write.transfer([zeroAddress, 1n]),
        /TransferToZeroAddress/,
      );
    });
  });

  describe("approve & allowance", () => {
    it("sets the allowance and emits Approval", async () => {
      const token = await deploy();
      const fromBlock = await publicClient.getBlockNumber();
      const amount = parseEther("50");

      await token.write.approve([alice.account.address, amount]);

      assert.equal(
        await token.read.allowance([deployer.account.address, alice.account.address]),
        amount,
      );

      const events = await publicClient.getContractEvents({
        address: token.address,
        abi: token.abi,
        eventName: "Approval",
        fromBlock,
        strict: true,
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].args.owner.toLowerCase(), deployer.account.address.toLowerCase());
      assert.equal(events[0].args.spender.toLowerCase(), alice.account.address.toLowerCase());
      assert.equal(events[0].args.value, amount);
    });

    it("overwrites the previous allowance", async () => {
      const token = await deploy();
      await token.write.approve([alice.account.address, parseEther("10")]);
      await token.write.approve([alice.account.address, parseEther("3")]);
      assert.equal(
        await token.read.allowance([deployer.account.address, alice.account.address]),
        parseEther("3"),
      );
    });

    it("reverts when approving the zero address", async () => {
      const token = await deploy();
      await assert.rejects(
        token.write.approve([zeroAddress, 1n]),
        /ApproveToZeroAddress/,
      );
    });
  });

  describe("transferFrom", () => {
    it("moves tokens and consumes the allowance", async () => {
      const token = await deploy();
      const amount = parseEther("40");

      await token.write.approve([alice.account.address, amount]);
      await token.write.transferFrom(
        [deployer.account.address, bob.account.address, amount],
        { account: alice.account },
      );

      assert.equal(await token.read.balanceOf([bob.account.address]), amount);
      assert.equal(
        await token.read.allowance([deployer.account.address, alice.account.address]),
        0n,
      );
    });

    it("reverts when the spender's allowance is insufficient", async () => {
      const token = await deploy();
      await token.write.approve([alice.account.address, parseEther("5")]);
      await assert.rejects(
        token.write.transferFrom(
          [deployer.account.address, bob.account.address, parseEther("10")],
          { account: alice.account },
        ),
        /InsufficientAllowance/,
      );
    });

    it("reverts when the owner's balance is insufficient", async () => {
      const token = await deploy();
      // Alice has only 1 wei of the token but has approved Bob to pull 5e18.
      await token.write.transfer([alice.account.address, 1n]);
      await token.write.approve([bob.account.address, parseEther("5")], {
        account: alice.account,
      });
      await assert.rejects(
        token.write.transferFrom(
          [alice.account.address, deployer.account.address, parseEther("5")],
          { account: bob.account },
        ),
        /InsufficientBalance/,
      );
    });
  });
});

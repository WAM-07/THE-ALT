// Unit Test 04 of the report (Chapter 5): the marketplace's payment split, case by case, with the report's
// numbers (creator royalty 5%, platform fee 2.5%). Run: npx hardhat test nodejs --grep "Unit Test 04"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, parseEther, toHex } from "viem";

const { viem, networkHelpers } = await network.create();

async function deploy() {
  const [admin, relayer, alice, bob, carol, treasury] = await viem.getWalletClients();
  const registry = await viem.deployContract("AITRegistry", [admin.account.address]);
  await registry.write.grantRole([await registry.read.MINTER_ROLE(), relayer.account.address]);
  const market = await viem.deployContract("ALTMarketplace", [registry.address, treasury.account.address, 250n, admin.account.address]);
  // Alice creates AI #1 with a 5% royalty.
  await registry.write.mint([alice.account.address, keccak256(toHex("ai-alice")), "bafy-alice", 500n], { account: relayer.account });
  for (const w of [alice, bob, carol]) await registry.write.setApprovalForAll([market.address, true], { account: w.account });
  return { market, alice, bob, carol, treasury };
}

const fixture = () => networkHelpers.loadFixture(deploy);
const as = (w: { account: { address: `0x${string}` } }) => ({ account: w.account as never });
const pol = (s: string) => parseEther(s);

describe("Unit Test 04 – ALTMarketplace payment split", () => {
  it("Unit Test 04.1 – creator's first sale: Alice sells AI #1 to Bob for 1 POL → fee 0.025, no royalty, 0.975 to Alice", async () => {
    const { market, alice, bob, treasury } = await fixture();
    await market.write.listForSale([1n, pol("1")], as(alice));
    await market.write.buy([1n], { ...as(bob), value: pol("1") });
    assert.equal(await market.read.balances([treasury.account.address]), pol("0.025"));
    assert.equal(await market.read.balances([alice.account.address]), pol("0.975"));
  });

  it("Unit Test 04.2 – resale: Bob resells to Carol for 2 POL → royalty 0.1 to Alice, fee 0.05, 1.85 to Bob", async () => {
    const { market, alice, bob, carol, treasury } = await fixture();
    await market.write.listForSale([1n, pol("1")], as(alice));
    await market.write.buy([1n], { ...as(bob), value: pol("1") });
    const [aliceBefore, treasuryBefore] = [await market.read.balances([alice.account.address]), await market.read.balances([treasury.account.address])];
    await market.write.listForSale([1n, pol("2")], as(bob));
    await market.write.buy([1n], { ...as(carol), value: pol("2") });
    assert.equal((await market.read.balances([alice.account.address])) - aliceBefore, pol("0.1"));
    assert.equal((await market.read.balances([treasury.account.address])) - treasuryBefore, pol("0.05"));
    assert.equal(await market.read.balances([bob.account.address]), pol("1.85"));
  });

  it("Unit Test 04.3 – rental split: Carol rents from Bob, 5 days at 0.1 POL/day → royalty 0.025 to Alice, fee 0.0125, 0.4625 to Bob", async () => {
    const { market, alice, bob, carol, treasury } = await fixture();
    await market.write.listForSale([1n, pol("1")], as(alice));
    await market.write.buy([1n], { ...as(bob), value: pol("1") });
    const [aliceBefore, treasuryBefore] = [await market.read.balances([alice.account.address]), await market.read.balances([treasury.account.address])];
    await market.write.listForRent([1n, pol("0.1"), 30], as(bob));
    await market.write.rent([1n, 5], { ...as(carol), value: pol("0.5") });
    assert.equal((await market.read.balances([alice.account.address])) - aliceBefore, pol("0.025"));
    assert.equal((await market.read.balances([treasury.account.address])) - treasuryBefore, pol("0.0125"));
    assert.equal(await market.read.balances([bob.account.address]), pol("0.4625"));
  });

  it("Unit Test 04.4 – underpayment: 0.5 POL for a 1 POL listing → reverts WrongPayment", async () => {
    const { market, alice, bob } = await fixture();
    await market.write.listForSale([1n, pol("1")], as(alice));
    await viem.assertions.revertWithCustomError(market.write.buy([1n], { ...as(bob), value: pol("0.5") }), market, "WrongPayment");
  });

  it("Unit Test 04.5 – overpayment: 1.5 POL for a 1 POL listing → reverts WrongPayment", async () => {
    const { market, alice, bob } = await fixture();
    await market.write.listForSale([1n, pol("1")], as(alice));
    await viem.assertions.revertWithCustomError(market.write.buy([1n], { ...as(bob), value: pol("1.5") }), market, "WrongPayment");
  });
});

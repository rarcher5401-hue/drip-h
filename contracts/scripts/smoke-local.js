const { ethers } = require("hardhat");

// End-to-end smoke test against a live `hardhat node` (npx hardhat node).
// Flow: deploy -> seed pool -> alice stakes -> warp 30 days -> compound ->
// bob stakes -> warp 30 days -> claim -> withdraw, checking pool health views.

const DAILY_RATE_WAD = ethers.parseUnits("0.005", 18).toString();
const DEPOSIT_TAX_BPS = 1000;
const WITHDRAW_TAX_BPS = 1000;
const EARLY_WITHDRAW_TAX_BPS = 3000;
const WHALE_WITHDRAW_TAX_BPS = 3000;
const WHALE_THRESHOLD = ethers.parseEther("2000000");
const EARLY_PERIOD = 90 * 86400;
const e = (n) => ethers.parseEther(n);
const fmt = (n) => ethers.formatEther(BigInt(n));

function assertClose(actual, expected, label, tol = "0.0001") {
  const a = BigInt(actual);
  const b = BigInt(expected);
  const delta = BigInt(ethers.parseEther(tol));
  const diff = a > b ? a - b : b - a;
  if (diff > delta) {
    throw new Error(`FAIL ${label}: got ${fmt(a)} DRIPH, expected ~${fmt(b)} DRIPH (off by ${fmt(diff)})`);
  }
  console.log(`  ok  ${label} = ${fmt(a)} DRIPH`);
}

async function warp(provider, days) {
  await provider.send("evm_increaseTime", [days * 86400]);
  await provider.send("evm_mine", []);
}

async function main() {
  const [deployer, dev, treasury, alice, bob] = await ethers.getSigners();
  const provider = ethers.provider;
  console.log(`Node up on chainId ${(await provider.getNetwork()).chainId}`);

  console.log("\n-- deploy --");
  const token = await (await ethers.getContractFactory("DripHToken")).deploy(treasury.address);
  await token.waitForDeployment();
  const faucet = await (
    await ethers.getContractFactory("DripHFaucet")
  ).deploy(
    token.target,
    DAILY_RATE_WAD,
    DEPOSIT_TAX_BPS,
    WITHDRAW_TAX_BPS,
    EARLY_WITHDRAW_TAX_BPS,
    WHALE_WITHDRAW_TAX_BPS,
    WHALE_THRESHOLD,
    EARLY_PERIOD
  );
  await faucet.waitForDeployment();
  await (await token.setExcluded(faucet.target, true)).wait();
  await (await token.lockExclusion(faucet.target)).wait();
  console.log(`  token  -> ${token.target}`);
  console.log(`  faucet -> ${faucet.target}`);

  console.log("\n-- fund test users with DRIPH --");
  await (await token.transfer(alice.address, e("5000"))).wait();
  await (await token.transfer(bob.address, e("5000"))).wait();
  console.log("  ok  alice + bob funded");

  console.log("\n-- seed pool (so claims have liquidity) --");
  await (await token.transfer(faucet.target, e("100000"))).wait();
  await (await faucet.syncDonations()).wait();
  console.log("  ok  faucet backing = " + fmt(await token.balanceOf(faucet.target)) + " DRIPH");

  console.log("\n-- alice stakes 1,000 (10% deposit tax stays in the pool) --");
  const approveAlice = await token.connect(alice).approve(faucet.target, e("10000"));
  await (await faucet.connect(alice).deposit(e("1000"))).wait();
  assertClose(await (await faucet.users(alice)).principal, e("900"), "alice net principal");
  assertClose(await token.balanceOf(faucet.target), e("101000"), "faucet backing (full deposit, tax included)");
  assertClose(await token.balanceOf(dev), e("0"), "dev receives no deposit tax");
  assertClose(await token.balanceOf(treasury), e("0"), "treasury receives no deposit tax");

  console.log("\n-- fast-forward 30 days (per-second accrual) --");
  await warp(provider, 30);
  const pending1 = await faucet.pendingRewards(alice.address);
  assertClose(pending1, e("135"), "alice pending after 30d (~0.5%/day)");

  console.log("\n-- alice compounds (re-invest, no payout cap) --");
  await (await faucet.connect(alice).compound()).wait();
  const u2 = await faucet.users(alice.address);
  assertClose(u2.principal, e("1035"), "alice principal after compound");
  const [o1, p1] = await faucet.poolObligation();
  assertClose(o1, e("0"), "outstanding after compound (reward debt consumed)", "0.000001");
  assertClose(p1, e("0"), "pending after compound ~ 0");
  console.log(`  ok  distributed lifetime = ${fmt(await faucet.distributed())} DRIPH`);

  console.log("\n-- bob stakes 2,000, then 30 more days --");
  await token.connect(bob).approve(faucet.target, e("10000"));
  await (await faucet.connect(bob).deposit(e("2000"))).wait();
  await warp(provider, 30);
  const pendingAlice = await faucet.pendingRewards(alice.address);
  const pendingBob = await faucet.pendingRewards(bob.address);
  assertClose(pendingAlice, u2.principal * 30n * 5n / 1000n, "alice pending (principal * 0.5% * 30)", "0.0015");
  assertClose(pendingBob, e("270"), "bob pending (1800 * 0.5% * 30)", "0.0015");

  console.log("\n-- pool health snapshot --");
  const [o2, p2] = await faucet.poolObligation();
  const backing = await faucet.accountedBalance();
  const principalLiability = await faucet.totalPrincipal();
  const coverage = (BigInt(backing) * 100000n) / (principalLiability + o2 + p2);
  console.log(`  ok  outstanding     = ${fmt(o2)} DRIPH`);
  console.log(`  ok  pending         = ${fmt(p2)} DRIPH`);
  console.log(`  ok  principal       = ${fmt(principalLiability)} DRIPH`);
  console.log(`  ok  backing         = ${fmt(backing)} DRIPH`);
  console.log(`  ok  coverage        = ${(Number(coverage) / 1000).toFixed(1)}%`);

  console.log("\n-- alice claims (paid from pool liquidity) --");
  const balanceBefore = await token.balanceOf(alice.address);
  await (await faucet.connect(alice).claim()).wait();
  const received = (await token.balanceOf(alice.address)) - balanceBefore;
  assertClose(received, pendingAlice, "alice received on claim", "0.001");
  assertClose(await faucet.totalClaimed(), pendingAlice, "totalClaimed", "0.001");
  const [o3] = await faucet.poolObligation();
  assertClose(o3, pendingBob, "outstanding after claim (bob remains owed)", "0.002");

  console.log("\n-- alice withdraws 100 principal (day 60: 30% early-exit fee) --");
  const balBeforeW = await token.balanceOf(alice.address);
  const backingBeforeW = await token.balanceOf(faucet.target);
  await (await faucet.connect(alice).withdraw(e("100"))).wait();
  const netW = (await token.balanceOf(alice.address)) - balBeforeW;
  assertClose(netW, e("70"), "net withdrawal (100 - 30% early fee)");
  assertClose(await token.balanceOf(faucet.target), BigInt(backingBeforeW) - BigInt(netW), "withdraw tax stays as backing");

  console.log("\n-- past day 90: base 10% rate applies --");
  await warp(provider, 31);
  const balBeforeW2 = await token.balanceOf(alice.address);
  await (await faucet.connect(alice).withdraw(e("100"))).wait();
  const netW2 = (await token.balanceOf(alice.address)) - balBeforeW2;
  assertClose(netW2, e("90"), "net withdrawal (100 - 10% base fee)");

  console.log("\n-- protocol summary --");
  console.log("  totalStakers     = " + (await faucet.totalStakers()).toString());
  console.log("  totalDeposits    = " + fmt(await faucet.totalDeposits()) + " DRIPH");
  console.log("  distributed      = " + fmt(await faucet.distributed()) + " DRIPH");
  console.log("  totalClaimed     = " + fmt(await faucet.totalClaimed()) + " DRIPH");
  console.log("\nSMOKE TEST PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

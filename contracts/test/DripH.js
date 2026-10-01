const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 86400;
const WAD = 10n ** 18n;
const RATE_PER_DAY = WAD / 200n; // 0.5% per day
const e = ethers.parseEther;

async function warp(days) {
  await ethers.provider.send("evm_increaseTime", [days * DAY]);
  await ethers.provider.send("evm_mine", []);
}

function expectClose(actual, expected, tolerance = "0.01") {
  const delta = e(tolerance);
  expect(actual).to.be.greaterThanOrEqual(expected - delta);
  expect(actual).to.be.lessThanOrEqual(expected + delta);
}

describe("DripHToken", function () {
  let token, owner, treasury, bob, carol;

  beforeEach(async function () {
    [owner, treasury, bob, carol] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("DripHToken")).deploy(treasury.address);
    await token.waitForDeployment();
  });

  it("mints a fixed supply to the deployer", async function () {
    expect(await token.totalSupply()).to.equal(e("1000000"));
    expect(await token.balanceOf(owner.address)).to.equal(e("1000000"));
  });

  it("applies the transfer fee only when neither endpoint is excluded", async function () {
    await token.transfer(bob.address, e("1000"));
    await token.connect(bob).transfer(carol.address, e("100"));
    expect(await token.balanceOf(carol.address)).to.equal(e("97.5"));
    expect(await token.balanceOf(treasury.address)).to.equal(e("2.5"));

    await token.setExcluded(carol.address, true);
    await token.connect(bob).transfer(carol.address, e("100"));
    expect(await token.balanceOf(carol.address)).to.equal(e("197.5"));
  });

  it("caps administration and transfers ownership in two steps", async function () {
    await expect(token.setTransferFeeBps(501)).to.be.revertedWith("DripHToken: too high");
    await token.setTransferFeeBps(500);
    expect(await token.transferFeeBps()).to.equal(500n);

    await token.transferOwnership(bob.address);
    await expect(token.connect(carol).acceptOwnership()).to.be.revertedWith("DripHToken: not pending owner");
    await token.connect(bob).acceptOwnership();
    expect(await token.owner()).to.equal(bob.address);
    await expect(token.setTransferFeeBps(100)).to.be.revertedWith("DripHToken: not owner");
  });

  it("rejects zero treasury and preserves manual exclusions across treasury rotation", async function () {
    await expect((await ethers.getContractFactory("DripHToken")).deploy(ethers.ZeroAddress))
      .to.be.revertedWith("DripHToken: zero address");

    await token.setExcluded(carol.address, true);
    await token.setTreasury(carol.address);
    await token.setTreasury(bob.address);
    expect(await token.isExcluded(carol.address)).to.equal(true);
    expect(await token.isExcluded(bob.address)).to.equal(true);
  });

  it("can permanently lock a protocol fee exclusion", async function () {
    await token.setExcluded(carol.address, true);
    await token.lockExclusion(carol.address);
    await expect(token.setExcluded(carol.address, false)).to.be.revertedWith("DripHToken: exclusion locked");
    await token.setExcluded(bob.address, true);
    await expect(token.lockExclusion(bob.address)).to.be.revertedWith("DripHToken: lock already used");
    expect(await token.isExcluded(carol.address)).to.equal(true);
  });
});

describe("DripHFaucet security accounting", function () {
  let token, faucet, owner, treasury, alice, bob;

  beforeEach(async function () {
    [owner, treasury, alice, bob] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("DripHToken")).deploy(treasury.address);
    await token.waitForDeployment();
    faucet = await (
      await ethers.getContractFactory("DripHFaucet")
    ).deploy(await token.getAddress(), RATE_PER_DAY, 1000, 1000);
    await faucet.waitForDeployment();
    await token.setExcluded(await faucet.getAddress(), true);

    await token.transfer(alice.address, e("10000"));
    await token.transfer(bob.address, e("10000"));
    await token.connect(alice).approve(await faucet.getAddress(), ethers.MaxUint256);
    await token.connect(bob).approve(await faucet.getAddress(), ethers.MaxUint256);
  });

  async function deposit(signer, amount) {
    await faucet.connect(signer).deposit(e(String(amount)));
  }

  async function expectSolvent() {
    const [outstanding, pending] = await faucet.poolObligation();
    const assets = await faucet.accountedBalance();
    const principal = await faucet.totalPrincipal();
    expect(assets).to.be.greaterThanOrEqual(principal + outstanding + pending);
    expect(await token.balanceOf(await faucet.getAddress())).to.equal(assets);
  }

  it("keeps the deposit tax as uncommitted reward backing", async function () {
    await deposit(alice, 100);
    const user = await faucet.users(alice.address);
    expect(user.principal).to.equal(e("90"));
    expect(await faucet.totalPrincipal()).to.equal(e("90"));
    expect(await faucet.accountedBalance()).to.equal(e("100"));
    expect(await faucet.rewardHeadroom()).to.equal(e("10"));
    await expectSolvent();
  });

  it("caps rewards at free reserve and allows the principal withdrawal afterward", async function () {
    await deposit(alice, 100);
    await warp(30);

    const pending = await faucet.pendingRewards(alice.address);
    expect(pending).to.be.greaterThan(e("9.9"));
    expect(pending).to.be.lessThanOrEqual(e("10"));
    await faucet.connect(alice).claim();

    await expect(faucet.connect(alice).withdraw(e("90"))).not.to.be.reverted;
    expect((await faucet.users(alice.address)).principal).to.equal(0n);
    await expectSolvent();
  });

  it("preserves rewards realized during a full withdrawal", async function () {
    await deposit(alice, 100);
    await warp(10);
    await faucet.connect(alice).withdraw(e("90"));

    const pending = await faucet.pendingRewards(alice.address);
    expectClose(pending, e("4.5"), "0.02");
    const before = await token.balanceOf(alice.address);
    await faucet.connect(alice).claim();
    expect((await token.balanceOf(alice.address)) - before).to.be.greaterThan(e("4.48"));
    await expectSolvent();
  });

  it("preserves accrued rewards across another deposit", async function () {
    await deposit(alice, 100);
    await warp(10);
    await deposit(alice, 100);

    expectClose(await faucet.pendingRewards(alice.address), e("4.5"), "0.02");
    expect((await faucet.users(alice.address)).principal).to.equal(e("180"));
    await expectSolvent();
  });

  it("moves compounded rewards from reward debt to principal exactly once", async function () {
    await deposit(alice, 100);
    await warp(10);
    const pending = await faucet.pendingRewards(alice.address);
    await faucet.connect(alice).compound();

    const user = await faucet.users(alice.address);
    expectClose(user.compounded, pending, "0.02");
    expectClose(user.principal, e("90") + pending, "0.02");
    expect(await faucet.totalOutstanding()).to.be.lessThan(e("0.000001"));
    await expectSolvent();
  });

  it("checkpoints before recognizing direct donations", async function () {
    await deposit(alice, 100);
    await warp(20);
    await token.transfer(await faucet.getAddress(), e("100"));
    await faucet.syncDonations();

    expectClose(await faucet.pendingRewards(alice.address), e("9"), "0.03");
    expect(await faucet.accountedBalance()).to.equal(e("200"));
    expect(await faucet.dailyRate()).to.be.greaterThan(e("0.0049"));
    await expectSolvent();
  });

  it("accepts explicit reward funding without creating principal", async function () {
    await token.approve(await faucet.getAddress(), e("1000"));
    await faucet.fundRewards(e("1000"));
    expect(await faucet.accountedBalance()).to.equal(e("1000"));
    expect(await faucet.totalPrincipal()).to.equal(0n);
    expect(await faucet.rewardHeadroom()).to.equal(e("1000"));
  });

  it("rejects fee-on-transfer deposits if the faucet exemption is removed", async function () {
    await token.setExcluded(await faucet.getAddress(), false);
    await expect(deposit(alice, 100)).to.be.revertedWith("Drip H: fee-on-transfer unsupported");
    expect(await faucet.totalPrincipal()).to.equal(0n);
  });

  it("lets the rate reach zero instead of creating unfunded rewards", async function () {
    await deposit(alice, 100);
    await warp(1000);
    expect(await faucet.pendingRewards(alice.address)).to.be.lessThanOrEqual(e("10"));
    expect(await faucet.dailyRate()).to.equal(0n);

    await token.approve(await faucet.getAddress(), e("100"));
    await faucet.fundRewards(e("100"));
    expect(await faucet.dailyRate()).to.be.greaterThan(0n);
    await expectSolvent();
  });

  it("supports many historical stakers without making withdrawals iterate over them", async function () {
    await deposit(alice, 100);
    const faucetAddress = await faucet.getAddress();

    for (let i = 0; i < 20; i += 1) {
      const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
      await ethers.provider.send("hardhat_setBalance", [wallet.address, "0x56BC75E2D63100000"]);
      await token.transfer(wallet.address, 1n);
      await token.connect(wallet).approve(faucetAddress, 1n);
      await faucet.connect(wallet).deposit(1n);
    }

    await warp(1);
    const gas = await faucet.connect(alice).withdraw.estimateGas(e("1"));
    expect(gas).to.be.lessThan(300000n);
    await faucet.connect(alice).withdraw(e("1"));
    expect(await faucet.totalStakers()).to.equal(21n);
    await expectSolvent();
  });

  it("rejects withdrawals above principal", async function () {
    await deposit(alice, 10);
    await expect(faucet.connect(alice).withdraw(e("10"))).to.be.revertedWith("Drip H: amount");
  });
});

describe("DripHFaucet with a standard fee-free token (Pons-style)", function () {
  let token, faucet, owner, alice;

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("DripHToken")).deploy(owner.address);
    await token.waitForDeployment();
    // Simulate a standard ERC20 with no transfer fee and no exclusions.
    await token.setTransferFeeBps(0);

    faucet = await (
      await ethers.getContractFactory("DripHFaucet")
    ).deploy(await token.getAddress(), RATE_PER_DAY, 1000, 1000);
    await faucet.waitForDeployment();

    await token.transfer(alice.address, e("10000"));
    await token.connect(alice).approve(await faucet.getAddress(), ethers.MaxUint256);
  });

  it("rewards are capped by reserve headroom until the pool is seeded", async function () {
    await faucet.connect(alice).deposit(e("1000"));
    await warp(30);
    // No seed funding: only the 100 DRIPH deposit tax backs rewards.
    expect(await faucet.pendingRewards(alice.address)).to.be.lessThanOrEqual(e("100"));
  });

  it("deposits, compounds, claims and withdraws with exact transfers", async function () {
    await token.approve(await faucet.getAddress(), e("1000"));
    await faucet.fundRewards(e("1000"));

    await faucet.connect(alice).deposit(e("1000"));
    expect((await faucet.users(alice.address)).principal).to.equal(e("900"));

    await warp(30);
    const pending = await faucet.pendingRewards(alice.address);
    expect(pending).to.be.greaterThan(e("130"));

    await faucet.connect(alice).compound();
    expect((await faucet.users(alice.address)).principal).to.be.greaterThan(e("900"));

    const before = await token.balanceOf(alice.address);
    await warp(10);
    await faucet.connect(alice).claim();
    expect((await token.balanceOf(alice.address)) - before).to.be.greaterThan(0n);

    await faucet.connect(alice).withdraw(e("100"));
    expect((await faucet.users(alice.address)).principal).to.be.lessThan(e("1000"));
  });

  it("accepts direct transfers via syncDonations without exclusions", async function () {
    await token.transfer(await faucet.getAddress(), e("500"));
    expect(await faucet.syncDonations()).to.not.be.reverted;
    expect(await faucet.accountedBalance()).to.equal(e("500"));
    expect(await faucet.rewardHeadroom()).to.equal(e("500"));
  });
});

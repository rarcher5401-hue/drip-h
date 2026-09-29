const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Up to 0.5% per day, no payout cap (DRIP-style). The faucet's real ceiling is
// liquidity: claims are only paid from DRIPH the faucet actually holds, and the
// reward rate dials back automatically when the reserve thins. Both 10% taxes
// stay in the faucet as backing instead of leaving to wallets.
const DAILY_RATE_WAD = ethers.parseUnits("0.005", 18);
const DEPOSIT_TAX_BPS = 1000;   // 10% - stays in the pool as backing
const WITHDRAW_TAX_BPS = 1000;  // 10% - stays in the pool as backing

// Minimal surface needed to attach to a Pons-launched token.
const PONS_TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];

async function main() {
  const [deployer, localTreasury] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isLocal = chainId === 1337;

  const ponsTokenInput = process.env.PONS_TOKEN_ADDRESS || null;
  const ponsTokenAddress =
    ponsTokenInput && ethers.isAddress(ponsTokenInput) && ponsTokenInput !== ethers.ZeroAddress
      ? ethers.getAddress(ponsTokenInput)
      : null;

  // On Robinhood mainnet the token must come from the Pons launch. Refuse to
  // deploy a second custom token there unless explicitly overridden.
  if (chainId === 4663 && !ponsTokenAddress && process.env.ALLOW_CUSTOM_TOKEN !== "true") {
    throw new Error("set PONS_TOKEN_ADDRESS to your launched Pons token (or ALLOW_CUSTOM_TOKEN=true to override)");
  }
  if (ponsTokenInput && !ponsTokenAddress) {
    throw new Error("PONS_TOKEN_ADDRESS must be a non-zero address");
  }

  console.log(`Deploying Drip H from ${deployer.address} (chainId ${chainId})`);

  let tokenAddr;
  let token = null;

  if (ponsTokenAddress) {
    console.log(`Pons mode: attaching to existing token ${ponsTokenAddress}`);
    const code = await ethers.provider.getCode(ponsTokenAddress);
    if (code === "0x") throw new Error("PONS_TOKEN_ADDRESS has no contract code on this network");
    token = new ethers.Contract(ponsTokenAddress, PONS_TOKEN_ABI, deployer);
    const decimals = await token.decimals();
    if (decimals !== 18n) throw new Error(`Pons token uses ${decimals} decimals; the faucet requires 18`);
    console.log(`Pons token total supply: ${ethers.formatEther(await token.totalSupply())} DRIPH`);
    console.log("NOTE: Pons trade taxes happen in the pool. If the token itself takes transfer");
    console.log("fees, faucet deposits will revert by design (exact-transfer accounting).");
    tokenAddr = ponsTokenAddress;
  } else {
    const requestedAddresses = {
      treasuryAddress: process.env.TREASURY_ADDRESS || (isLocal ? localTreasury.address : null),
      ownerAddress: process.env.OWNER_ADDRESS || (isLocal ? deployer.address : null),
      supplyRecipient: process.env.SUPPLY_RECIPIENT_ADDRESS || (isLocal ? deployer.address : null),
    };

    for (const [name, address] of Object.entries(requestedAddresses)) {
      if (!address || !ethers.isAddress(address) || address === ethers.ZeroAddress) {
        throw new Error(`${name} must be an explicit non-zero address`);
      }
    }
    const treasuryAddress = ethers.getAddress(requestedAddresses.treasuryAddress);
    const ownerAddress = ethers.getAddress(requestedAddresses.ownerAddress);
    const supplyRecipient = ethers.getAddress(requestedAddresses.supplyRecipient);

    token = await (await ethers.getContractFactory("DripHToken")).deploy(treasuryAddress);
    await token.waitForDeployment();
    tokenAddr = await token.getAddress();
    console.log(`transfer fee   -> 2.5% to treasury (${treasuryAddress})`);

    var customTokenCtx = { token, treasuryAddress, ownerAddress, supplyRecipient };
  }

  const faucet = await (
    await ethers.getContractFactory("DripHFaucet")
  ).deploy(tokenAddr, DAILY_RATE_WAD, DEPOSIT_TAX_BPS, WITHDRAW_TAX_BPS);
  await faucet.waitForDeployment();
  const faucetAddr = await faucet.getAddress();

  if (ponsTokenAddress) {
    if ((await faucet.token()) !== tokenAddr) throw new Error("deployment postcondition failed");
  } else {
    const { token: customToken, treasuryAddress, ownerAddress, supplyRecipient } = customTokenCtx;
    // The faucet moves DRIPH internally for stakes, claims and fee splits - exempt it.
    await (await customToken.setExcluded(faucetAddr, true)).wait();
    await (await customToken.lockExclusion(faucetAddr)).wait();

    // Optional: seed tokens into the faucet so claims work out of the box.
    const seedAmount = process.env.SEED_DRIPH ? ethers.parseEther(process.env.SEED_DRIPH) : 0n;
    if (seedAmount > 0n) {
      await (await customToken.transfer(faucetAddr, seedAmount)).wait();
      await (await faucet.syncDonations()).wait();
      console.log(`seeded faucet with ${ethers.formatEther(seedAmount)} DRIPH`);
    }

    const deployerBalance = await customToken.balanceOf(deployer.address);
    if (supplyRecipient !== deployer.address && deployerBalance > 0n) {
      await (await customToken.transfer(supplyRecipient, deployerBalance)).wait();
      console.log(`transferred remaining supply to ${supplyRecipient}`);
    }

    if (ownerAddress !== deployer.address) {
      await (await customToken.transferOwnership(ownerAddress)).wait();
      console.log(`ownership acceptance pending for ${ownerAddress}`);
    }

    if ((await faucet.token()) !== tokenAddr || !(await customToken.isExcluded(faucetAddr)) || !(await customToken.exclusionLocked(faucetAddr))) {
      throw new Error("deployment postcondition failed");
    }
  }

  // Optional seeding also works in Pons mode (requires the deployer to hold DRIPH).
  if (ponsTokenAddress) {
    const seedAmount = process.env.SEED_DRIPH ? ethers.parseEther(process.env.SEED_DRIPH) : 0n;
    if (seedAmount > 0n) {
      const signerToken = new ethers.Contract(tokenAddr, PONS_TOKEN_ABI, deployer);
      await (await signerToken.transfer(faucetAddr, seedAmount)).wait();
      await (await faucet.syncDonations()).wait();
      console.log(`seeded faucet with ${ethers.formatEther(seedAmount)} DRIPH`);
    }
  }

  console.log(`Token       -> ${tokenAddr}${ponsTokenAddress ? " (Pons)" : ""}`);
  console.log(`DripHFaucet -> ${faucetAddr}`);
  console.log(`base rate      -> up to 0.5%/day (${ethers.formatUnits(DAILY_RATE_WAD, 18)} wad/day, dynamic)`);
  console.log(`payout cap    -> none`);
  console.log(`taxes          -> deposit+withdraw 10% each, kept in the pool as backing`);

  if (chainId === 4663 || chainId === 46630) {
    const out = path.join(__dirname, "..", "..", "client", "src", "lib", "deployed-address.json");
    let manifest = { deployments: {} };
    if (fs.existsSync(out)) {
      const current = JSON.parse(fs.readFileSync(out, "utf8"));
      if (current.deployments) manifest = current;
    }
    manifest.deployments[String(chainId)] = { token: tokenAddr, faucet: faucetAddr };
    fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
    console.log(`wrote addresses to ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

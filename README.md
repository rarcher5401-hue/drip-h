# Drip H

A **DRIP Network-style faucet**, rebuilt for Robinhood Chain. Up to 0.5% daily (rate dials back
as the reserve thins), no payout ceiling, liquidity-gated claims.

**"Stake DRIPH. Earn a trickle, not a flood."**

## Why this isn't just another DRIP clone

The original Drip paid **1% daily on principal (≈3,678% APY when compounded) with no ceiling**. New
deposits were the only thing funding old payouts, so the obligation grew faster than the pool, the
flywheel stalled, and the protocol was abandoned. Drip H keeps DRIP's no-cap shape but starts at
**half the rate** and only indexes rewards from reserve headroom left after every active principal
token has been reserved.

| | Drip Network (original) | Drip H |
| --- | --- | --- |
| Daily rate | 1% / day | **up to 0.5% / day** (~517% APY compounded) - full rate while covered, dialed down as coverage thins |
| Payout ceiling | none | **none** (same flywheel, half the fuel) |
| Claim liquidity gate | pay-window unlock | claims paid from DRIPH the faucet holds |
| Deposit tax | 10% | 10% flat (stays in the pool as backing) |
| Withdraw tax | 10% | 30% for 90 days, then 10% (30% above 2M principal) |
| Lockups / windows | pay-window unlock | none - pull anytime |

## How the faucet works

1. Connect a wallet (any EVM wallet; the app auto-adds Robinhood Chain).
2. Get **DRIPH** (1,000,000 minted to the deployer at launch, or the 1,000,000,000 fixed supply from the Pons launch on mainnet).
3. **Deposit** DRIPH - a flat 10% deposit tax stays in the faucet as backing; the remaining 90% becomes your earning principal.
4. The faucet accrues **up to 0.5% of principal per day** (per-second, exact compounding; dialed down automatically when the reserve thins).
5. **Compound** (re-invest into principal - no payout ceiling, so it keeps growing) or **Claim** (send rewards to your wallet - requires the faucet to hold liquidity).
6. **Withdraw** principal anytime - exits are never locked. The exit fee is 30% for the first 90 days after launch, then 10% (30% for principals above 2,000,000 DRIPH). All of it stays as backing. There is no cap: rewards keep accruing as long as you stay staked.

The deposit rate and the entire exit-fee schedule are **immutable once deployed** - changing
them later requires deploying a new faucet and migrating positions by hand.

## Project layout

```
drip-h/
├─ contracts/                       # Hardhat (Solidity + tests)
│  ├─ contracts/
│  │  ├─ DripHToken.sol           # DRIPH ERC-20 with optional transfer fee + exclusion list
│  │  └─ DripHFaucet.sol          # the faucet: stake, accrue, compound, claim, withdraw
│  ├─ test/DripH.js                # 16 accounting and security tests
│  ├─ scripts/deploy.js             # deploys both contracts, wires address into the client
│  └─ hardhat.config.js             # robinhood (4663) + robinhoodTestnet (46630)
└─ client/                          # React + Vite + ethers v6 dashboard
   ├─ src/lib/chain.js              # network config, ABIs, loaders (protocol + position)
   └─ src/pages/Dashboard.jsx       # stake / compound / claim / withdraw UI + pool health
```

## Run it locally (needs Node 18+)

### 1. Smart contracts

```bash
cd drip-h/contracts
npm install
npm test                # 16 tests: accounting, solvency, fees, claims, gas scaling
```

### Optional: end-to-end smoke run

Runs the deploy + full user journey (stake, 30-day accrual, compound, two-sided
pool health, claim, withdraw) on a local EVM:

```bash
npm run smoke:local     # prints PASSED and a protocol summary
```

### 2. Deploy (testnet first)

Use a dedicated deployer key and explicitly configure the long-lived roles. `OWNER_ADDRESS` should
be a multisig or hardware-backed wallet; it must call `acceptOwnership()` after deployment.

```powershell
# PowerShell
$env:PRIVATE_KEY = "0x..."
$env:TREASURY_ADDRESS = "0x..."
$env:OWNER_ADDRESS = "0x..."
$env:SUPPLY_RECIPIENT_ADDRESS = "0x..."
npm.cmd run deploy:testnet
```

```bash
# bash
export PRIVATE_KEY="0x..."
export TREASURY_ADDRESS="0x..."
export OWNER_ADDRESS="0x..."
export SUPPLY_RECIPIENT_ADDRESS="0x..."
npm run deploy:testnet
```

The deploy script:
- deploys `DripHToken` (mints 1,000,000 DRIPH to the deployer)
- deploys `DripHFaucet` (0.5%/day base rate, 10% deposit tax, exit-fee schedule, **no payout cap**)
- permanently locks the faucet's transfer-fee exemption (so administration cannot break accounting)
- confirms setup transactions, checks deployment postconditions, and writes a chain-scoped entry to `client/src/lib/deployed-address.json`

Optional: seed the faucet so claims work instantly:

```powershell
$env:SEED_DRIPH = "10000"; npm.cmd run deploy:testnet
```

Mainnet: `npm run deploy:mainnet`.

### 2b. Deploy against a Pons-launched token (Robinhood mainnet)

1. Launch **DRIPH** on Pons (`https://www.ponsfamily.com/launchpad/create`): fixed 1,000,000,000
   supply, paired with WETH, 0.0005 ETH launch fee. Set **creator tax to 2.5%** with your dev
   wallet (`0x752FeFcb5705CC28f9Ff306d251d957fD89970f9`) as the creator wallet.
2. Make a developer buy so you hold DRIPH for the initial faucet reserve.
3. Deploy only the faucet against the Pons token address (mainnet refuses to deploy a second
   custom token unless `ALLOW_CUSTOM_TOKEN=true`):

```powershell
# PowerShell
$env:PRIVATE_KEY = "0x..."
$env:PONS_TOKEN_ADDRESS = "0x..."
$env:SEED_DRIPH = "20000"
npm.cmd run deploy:pons
```

4. Optionally send more DRIPH straight to the faucet contract, then call `syncDonations()`
   (or use `fundRewards(amount)` after approving the faucet). Never send ETH/WETH to the faucet.
5. Update the frontend: `VITE_CHAIN_ID=4663`, `VITE_TOKEN_ADDRESS`, `VITE_FAUCET_ADDRESS`.
   The landing, faucet, and mechanics pages display the token + faucet contract addresses
   (with copy buttons and explorer links) from that configuration automatically.
6. Optional: set `VITE_DEV_WALLET` to the dev wallet address and rebuild. Only that wallet
   sees the "Fund reserve" panel (a dashed, dev-labeled box kept separate from staking, since
   funding creates no principal and earns nothing). Anyone can still fund on-chain directly.

Verify on Blockscout:

```bash
npx hardhat verify --network robinhoodTestnet <TOKEN_ADDRESS> <treasury_address>
npx hardhat verify --network robinhoodTestnet <FAUCET_ADDRESS> <token> <"5000000000000000000"> <1000> <1000> <3000> <3000> <"2000000000000000000000000"> <7776000>
npx hardhat verify --network robinhood <FAUCET_ADDRESS> <pons_token> <"5000000000000000000"> <1000> <1000> <3000> <3000> <"2000000000000000000000000"> <7776000>
```

### 3. Frontend

```bash
cd drip-h/client
npm install
npm run dev             # http://localhost:5174
```

Or skip the deploy script and point at already-live contracts:

```powershell
$env:VITE_CHAIN_ID = "46630"
$env:VITE_TOKEN_ADDRESS = "0x..."
$env:VITE_FAUCET_ADDRESS = "0x..."
npm.cmd run dev
```

## Contract cheat sheet (`DripHFaucet`)

| Function | Who | Notes |
| --- | --- | --- |
| `deposit(amount)` | anyone | taxes 10% (kept in the pool as backing), nets the remaining 90% to principal |
| `compound()` | stakers | adds pending rewards to principal; no payout ceiling |
| `claim()` | stakers | sends pending rewards to wallet; needs faucet liquidity |
| `withdraw(amount)` | stakers | returns principal minus the scheduled exit fee (30% / 10% / whale 30%) |
| `fundRewards(amount)` | anyone | adds exact DRIPH backing without creating principal |
| `syncDonations()` | anyone | recognizes direct DRIPH transfers after checkpointing elapsed rewards |
| `pendingRewards(addr)` | anyone | returns that user's accrued-but-unrealized rewards |
| `poolObligation()` | anyone | `(outstanding, pending)` - realized rewards unpaid vs. un-accrued rewards |
| `totalOutstanding()` / `pendingObligation()` | anyone | the two halves of the obligation separately |
| `totalClaimed` / `distributed` | anyone | lifetime DRIPH paid out / generated |

## Pool health

The dashboard shows a **pool-health panel**: accounted DRIPH assets vs. all active principal plus
indexed and pending reward liabilities.

- **≥100% coverage** - accounted assets cover active principal and every indexed or pending reward.
  The rate reaches the full 0.5%/day when reward headroom covers the configured safety buffer.
- **<100% coverage** - should be unreachable through supported contract operations; the effective
  rate can reach zero before creating an unfunded reward. Token or integration failures remain risks.

This is the honest number to watch: with the dynamic rate, pool health drives how fast the faucet
drips rather than warning you that the obligation has already run away.

## Honest caveats

- **This is still not a "risk-free yield" product.** Yields come from the pool; claims are only
  paid while the faucet holds DRIPH. There is **no payout cap**, but the dynamic rate dials back
  as coverage thins - instead of creating an unfunded obligation at full speed, rewards slow down
  until deposits rebuild the reserve.
- The DRIPH transfer fee (2.5%) applies to normal transfers; it goes to the treasury wallet and
  is **exempt** for the faucet, treasury, and current owner so internal flows aren't double-taxed.
  The 10% deposit tax and every exit fee never leave the faucet - they're part of the reserve backing claims.
- Built for **education / demo** use. Test on testnet with pretend money before anything real.

## Roadmap ideas

- ve-style lockups for higher tier rates
- a DEX pair for DRIPH liquidity
- referral/share linking (DRIP style)
- pool-health is already onchain (`poolObligation`) - next: historical health snapshots

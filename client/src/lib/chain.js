import { ethers } from "ethers";
import DripHTokenArtifact from "./DripHToken.json";
import DripHFaucetArtifact from "./DripHFaucet.json";
import deployed from "./deployed-address.json";

export const TOKEN_ABI = DripHTokenArtifact.abi;
export const FAUCET_ABI = DripHFaucetArtifact.abi;

export const NETWORKS = {
  4663: {
    chainId: 4663,
    hexId: "0x1237",
    name: "Robinhood Chain",
    shortName: "RH Chain",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  46630: {
    chainId: 46630,
    hexId: "0xb62e",
    name: "Robinhood Chain Testnet",
    shortName: "RH Testnet",
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
};

export const DEFAULT_NETWORK = NETWORKS[4663];

const ENV_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 0);
const ENV_TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || null;
const ENV_FAUCET_ADDRESS = import.meta.env.VITE_FAUCET_ADDRESS || null;
const ENV_DEV_WALLET = import.meta.env.VITE_DEV_WALLET || null;

// Controls who sees the "Fund reserve" panel. UI-only gating: fundRewards is
// permissionless on-chain (a donation), so this just keeps the panel out of
// regular users' way. Set VITE_DEV_WALLET and rebuild to change it.
export function isDevWallet(account) {
  if (!account || !ENV_DEV_WALLET || !ethers.isAddress(ENV_DEV_WALLET)) return false;
  return account.toLowerCase() === ENV_DEV_WALLET.toLowerCase();
}

function validAddress(address) {
  return Boolean(address && ethers.isAddress(address) && address !== ethers.ZeroAddress);
}

export function getDeployment(chainId) {
  const id = Number(chainId ?? DEFAULT_NETWORK.chainId);
  const candidate = ENV_CHAIN_ID === id && ENV_TOKEN_ADDRESS && ENV_FAUCET_ADDRESS
    ? { token: ENV_TOKEN_ADDRESS, faucet: ENV_FAUCET_ADDRESS }
    : deployed?.deployments?.[String(id)];

  if (!candidate || !validAddress(candidate.token) || !validAddress(candidate.faucet)) return null;
  return {
    chainId: id,
    token: ethers.getAddress(candidate.token),
    faucet: ethers.getAddress(candidate.faucet),
  };
}

export function getNetwork(chainId) {
  return NETWORKS[chainId] || null;
}

function buildContract(address, abi, providerOrSigner) {
  if (!address) return null;
  return new ethers.Contract(address, abi, providerOrSigner);
}

export function getReadOnlyToken(chainId) {
  const net = getNetwork(chainId == null ? DEFAULT_NETWORK.chainId : chainId);
  const deployment = getDeployment(net?.chainId);
  if (!net || !deployment) return null;
  const provider = new ethers.JsonRpcProvider(net.rpcUrl, { chainId: net.chainId, name: net.name });
  return buildContract(deployment.token, TOKEN_ABI, provider);
}

export function getReadOnlyFaucet(chainId) {
  const net = getNetwork(chainId == null ? DEFAULT_NETWORK.chainId : chainId);
  const deployment = getDeployment(net?.chainId);
  if (!net || !deployment) return null;
  const provider = new ethers.JsonRpcProvider(net.rpcUrl, { chainId: net.chainId, name: net.name });
  return buildContract(deployment.faucet, FAUCET_ABI, provider);
}

export const { formatEther, parseEther, formatUnits } = ethers;

export function shortAddress(address, chars = 4) {
  if (!address) return "";
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function fmtToken(weiOrNull, maxDigits = 4) {
  const v = weiOrNull == null ? 0n : BigInt(weiOrNull.toString());
  const num = Number(formatEther(v));
  if (!isFinite(num)) return "0";
  return num.toLocaleString(undefined, { maximumFractionDigits: num >= 1000 ? 2 : maxDigits });
}

export function dailyPercent(dailyRateWad) {
  return Number(formatEther(dailyRateWad));
}

export function apyCompounded(dailyRateWad) {
  const daily = dailyPercent(dailyRateWad);
  return Math.pow(1 + daily, 365) - 1;
}

export async function loadProtocol(chainId) {
  const deployment = getDeployment(chainId);
  const faucet = getReadOnlyFaucet(chainId);
  if (!faucet || !deployment) return { ok: false, reason: "no-contract" };

  const [tvl, totalStakers, totalDeposits, totalPrincipal, dailyRateWad, distributed, totalClaimed, obligation] =
    await Promise.all([
      faucet.accountedBalance(),
      faucet.totalStakers(),
      faucet.totalDeposits(),
      faucet.totalPrincipal(),
      faucet.dailyRate(),
      faucet.distributed(),
      faucet.totalClaimed(),
      faucet.poolObligation(),
    ]);

  const outstanding = BigInt(obligation.outstanding || obligation[0] || 0);
  const pendingObligation = BigInt(obligation.pending || obligation[1] || 0);
  const principalLiability = BigInt(totalPrincipal);
  const rewardObligation = outstanding + pendingObligation;
  const obligationTotal = principalLiability + rewardObligation;
  const backing = BigInt(tvl);
  const coverage = obligationTotal > 0n ? Number((backing * 100000n) / obligationTotal) / 1000 : null;

  return {
    ok: true,
    tvlWei: backing,
    tvl: fmtToken(backing),
    totalStakers: Number(totalStakers),
    totalDeposits: fmtToken(totalDeposits),
    principalLiability: fmtToken(principalLiability),
    principalLiabilityWei: principalLiability,
    dailyRateWad: BigInt(dailyRateWad),
    dailyRatePct: dailyPercent(dailyRateWad) * 100,
    apyPct: apyCompounded(dailyRateWad) * 100,
    distributed: fmtToken(distributed),
    totalClaimed: fmtToken(totalClaimed),
    outstanding: fmtToken(outstanding),
    outstandingWei: outstanding,
    pendingObligation: fmtToken(pendingObligation),
    pendingObligationWei: pendingObligation,
    rewardObligation: fmtToken(rewardObligation),
    rewardObligationWei: rewardObligation,
    obligationTotal: fmtToken(obligationTotal),
    obligationTotalWei: obligationTotal,
    coveragePct: coverage,
    tokenAddress: deployment.token,
    faucetAddress: deployment.faucet,
  };
}

export async function loadPosition(chainId, account) {
  const deployment = getDeployment(chainId);
  const faucet = getReadOnlyFaucet(chainId);
  const token = getReadOnlyToken(chainId);
  if (!faucet || !token || !deployment || !account) return null;

  const [user, pending, balance, allowance] = await Promise.all([
    faucet.users(account),
    faucet.pendingRewards(account),
    token.balanceOf(account),
    token.allowance(account, deployment.faucet),
  ]);

  const principal = BigInt(user.principal);
  const totalRewarded = BigInt(user.totalRewarded);
  const claimedWei = BigInt(user.claimed);
  const compoundedWei = BigInt(user.compounded);

  return {
    principalWei: principal,
    principal: fmtToken(principal),
    totalRewardedWei: totalRewarded,
    totalRewarded: fmtToken(totalRewarded),
    compoundedWei,
    compounded: fmtToken(compoundedWei, 6),
    claimedWei,
    claimed: fmtToken(claimedWei, 6),
    pendingWei: BigInt(pending),
    pending: fmtToken(pending, 6),
    balanceWei: BigInt(balance),
    balance: fmtToken(balance),
    allowanceWei: BigInt(allowance),
    lastUpdate: Number(user.lastUpdate),
    hasDeposited: Boolean(user.hasDeposited),
  };
}

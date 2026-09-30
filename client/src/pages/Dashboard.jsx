import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ethers } from "ethers";
import { useWeb3 } from "../lib/Web3Context";
import { useToast } from "../components/Toast";
import ContractLinks from "../components/ContractLinks";
import { parseEther, loadProtocol, loadPosition, fmtToken, shortAddress, getNetwork, isDevWallet } from "../lib/chain";

const PREVIEW = {
  protocol: {
    tvl: "82,640.31",
    totalStakers: "312",
    dailyRatePct: 0.5,
    dailyRateWad: 5000000000000000n,
    apyPct: 517.4,
    totalDeposits: "612,340",
    distributed: "48,120.75",
    totalClaimed: "15,955.40",
    principalLiability: "52,000.00",
    outstanding: "3,205.18",
    pendingObligation: "12,915.06",
    rewardObligation: "16,120.24",
    obligationTotal: "68,120.24",
    coveragePct: 121.3,
  },
  position: {
    principalWei: BigInt("25000000000000000000000"),
    principal: "25,000.00",
    compounded: "4,050.86",
    pendingWei: BigInt("95500000000000000000"),
    pending: "95.50",
    claimed: "1,250.00",
    balance: "820.55",
    allowanceWei: 0n,
  },
};

function parseTokenAmount(raw) {
  const value = raw.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(value)) throw new Error("Enter a valid amount with up to 18 decimals.");
  const amount = parseEther(value);
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}

// Reserve-backed referrals: 2% of each deposit, paid from the 10% deposit
// tax (8% still backs the reserve). No self-referrals; a referrer locks in
// on the referee's first deposit. On-chain settlement ships with the faucet
// upgrade — the UI captures and carries the referrer until then.
const REFERRAL_BPS = 200;
const REFERRER_KEY = "driph_referrer";

export default function Dashboard() {
  const {
    account,
    chainId,
    isCorrectNetwork,
    connect,
    switchToRobinhood,
    getContracts,
    busy: walletBusy,
    tokenAddress,
    faucetAddress,
  } = useWeb3();
  const toast = useToast();

  const [protocol, setProtocol] = useState(null);
  const [position, setPosition] = useState(null);
  const [preview, setPreview] = useState(false);

  const [amount, setAmount] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [fundAmt, setFundAmt] = useState("");
  const [busy, setBusy] = useState(null); // running action key
  const [lastTx, setLastTx] = useState(null);
  const txLock = useRef(false);
  const refreshGeneration = useRef(0);

  const [searchParams] = useSearchParams();
  const [referrer, setReferrer] = useState(() => {
    try { return localStorage.getItem(REFERRER_KEY) || ""; } catch { return ""; }
  });
  const [refInput, setRefInput] = useState("");
  const [copied, setCopied] = useState(false);

  const viewProtocol = preview ? PREVIEW.protocol : protocol;
  const viewPosition = preview ? PREVIEW.position : position;

  const referralLink = account
    ? `${window.location.origin}/faucet?ref=${account}`
    : preview
      ? `${window.location.origin}/faucet?ref=0xYourWalletAddress`
      : null;

  let refPreview = null;
  try {
    if (amount.trim()) refPreview = fmtToken((parseTokenAmount(amount) * BigInt(REFERRAL_BPS)) / 10000n);
  } catch { refPreview = null; }

  // Capture ?ref= links: first valid non-self referrer wins. A referrer saved
  // while disconnected is re-checked on connect so self-referrals can't linger.
  useEffect(() => {
    if (account && referrer && referrer.toLowerCase() === account.toLowerCase()) {
      try { localStorage.removeItem(REFERRER_KEY); } catch { /* ignore */ }
      setReferrer("");
      return;
    }
    const q = searchParams.get("ref");
    if (!q || !ethers.isAddress(q) || referrer) return;
    if (account && q.toLowerCase() === account.toLowerCase()) return;
    const checksummed = ethers.getAddress(q);
    try { localStorage.setItem(REFERRER_KEY, checksummed); } catch { /* ignore */ }
    setReferrer(checksummed);
    toast.success("Referrer saved — they'll earn 2% of your deposit.");
  }, [searchParams, account, referrer, toast]);

  function saveReferrer() {
    const v = refInput.trim();
    if (!ethers.isAddress(v)) return toast.error("Enter a valid referrer address.");
    if (account && v.toLowerCase() === account.toLowerCase()) return toast.error("You can't refer yourself.");
    const checksummed = ethers.getAddress(v);
    try { localStorage.setItem(REFERRER_KEY, checksummed); } catch { /* ignore */ }
    setReferrer(checksummed);
    setRefInput("");
    toast.success("Referrer saved.");
  }

  function clearReferrer() {
    try { localStorage.removeItem(REFERRER_KEY); } catch { /* ignore */ }
    setReferrer("");
  }

  async function copyReferralLink() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success("Referral link copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — select the link manually.");
    }
  }

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const p = await loadProtocol(chainId ?? undefined);
      if (generation !== refreshGeneration.current) return;
      if (!p.ok) {
        setProtocol(null);
        setPosition(null);
        return;
      }
      setProtocol(p);
      if (account) {
        const pos = await loadPosition(chainId ?? undefined, account);
        if (generation !== refreshGeneration.current) return;
        setPosition(pos);
      } else {
        setPosition(null);
      }
    } catch {
      if (generation !== refreshGeneration.current) return;
      setProtocol(null);
      setPosition(null);
    }
  }, [chainId, account]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 12000);
    return () => {
      refreshGeneration.current += 1;
      clearInterval(t);
    };
  }, [refresh]);

  async function run(key, fn, okMsg) {
    if (txLock.current) return false;
    txLock.current = true;
    setBusy(key);
    try {
      const tx = await fn();
      const txChainId = Number((await tx.provider.getNetwork()).chainId);
      setLastTx({ hash: tx.hash, chainId: txChainId });
      const receipt = await tx.wait();
      setLastTx({ hash: receipt.hash, chainId: txChainId });
      toast.success(okMsg);
      await refresh();
      return true;
    } catch (err) {
      toast.error(err?.shortMessage || err?.reason || "Transaction failed. If you denied it, no charge was made.");
      return false;
    } finally {
      txLock.current = false;
      setBusy(null);
    }
  }

  async function deposit() {
    let amountWei;
    try {
      amountWei = parseTokenAmount(amount);
    } catch (err) {
      return toast.error(err.message);
    }
    if (position?.balanceWei != null && amountWei > position.balanceWei) return toast.error("Amount exceeds your DRIPH balance.");

    if ((position?.allowanceWei ?? 0n) < amountWei) {
      const approved = await run("approve", async () => {
        const { token, deployment } = await getContracts();
        return token.approve(deployment.faucet, amountWei);
      }, "Spending approved.");
      if (!approved) return;
    }
    await run("deposit", async () => {
      const { token, faucet, signer, deployment } = await getContracts();
      const signerAddress = await signer.getAddress();
      const currentAllowance = await token.allowance(signerAddress, deployment.faucet);
      if (currentAllowance < amountWei) throw new Error("Approval is no longer sufficient.");
      // TODO(referrals): pass referrer to faucet.deposit once the upgrade is live.
      return faucet.deposit(amountWei);
    }, `Staked ${fmtToken(amountWei)} DRIPH. The drip has started.${referrer ? " Your referrer earns 2%." : ""}`);
  }

  async function compound() {
    if (!position?.pendingWei || position.pendingWei <= 0n)
      return toast.error("Nothing to compound yet.");
    await run("compound", async () => (await getContracts()).faucet.compound(), `Compounded ${position.pending} DRIPH into principal.`);
  }

  async function claim() {
    if (!position?.pendingWei || position.pendingWei <= 0n) return toast.error("Nothing to claim yet.");
    await run("claim", async () => (await getContracts()).faucet.claim(), `Claimed ${position.pending} DRIPH to your wallet.`);
  }

  async function doWithdraw() {
    let amountWei;
    try {
      amountWei = parseTokenAmount(withdrawAmt);
    } catch (err) {
      return toast.error(err.message);
    }
    if (position?.principalWei != null && amountWei > position.principalWei) return toast.error("Amount exceeds your principal.");
    await run("withdraw", async () => (await getContracts()).faucet.withdraw(amountWei), `Withdrew ${fmtToken(amountWei)} DRIPH (taxed 10%).`);
  }

  async function fundReserve() {
    let amountWei;
    try {
      amountWei = parseTokenAmount(fundAmt);
    } catch (err) {
      return toast.error(err.message);
    }
    if (position?.balanceWei != null && amountWei > position.balanceWei) return toast.error("Amount exceeds your DRIPH balance.");

    if ((position?.allowanceWei ?? 0n) < amountWei) {
      const approved = await run("approve", async () => {
        const { token, deployment } = await getContracts();
        return token.approve(deployment.faucet, amountWei);
      }, "Spending approved.");
      if (!approved) return;
    }
    const ok = await run("fund", async () => {
      const { token, faucet, signer, deployment } = await getContracts();
      const signerAddress = await signer.getAddress();
      const currentAllowance = await token.allowance(signerAddress, deployment.faucet);
      if (currentAllowance < amountWei) throw new Error("Approval is no longer sufficient.");
      return faucet.fundRewards(amountWei);
    }, `Funded the reserve with ${fmtToken(amountWei)} DRIPH.`);
    if (ok) setFundAmt("");
  }

  const needsContract = !tokenAddress || !faucetAddress;

  return (
    <div className="page">
      <section className="page-head page-head--dashboard">
        <div>
          <p className="section-kicker">Your onchain position</p>
          <h1 className="page-title">Faucet</h1>
          <p className="page-sub">
            Stake, compound, claim, or withdraw. The live rate responds automatically to reserve health.
          </p>
        </div>
        <div className="rate-lockup">
          <span>Live daily rate</span>
          <strong>{viewProtocol ? `${viewProtocol.dailyRatePct.toFixed(2)}%` : "≤ 0.50%"}</strong>
          <small><i /> Dynamic</small>
        </div>
      </section>

      <section className="section">
        {needsContract && !preview ? (
          <div className="empty">
            <p className="empty-title">Nothing to interact with yet.</p>
            <p className="muted">Deploy the protocol so the faucet has an address.</p>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <button className="btn btn--ghost btn--lg" onClick={() => setPreview(true)}>
                Preview dashboard — sample data
              </button>
            </div>
          </div>
        ) : preview || account ? (
          preview || isCorrectNetwork ? (
            <>
              {preview && (
                <div className="banner banner--info">
                  <strong>Preview mode</strong> — showing sample numbers. Connect your wallet for
                  live data.{" "}
                  <a href="#position" onClick={(e) => { e.preventDefault(); setPreview(false); }}>
                    Exit preview
                  </a>
                </div>
              )}

              <div className="dash">
            <div className="dash-main">
              <div className="card panel position-card" id="position">
                <div className="panel-title">
                  <h3>Your position</h3>
                  <span className="account-pill">{preview ? "Sample data" : shortAddress(account, 6)}</span>
                </div>

                <div className="position-lead">
                  <div className="position-balance">
                    <span>Staked principal</span>
                    <strong>{viewPosition?.principal ?? "0"}</strong>
                    <small>DRIPH actively earning</small>
                  </div>
                  <div className="pending-card">
                    <span>Ready now</span>
                    <strong>+{viewPosition?.pending ?? "0"}</strong>
                    <small>DRIPH pending rewards</small>
                  </div>
                </div>

                <div className="kv-grid position-stats">
                  <div className="kv">
                    <div className="kv-value accent">{viewPosition?.compounded ?? "0"}</div>
                    <div className="kv-label">compounded to date (DRIPH)</div>
                  </div>
                  <div className="kv">
                    <div className="kv-value">{viewPosition?.claimed ?? "0"}</div>
                    <div className="kv-label">claimed to wallet (DRIPH)</div>
                  </div>
                  <div className="kv">
                    <div className="kv-value">{viewPosition?.balance ?? "0"}</div>
                    <div className="kv-label">DRIPH in wallet</div>
                  </div>
                  <div className="kv">
                    <div className="kv-value">
                      {viewPosition && viewProtocol
                        ? fmtToken((viewPosition.principalWei * viewProtocol.dailyRateWad) / 1000000000000000000n)
                        : "0"}
                    </div>
                    <div className="kv-label">earning / day at {viewProtocol ? `${viewProtocol.dailyRatePct.toFixed(2)}%` : "0.5%"}</div>
                  </div>
                </div>

                <p className="hint small">
                  No payout cap: rewards accrue on your principal every second and are yours once
                  claimed or compounded. The live rate and pool-health panel show how reserve coverage
                  is affecting your position right now.
                </p>
              </div>

              <div className="card panel action-card">
                <div className="panel-title">
                  <h3>Actions</h3>
                  <span className="muted small">10% tax funds the reserve</span>
                </div>

                <div className="action-grid">
                  <div className="action-block action-block--primary">
                    <div className="action-copy">
                      <strong>Stake DRIPH</strong>
                      <span>Add principal and start earning.</span>
                    </div>
                    <div className="action-row">
                      <div className="field">
                        <span>Amount</span>
                        <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" disabled={preview} />
                      </div>
                      <button className="btn btn--primary" onClick={deposit} disabled={busy || preview}>
                        {busy === "deposit" || busy === "approve" ? "Working…" : "Deposit"}
                      </button>
                    </div>
                    {referrer ? (
                      <p className="hint small ref-active">
                        Referrer <strong>{shortAddress(referrer, 6)}</strong> active — they earn 2% of this deposit from the tax.{" "}
                        <button type="button" className="link-btn" onClick={clearReferrer} disabled={busy || preview}>Remove</button>
                      </p>
                    ) : (
                      <div className="ref-field-row">
                        <div className="field">
                          <span>Referrer (optional)</span>
                          <input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="0x…" disabled={preview} />
                        </div>
                        <button className="btn btn--ghost" onClick={saveReferrer} disabled={busy || preview || !refInput.trim()}>
                          Save
                        </button>
                      </div>
                    )}
                    {refPreview && (
                      <p className="hint small">Split: 90% your principal · 2% ({refPreview} DRIPH) referrer · 8% reserve.</p>
                    )}
                  </div>
                  <div className="action-block">
                    <div className="action-copy">
                      <strong>Withdraw principal</strong>
                      <span>Receive 90%; 10% stays in the reserve.</span>
                    </div>
                    <div className="action-row">
                      <div className="field">
                        <span>Amount</span>
                        <input type="number" min="0" step="any" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} placeholder={viewPosition?.principal || "0"} disabled={preview} />
                      </div>
                      <button className="btn btn--ghost" onClick={doWithdraw} disabled={busy || preview}>
                        {busy === "withdraw" ? "Working…" : "Withdraw"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="reward-actions">
                  <div>
                    <span>Pending rewards</span>
                    <strong>{viewPosition?.pending ?? "0"} DRIPH</strong>
                  </div>
                  <div className="reward-buttons">
                    <button className="btn btn--ghost" onClick={compound} disabled={busy || preview || !viewPosition?.pendingWei}>
                      {busy === "compound" ? "Compounding…" : "Compound"}
                    </button>
                    <button className="btn btn--dark" onClick={claim} disabled={busy || preview || !viewPosition?.pendingWei}>
                      {busy === "claim" ? "Claiming…" : "Claim to wallet"}
                    </button>
                  </div>
                </div>

                {lastTx && (
                  <div className="banner banner--info">
                    Last transaction:{" "}
                    <a href={`${getNetwork(lastTx.chainId)?.explorer}/tx/${lastTx.hash}`} target="_blank" rel="noreferrer">
                      {lastTx.hash.slice(0, 18)}…
                    </a>
                  </div>
                )}
              </div>

              <div className="card panel referral-panel">
                <div className="panel-title">
                  <h3>Referrals</h3>
                  <span className="account-pill">2% · from deposit tax</span>
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  Share your link. When someone deposits with it, you earn <strong>2% of their
                  deposit</strong> — paid from the 10% deposit tax, so 8% still backs the reserve.
                  No self-referrals; a referrer locks in on first deposit.
                </p>
                <div className="ref-link-row">
                  <div className="field">
                    <span>Your referral link</span>
                    <input
                      value={referralLink ?? ""}
                      readOnly
                      placeholder={account || preview ? "" : "Connect wallet to generate"}
                    />
                  </div>
                  <button className="btn btn--primary" onClick={copyReferralLink} disabled={busy || preview || !referralLink}>
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <div className="kv-grid ref-stats">
                  <div className="kv">
                    <div className="kv-value accent">2%</div>
                    <div className="kv-label">commission per referred deposit</div>
                  </div>
                  <div className="kv">
                    <div className="kv-value">{referrer ? shortAddress(referrer, 6) : "—"}</div>
                    <div className="kv-label">your referrer</div>
                  </div>
                  <div className="kv">
                    <div className="kv-value">Soon</div>
                    <div className="kv-label">on-chain earnings</div>
                  </div>
                </div>
                <p className="hint small">
                  Referral rewards settle with the faucet upgrade — referrers saved now carry over.
                  Earnings never touch reserved principal.
                </p>
              </div>

              {(preview || (account && isDevWallet(account))) && (
                <div className="card panel dev-panel">
                  <div className="panel-title">
                    <h3>Fund reserve</h3>
                    <span className="account-pill">dev only</span>
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>
                    Send DRIPH to the reserve as backing. This is <strong>not staking</strong> — it
                    creates no principal, earns no rewards, and cannot be withdrawn. For topping up
                    the pool with creator fees.
                  </p>
                  <div className="ref-link-row">
                    <div className="field">
                      <span>Amount (DRIPH in your wallet: {viewPosition?.balance ?? "0"})</span>
                      <input
                        type="number" min="0" step="any" value={fundAmt}
                        onChange={(e) => setFundAmt(e.target.value)} placeholder="1000"
                        disabled={busy || preview}
                      />
                    </div>
                    <button className="btn btn--dark" onClick={fundReserve} disabled={busy || preview || !fundAmt.trim()}>
                      {busy === "fund" || busy === "approve" ? "Working…" : "Fund"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="dash-side">
              <PoolHealth protocol={viewProtocol} />

              <div className="card panel">
                <h3 className="panel-title">Protocol</h3>
                <div className="kv">
                  <div className="kv-value">{viewProtocol?.totalDeposits ?? "0"}</div>
                  <div className="kv-label">total DRIPH ever staked</div>
                </div>
                <div className="kv">
                  <div className="kv-value">{viewProtocol ? `${viewProtocol.dailyRatePct.toFixed(3)}%` : "—"}</div>
                  <div className="kv-label">earned per day</div>
                </div>
                <div className="kv">
                  <div className="kv-value">{viewProtocol ? `~${viewProtocol.apyPct.toFixed(1)}%` : "—"}</div>
                  <div className="kv-label">APY if compounded daily</div>
                </div>
                <div className="kv">
                  <div className="kv-value">{viewProtocol?.distributed ?? "0"}</div>
                  <div className="kv-label">rewards generated (lifetime)</div>
                </div>
                <div className="kv">
                  <div className="kv-value">{viewProtocol?.totalClaimed ?? "0"}</div>
                  <div className="kv-label">rewards paid out (lifetime)</div>
                </div>
                <details className="faq-item">
                  <summary>Why 0.5%, not 1%?</summary>
                  <p>
                    Half of DRIP's rate halves the compound spiral while still paying ~517% APY. Even
                    so, there is no payout cap, and every claim is paid from the pool - so the rate
                    also dials back automatically when reserve headroom thins.
                  </p>
                </details>
                <div className="contract-block">
                  <div className="kv-label">contracts</div>
                  <ContractLinks chainId={preview ? undefined : chainId} />
                </div>
              </div>
            </div>
              </div>
            </>
          ) : (
            <div className="gate">
              <h2>Wrong network</h2>
              <p className="muted">Drip H runs on Robinhood Chain. Switch your wallet to continue.</p>
              <button className="btn btn--warn btn--lg" onClick={switchToRobinhood} disabled={walletBusy}>
                {walletBusy ? "Switching..." : "Switch to Robinhood Chain"}
              </button>
            </div>
          )
        ) : (
          <div className="gate">
            <h2>Connect your wallet to open the faucet</h2>
            <p className="muted">Your position, pending earnings, and the protocol TVL will show up here.</p>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <button className="btn btn--primary btn--lg" onClick={() => connect().catch(() => {})} disabled={walletBusy}>
                {walletBusy ? "Connecting..." : "Connect wallet"}
              </button>
              <button className="btn btn--ghost btn--lg" onClick={() => setPreview(true)} disabled={walletBusy}>
                Preview dashboard — sample data
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PoolHealth({ protocol }) {
  if (!protocol) return null;
  const { tvl, principalLiability, rewardObligation, outstanding, pendingObligation, obligationTotal, coveragePct } = protocol;

  let verdict, tone;
  if (coveragePct == null) {
    verdict = "No standing obligations";
    tone = "good";
  } else if (coveragePct >= 100) {
    verdict = "Fully backed at this snapshot";
    tone = "good";
  } else if (coveragePct >= 50) {
    verdict = "Under stress - some rewards unfunded";
    tone = "warn";
  } else {
    verdict = "Heavily underwater";
    tone = "bad";
  }

  return (
    <div className="card panel pool-health-card">
      <div className="panel-title">
        <h3>Pool health</h3>
        <span className={`health-chip health-chip--${tone}`}>{verdict}</span>
      </div>

      <div className="health-meter">
        <div className="health-bar">
          <div
            className={`health-fill health-fill--${tone}`}
            style={{ width: `${Math.min(100, coveragePct ?? 0)}%` }}
          />
        </div>
        <div className="health-labels">
          <span className="health-pct">{coveragePct == null ? "—" : `${coveragePct.toFixed(0)}%`}</span>
          <span className="muted small">total liability coverage</span>
        </div>
      </div>

      <div className="kv">
        <div className="kv-value">{tvl}</div>
        <div className="kv-label">DRIPH in faucet (backing)</div>
      </div>
      <div className="kv">
        <div className="kv-value">{obligationTotal}</div>
        <div className="kv-label">principal + reward liabilities</div>
      </div>
      <div className="kv-row">
        <div>
          <div className="stat-value">{principalLiability}</div>
          <div className="kv-label">principal reserved</div>
        </div>
        <div className="stat-right">
          <div className="stat-value">{rewardObligation}</div>
          <div className="kv-label">reward liabilities</div>
        </div>
      </div>
      <div className="kv-row">
        <div>
          <div className="stat-value">{outstanding}</div>
          <div className="kv-label">indexed rewards</div>
        </div>
        <div className="stat-right">
          <div className="stat-value">{pendingObligation}</div>
          <div className="kv-label">pending checkpoint</div>
        </div>
      </div>
      <p className="hint small">
        Coverage includes all active principal plus indexed and pending rewards. It is a live
        snapshot, not a guarantee against token, wallet, or network risk.
      </p>
    </div>
  );
}

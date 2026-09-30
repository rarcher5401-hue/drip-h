import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadProtocol } from "../lib/chain";

export default function Landing() {
  const [protocol, setProtocol] = useState(null);
  const [noContract, setNoContract] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const p = await loadProtocol(undefined);
        if (!alive) return;
        if (!p.ok) {
          setNoContract(true);
          setProtocol(null);
          return;
        }
        setNoContract(false);
        setProtocol(p);
      } catch {
        if (!alive) return;
        setNoContract(true);
        setProtocol(null);
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="page">
      <section className="hero hero--landing">
        <div className="hero-coordinate" aria-hidden="true">
          <span>RHC / 4663</span>
          <span>RESERVE / LIVE</span>
        </div>
        <div className="hero-inner">
          <p className="hero-eyebrow">A DRIP-style faucet, tuned for survival</p>
          <h1 className="hero-title">
            Earn steadily.<br /><span className="hero-accent">Stay liquid.</span>
          </h1>
          <p className="hero-sub">
            Stake DRIPH for up to 0.5% per day. The rate responds to reserve health, while deposit
            and withdrawal taxes remain in the pool to back future claims.
          </p>
          <div className="hero-actions">
            <Link className="btn btn--primary btn--lg" to="/faucet">
              Open faucet <span aria-hidden="true">→</span>
            </Link>
            <Link className="btn btn--ghost btn--lg" to="/how-it-works">
              See the mechanics
            </Link>
            <a
              className="btn btn--ghost btn--lg"
              href={protocol?.ponsUrl ?? "https://www.ponsfamily.com/launchpad"}
              target="_blank"
              rel="noreferrer"
              title={protocol?.ponsUrl ? "Trade DRIPH in its Pons pool" : "Pons launchpad — the DRIPH pool link appears here after launch"}
            >
              Buy DRIPH on Pons ↗
            </a>
          </div>
          <div className="hero-trust" aria-label="Protocol highlights">
            <span><i /> No lockups</span>
            <span><i /> Reserve-backed</span>
            <span><i /> 2% referrals</span>
            <span><i /> Live onchain</span>
          </div>
        </div>

        <div className="reserve-card">
          <span className="instrument-code" aria-hidden="true">H/01</span>
          <div className="reserve-card-head">
            <span>Faucet reserve</span>
            <span className="live-pill"><i /> Live</span>
          </div>
          <div className="reserve-value-row">
            <div>
              <div className="reserve-value">{protocol ? protocol.tvl : "82,640.31"}</div>
              <div className="reserve-unit">accounted protocol assets</div>
            </div>
            <span className="reserve-change">Pool funded</span>
          </div>
          <div className="reserve-chart" aria-hidden="true">
            <svg viewBox="0 0 560 180" preserveAspectRatio="none">
              <defs>
                <linearGradient id="reserveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00c805" stopOpacity="0.24" />
                  <stop offset="100%" stopColor="#00c805" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path className="chart-grid" d="M0 45H560M0 90H560M0 135H560" />
              <path className="chart-area" d="M0 142 C45 137,72 151,110 126 S178 116,214 122 S282 72,324 88 S390 102,430 61 S510 49,560 25 L560 180 L0 180 Z" />
              <path className="chart-line" d="M0 142 C45 137,72 151,110 126 S178 116,214 122 S282 72,324 88 S390 102,430 61 S510 49,560 25" />
              <circle cx="560" cy="25" r="5" />
            </svg>
          </div>
          <div className="reserve-metrics">
            <div>
              <span>Live daily rate</span>
              <strong>{protocol ? `${protocol.dailyRatePct.toFixed(2)}%` : "0.50%"}</strong>
            </div>
            <div>
              <span>Stakers</span>
              <strong>{protocol ? protocol.totalStakers : "312"}</strong>
            </div>
            <div>
              <span>Rate model</span>
              <strong>Dynamic</strong>
            </div>
          </div>
          <div className="flow-wordmark" aria-hidden="true">
            <span>Deposit</span><i /><span>Reserve</span><i /><span>Reward</span>
          </div>
        </div>
      </section>

      {noContract && (
        <div className="banner banner--warn">
          <strong>Contracts not deployed yet.</strong> Deploy <code>DripHToken.sol</code> and{" "}
          <code>DripHFaucet.sol</code> to Robinhood Chain testnet, then reload (see README). Or set{" "}
          <code>VITE_CHAIN_ID</code>, <code>VITE_TOKEN_ADDRESS</code>, and <code>VITE_FAUCET_ADDRESS</code>.
        </div>
      )}

      <section className="value-strip" aria-label="Protocol design">
        <article>
          <span className="value-index">01</span>
          <div><strong>Taxes strengthen the pool</strong><p>10% in and out — deposits split 8% reserve + 2% referrer reward.</p></div>
        </article>
        <article>
          <span className="value-index">02</span>
          <div><strong>The rate reads the room</strong><p>Coverage falls, yield slows. Coverage recovers, yield returns.</p></div>
        </article>
        <article>
          <span className="value-index">03</span>
          <div><strong>Your position stays flexible</strong><p>Compound, claim, or withdraw without a lockup window.</p></div>
        </article>
      </section>

      <section className="landing-story">
        <div className="story-copy">
          <p className="section-kicker">Designed around the reserve</p>
          <h2>Yield should react before liquidity breaks.</h2>
        </div>
        <p className="story-body">
          Drip H keeps the simple faucet experience, then adds the feedback loop the original model
          lacked. The dashboard exposes pool coverage, obligations, and the effective rate so you can
          see the system's condition before you act.
        </p>
      </section>
    </div>
  );
}

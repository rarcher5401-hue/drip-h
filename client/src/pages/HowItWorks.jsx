import { Link } from "react-router-dom";

const STEPS = [
  {
    n: "01",
    title: "Get DRIPH",
    body: "Staking runs on the DRIPH token: a fixed 1,000,000,000 supply launched on Pons on Robinhood Chain. Buy DRIPH in the Pons pool, then stake it here to start earning.",
  },
  {
    n: "02",
    title: "Deposit into the faucet",
    body: "Stake DRIPH. A 10% deposit tax applies: 90% becomes your earning principal, up to 2% rewards your referrer (if you set one), and the rest stays as reserve backing.",
  },
  {
    n: "03",
    title: "The drip starts",
    body: "You earn up to 0.5% of your principal every day, computed per-second and compounding-ready. The full rate runs while the reserve is healthy; it dials back automatically if it isn't. Talk to the faucet anytime: compound (re-invest), claim (send to wallet), or leave it running.",
  },
  {
    n: "04",
    title: "No ceiling",
    body: "There is no payout cap. Rewards accrue forever, and compounding grows your earning base each time - classic DRIP mechanics, at up to half the rate.",
  },
  {
    n: "05",
    title: "Withdraw anytime",
    body: "Pull your principal whenever you like (10% withdraw tax, which stays in the pool as backing). No lockups, no windows, no unlock calendars.",
  },
  {
    n: "06",
    title: "Refer friends, earn 2%",
    body: "Share your /faucet?ref= link. You earn 2% of each referred deposit, paid from the deposit tax — never from principal. Referrers lock in on first deposit; no self-referrals.",
  },
];

export default function HowItWorks() {
  return (
    <div className="page page--narrow">
      <section className="page-hero how-hero">
        <p className="hero-eyebrow">The economics</p>
        <h1 className="page-title">Built to slow down<br />before it dries out.</h1>
        <p className="page-sub">
          Drip Network paid 1% daily with no ceiling; the obligation grew faster than the funding
          and it collapsed. Drip H keeps the simple no-cap experience, while letting pool coverage
          control how quickly new rewards accrue.
        </p>
        <div className="mechanic-row">
          <span><strong>0.50%</strong> max daily rate</span>
          <span><strong>10%</strong> pool-backed taxes</span>
          <span><strong>0</strong> lockup days</span>
        </div>
      </section>

      <section className="section">
        <div className="steps">
          {STEPS.map((s) => (
            <div key={s.n} className="step">
              <div className="step-number">{s.n}</div>
              <div className="step-body">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>The safety rails</h2></div>
        <div className="detail-grid">
          <div className="card panel">
            <h3>1. Half the headline</h3>
            <p className="muted">Up to 0.5% daily (~517% APY compounded) instead of 1% daily (~3,678% APY), and the rate shrinks automatically if the reserve ever thins. The compounding flywheel spins, just slower.</p>
          </div>
          <div className="card panel">
            <h3>2. The faucet pays what it holds</h3>
            <p className="muted">No payout ceiling - claims are literally paid from the DRIPH the faucet holds, and the rate dials back as coverage thins, so the obligation never outruns the reserve.</p>
          </div>
          <div className="card panel">
            <h3>3. Taxes feed the pool</h3>
            <p className="muted">10% deposit and 10% withdraw taxes stay in the faucet as reserve backing — except a 2% referral slice of each deposit, which rewards the referrer while the remaining 8% tops up whatever claims are owed.</p>
          </div>
          <div className="card panel">
            <h3>4. Pull, don't push</h3>
            <p className="muted">You choose when to claim or compound. Nothing moves your money without a signature.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="gate" style={{ paddingBottom: 0 }}>
          <Link className="btn btn--primary btn--lg" to="/faucet">
            Open the faucet <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}

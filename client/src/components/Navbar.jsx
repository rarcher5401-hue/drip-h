import { NavLink, Link } from "react-router-dom";
import { useWeb3 } from "../lib/Web3Context";
import { shortAddress } from "../lib/chain";

export default function Navbar() {
  const { account, busy, connect, disconnect, isCorrectNetwork, chainId, selectedNetwork, switchToRobinhood } =
    useWeb3();

  return (
    <header className="navbar">
      <div className="navbar-shell">
        <Link to="/" className="brand">
          <img src="/Drip H logo.png" alt="Drip H logo" className="brand-mark brand-logo" height="30" />
          <span className="brand-name">
            <span className="brand-word">Drip H<span className="brand-dot">.</span></span>
            <small>reserve protocol</small>
          </span>
        </Link>

        <nav className="nav-links" aria-label="Primary navigation">
          <NavLink to="/faucet">Faucet</NavLink>
          <NavLink to="/how-it-works">How it works</NavLink>
        </nav>

        <div className="nav-actions">
          <a className="x-link" href="https://x.com/DripH00D" target="_blank" rel="noreferrer" aria-label="Drip H on X" title="Drip H on X">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
          </a>
          {account ? (
            <>
              {!isCorrectNetwork ? (
                <button className="btn btn--warn" onClick={switchToRobinhood} disabled={busy}>
                  {busy ? "Switching..." : "Switch network"}
                </button>
              ) : (
                <span className="net-chip" title={`Chain ID ${chainId}`}>
                  <span className="dot" style={{ background: "var(--accent-bright)" }} />
                  {selectedNetwork?.shortName}
                </span>
              )}
              <button className="btn btn--ghost" onClick={disconnect} title="Disconnect">
                {shortAddress(account)}
              </button>
            </>
          ) : (
            <button className="btn btn--primary" onClick={() => connect().catch(() => {})} disabled={busy}>
              {busy ? "Connecting..." : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

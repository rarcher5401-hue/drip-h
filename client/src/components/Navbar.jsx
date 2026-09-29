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

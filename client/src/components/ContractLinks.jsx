import { useState } from "react";
import { DEFAULT_NETWORK, getDeployment, getNetwork, shortAddress } from "../lib/chain";

// Shared token + faucet address display with copy and explorer links.
// Renders a quiet placeholder until a deployment exists for the chain.
export default function ContractLinks({ chainId }) {
  const [copied, setCopied] = useState(null);
  const deployment = getDeployment(chainId ?? DEFAULT_NETWORK.chainId);
  const explorer = deployment ? getNetwork(deployment.chainId)?.explorer : null;

  if (!deployment || !explorer) {
    return <p className="hint small" style={{ margin: 0 }}>Contract addresses appear here after launch.</p>;
  }

  if (!deployment.faucet) {
    return (
      <div className="contract-links">
        <div className="contract-row" key="Token">
          <span className="contract-tag">Token</span>
          <code className="contract-addr" title={deployment.token}>{shortAddress(deployment.token, 6)}</code>
          <span className="contract-btns">
            <button type="button" className="link-btn" onClick={() => copy("Token", deployment.token)}>
              {copied === "Token" ? "Copied ✓" : "Copy"}
            </button>
            <a className="link" href={`${explorer}/address/${deployment.token}`} target="_blank" rel="noreferrer">
              View ↗
            </a>
          </span>
        </div>
        <div className="contract-row" key="Faucet">
          <span className="contract-tag">Faucet</span>
          <span className="muted small">deploying — address appears here</span>
        </div>
      </div>
    );
  }

  async function copy(label, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable — address stays visible for manual copy */
    }
  }

  const rows = [
    ["Token", deployment.token],
    ["Faucet", deployment.faucet],
  ];

  return (
    <div className="contract-links">
      {rows.map(([label, value]) => (
        <div className="contract-row" key={label}>
          <span className="contract-tag">{label}</span>
          <code className="contract-addr" title={value}>{shortAddress(value, 6)}</code>
          <span className="contract-btns">
            <button type="button" className="link-btn" onClick={() => copy(label, value)}>
              {copied === label ? "Copied ✓" : "Copy"}
            </button>
            <a className="link" href={`${explorer}/address/${value}`} target="_blank" rel="noreferrer">
              View ↗
            </a>
          </span>
        </div>
      ))}
    </div>
  );
}

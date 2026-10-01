import { Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import HowItWorks from "./pages/HowItWorks";

export default function App() {
  return (
    <div className="app">
      <Navbar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/faucet" element={<Dashboard />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </main>
      <footer className="footer">
        <div className="footer-shell">
          <p><strong>Drip H.</strong> Experimental onchain yield infrastructure.</p>
          <p>Not affiliated with Robinhood or Drip Network. Testnet first. Nothing here is financial advice.</p>
          <p>
            <a className="social-link" href="https://x.com/DripH00D" target="_blank" rel="noreferrer" aria-label="Drip H on X">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              @DripH00D
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

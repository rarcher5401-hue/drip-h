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
        </div>
      </footer>
    </div>
  );
}

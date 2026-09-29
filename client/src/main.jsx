import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { Web3Provider } from "./lib/Web3Context";
import { ToastProvider } from "./components/Toast";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Web3Provider>
          <App />
        </Web3Provider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
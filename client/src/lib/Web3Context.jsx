import { ethers } from "ethers";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_NETWORK, FAUCET_ABI, NETWORKS, TOKEN_ABI, getDeployment, getNetwork } from "./chain";

const Web3Context = createContext(null);

async function switchNetwork(provider, net) {
  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: net.hexId }]);
  } catch (err) {
    if (err?.code === 4902) {
      await provider.send("wallet_addEthereumChain", [
        {
          chainId: net.hexId,
          chainName: net.name,
          nativeCurrency: net.nativeCurrency,
          rpcUrls: [net.rpcUrl],
          blockExplorerUrls: [net.explorer],
        },
      ]);
    } else {
      throw err;
    }
  }
}

export function Web3Provider({ children }) {
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const selectedNetwork = chainId ? getNetwork(chainId) : null;
  const deployment = chainId ? getDeployment(chainId) : null;
  const isCorrectNetwork = chainId === null || Boolean(selectedNetwork && deployment);

  const initFromEip1193 = useCallback(async (eth) => {
    try {
      const browserProvider = new ethers.BrowserProvider(eth);
      const net = await browserProvider.getNetwork();
      const accounts = await browserProvider.listAccounts();
      setProvider(browserProvider);
      setChainId(Number(net.chainId));
      setAccount(accounts[0]?.address || null);
    } catch {
      setProvider(null);
      setChainId(null);
      setAccount(null);
    }
  }, []);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    initFromEip1193(eth);
    const onAccounts = (accs) => setAccount(accs[0] ? ethers.getAddress(accs[0]) : null);
    const onChain = () => {
      setProvider(null);
      setChainId(null);
      initFromEip1193(eth);
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener("accountsChanged", onAccounts);
      eth.removeListener("chainChanged", onChain);
    };
  }, [initFromEip1193]);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) throw new Error("No wallet found. Install MetaMask or the Robinhood Wallet.");
    setBusy(true);
    setError(null);
    try {
      await eth.request({ method: "eth_requestAccounts" });
      await initFromEip1193(eth);
    } catch (err) {
      setError(err?.message || "Could not connect wallet.");
      throw err;
    } finally {
      setBusy(false);
    }
  }, [initFromEip1193]);

  const switchToRobinhood = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) throw new Error("No wallet found.");
    setBusy(true);
    setError(null);
    try {
      await switchNetwork(
        { send: (method, params) => eth.request({ method, params }) },
        DEFAULT_NETWORK
      );
      await initFromEip1193(eth);
    } catch (err) {
      setError(err?.message || "Could not switch network.");
    } finally {
      setBusy(false);
    }
  }, [initFromEip1193]);

  const disconnect = useCallback(() => {
    setProvider(null);
    setAccount(null);
    setChainId(null);
  }, []);

  const getContracts = useCallback(async () => {
    if (!window.ethereum) throw new Error("No wallet found.");

    const currentHex = await window.ethereum.request({ method: "eth_chainId" });
    const currentChainId = Number.parseInt(currentHex, 16);
    const currentDeployment = getDeployment(currentChainId);
    if (!currentDeployment) throw new Error("Drip H is not deployed on this network.");
    if (!currentDeployment.faucet) throw new Error("The faucet is not deployed yet.");

    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    const [tokenCode, faucetCode] = await Promise.all([
      browserProvider.getCode(currentDeployment.token),
      browserProvider.getCode(currentDeployment.faucet),
    ]);
    if (tokenCode === "0x" || faucetCode === "0x") throw new Error("Configured contract code was not found.");

    const signer = await browserProvider.getSigner();
    const faucet = new ethers.Contract(currentDeployment.faucet, FAUCET_ABI, signer);
    const configuredToken = ethers.getAddress(await faucet.token());
    if (configuredToken !== currentDeployment.token) throw new Error("Faucet token configuration mismatch.");

    return {
      token: new ethers.Contract(currentDeployment.token, TOKEN_ABI, signer),
      faucet,
      signer,
      chainId: currentChainId,
      deployment: currentDeployment,
    };
  }, []);

  const value = useMemo(
    () => ({
      provider,
      account,
      chainId,
      selectedNetwork,
      isCorrectNetwork,
      busy,
      error,
      connect,
      disconnect,
      switchToRobinhood,
      getContracts,
      tokenAddress: deployment?.token || null,
      faucetAddress: deployment?.faucet || null,
      networks: NETWORKS,
      defaultNetwork: DEFAULT_NETWORK,
    }),
    [provider, account, chainId, selectedNetwork, deployment, isCorrectNetwork, busy, error, connect, disconnect, switchToRobinhood, getContracts]
  );

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}

export function useWeb3() {
  const ctx = useContext(Web3Context);
  if (!ctx) throw new Error("useWeb3 must be used within Web3Provider");
  return ctx;
}

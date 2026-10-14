// Connecting MetaMask (or any browser wallet) to the ALT account. The wallet proves it is yours by
// signing a standard Sign-In With Ethereum message (EIP-4361) with a one-time nonce from ALT Core;
// no key or password leaves MetaMask, and ALT never signs with it. Linked wallets count as yours
// in ALT: AIs and POL you hold there show as yours.

/** The EIP-4361 message Core checks (`/core/me/wallets/link`). Pure, so it can be tested anywhere. */
export function siweMessage({ domain, address, statement, uri, chainId, nonce, issuedAt }) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    statement,
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

const hex = (text) => "0x" + [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** True when a browser wallet such as MetaMask is installed. */
export const hasBrowserWallet = () => typeof window !== "undefined" && Boolean(window.ethereum);

/**
 * Asks MetaMask for an account and a signature over Core's nonce. `nonce` = the answer of
 * POST /core/me/wallets/nonce. Resolves to { address, message, signature }.
 */
export async function signWithBrowserWallet(nonce) {
  if (!hasBrowserWallet()) {
    const err = new Error("MetaMask isn't installed in this browser.");
    err.code = "NO_WALLET";
    throw err;
  }
  const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!address) throw new Error("MetaMask didn't share an account.");
  const chainId = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
  const message = siweMessage({ ...nonce, address, chainId, issuedAt: new Date().toISOString() });
  const signature = await window.ethereum.request({ method: "personal_sign", params: [hex(message), address] });
  return { address: address.toLowerCase(), message, signature };
}

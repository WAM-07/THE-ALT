import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    // `npm run dev` runs a local chain here and deploys the contracts to it.
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
    },
    // A second local chain used by the backend test suites (so tests never touch the dev chain).
    testchain: {
      type: "http",
      url: "http://127.0.0.1:8546",
    },
    // Polygon Amoy testnet. Values come from environment variables or the Hardhat keystore.
    amoy: {
      type: "http",
      chainId: 80002,
      url: configVariable("AMOY_RPC_URL"),
      accounts: [configVariable("AMOY_DEPLOYER_PRIVATE_KEY")],
    },
  },
});

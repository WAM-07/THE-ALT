// Deploys AITRegistry + ALTMarketplace and records the addresses in deployments/<network>.json.
//   npx hardhat run scripts/deploy.ts --network localhost     (npm run dev does this for you)
//   npx hardhat run scripts/deploy.ts --network amoy
// The relayer (ALT Core's minting account) and treasury default to the 2nd and 3rd local accounts;
// on Amoy set ALT_RELAYER_ADDRESS and ALT_TREASURY_ADDRESS, or they default to the deployer.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import { getAddress } from "viem";

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const [deployer, second, third] = await viem.getWalletClients();

const relayer = getAddress(process.env.ALT_RELAYER_ADDRESS ?? second?.account.address ?? deployer.account.address);
const treasury = getAddress(process.env.ALT_TREASURY_ADDRESS ?? third?.account.address ?? deployer.account.address);
const platformFeeBps = BigInt(process.env.ALT_PLATFORM_FEE_BPS ?? "250");

const registry = await viem.deployContract("AITRegistry", [deployer.account.address]);
const grant = await registry.write.grantRole([await registry.read.MINTER_ROLE(), relayer]);
await publicClient.waitForTransactionReceipt({ hash: grant });
const marketplace = await viem.deployContract("ALTMarketplace", [registry.address, treasury, platformFeeBps, deployer.account.address]);

const deployment = {
  network: connection.networkName,
  chainId: await publicClient.getChainId(),
  registry: registry.address,
  marketplace: marketplace.address,
  deployer: deployer.account.address,
  relayer,
  treasury,
  platformFeeBps: Number(platformFeeBps),
  deployedAtBlock: Number(await publicClient.getBlockNumber()),
  deployedAt: new Date().toISOString(),
};

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "deployments");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, `${connection.networkName}.json`), JSON.stringify(deployment, null, 2));
console.log(`ALT_DEPLOYMENT ${JSON.stringify(deployment)}`);

export declare const MIGRATION_SERVICES: string[];

export interface EmbeddedPostgres {
  adminUrl: string;
  urlFor(database: string): string;
  stop(): Promise<void>;
}

export declare function startPostgres(options: {
  dataDir: string;
  port?: number;
  user?: string;
  password?: string;
  quiet?: boolean;
}): Promise<EmbeddedPostgres>;

export declare function ensureDatabase(adminUrl: string, name: string): Promise<void>;
export declare function dropDatabase(adminUrl: string, name: string): Promise<void>;

export declare function runMigrations(
  databaseUrl: string,
  options: { repoRoot: string; services?: string[]; log?: (message: string) => void },
): Promise<string[]>;

export declare function loadDevSecrets(dataDir: string): {
  CORE_JWT_PRIVATE_KEY: string;
  CORE_ENCRYPTION_KEY: string;
  INTERNAL_SERVICE_KEY: string;
};

export declare function loadEnvFile(file: string, target?: Record<string, string | undefined>): Record<string, string>;

export declare const LOCAL_RELAYER_KEY: string;

export interface LocalChain {
  rpcUrl: string;
  deployment: {
    network: string;
    chainId: number;
    registry: string;
    marketplace: string;
    deployer: string;
    relayer: string;
    treasury: string;
    platformFeeBps: number;
    deployedAtBlock: number;
  };
  relayerPrivateKey: string;
  stop(): Promise<void>;
}

export declare function startLocalChain(options: { repoRoot: string; port?: number; network?: string }): Promise<LocalChain>;

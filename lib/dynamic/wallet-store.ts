import { readFile } from "node:fs/promises";

export type StoredWalletMetadata = {
  accountAddress: `0x${string}`;
  walletId?: string;
  chainName?: string;
  thresholdSignatureScheme?: unknown;
  externalServerKeySharesBackupInfo?: unknown;
};

export const readStoredWalletMetadata = async (
  metadataPath: string,
  metadataJson?: string
): Promise<StoredWalletMetadata | null> => {
  if (metadataJson) {
    return JSON.parse(metadataJson) as StoredWalletMetadata;
  }

  try {
    return JSON.parse(await readFile(metadataPath, "utf8")) as StoredWalletMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

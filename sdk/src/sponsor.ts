import { Transaction } from "@mysten/sui/transactions";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export interface SponsoredTxResult {
  digest: string;
}

/**
 * Configures a transaction for gas sponsorship, enabling gasless UX for payers.
 * The sponsor covers gas fees — the payer signs only the transaction payload.
 *
 * Sponsorship flow:
 *   1. Payer builds tx and sets their sender address
 *   2. This function sets the gas owner to the sponsor
 *   3. Both the payer and sponsor sign the serialized tx bytes
 *   4. Both signatures are submitted together
 */
export async function prepareForSponsorship(
  tx: Transaction,
  userAddress: string,
  sponsorAddress: string,
  client: SuiClient
): Promise<Uint8Array> {
  tx.setSender(userAddress);
  tx.setGasOwner(sponsorAddress);
  return await tx.build({ client });
}

/**
 * Sponsor signs and executes a previously built + user-signed sponsored transaction.
 *
 * Both signatures must be over the same transaction bytes using the Sui transaction
 * intent (signTransaction handles the intent prefix; raw keypair.sign does not).
 *
 * @param txBytes   - Serialized transaction bytes from prepareForSponsorship
 * @param userSig   - User's signature from keypair.signTransaction(txBytes)
 * @param sponsor   - Sponsor keypair that covers gas
 * @param client    - SuiClient instance
 */
export async function executeSponsoredTx(
  txBytes: Uint8Array,
  userSig: string,
  sponsor: Ed25519Keypair,
  client: SuiClient
): Promise<SponsoredTxResult> {
  const { signature: sponsorSig } = await sponsor.signTransaction(txBytes);

  const result = await client.executeTransactionBlock({
    transactionBlock: Buffer.from(txBytes).toString("base64"),
    signature: [userSig, sponsorSig],
    options: { showEffects: true },
  });

  return { digest: result.digest };
}

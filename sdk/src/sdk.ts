import { Buffer } from "buffer";
import type { OpenRailsPayloadV1, OpenRailsLink } from "./types.js";

export class OpenRailsSDK {
  /**
   * Encodes an OpenRails payload into a URL-safe Base64 bearer token.
   */
  static serializePayload(payload: OpenRailsPayloadV1 | OpenRailsLink): string {
    const raw = JSON.stringify(payload);
    return Buffer.from(raw, "utf-8")
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  /**
   * Decodes a Base64 token back into a validated OpenRails payload structure.
   */
  static deserializePayload(token: string): OpenRailsLink {
    let normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";

    const decoded = Buffer.from(normalized, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);

    if (!parsed.envelope || !parsed.intent) {
      throw new Error("Invalid token: missing envelope or intent fields.");
    }
    if (!parsed.envelope.signature || !parsed.envelope.payerPublicKey) {
      throw new Error("Invalid token: envelope missing cryptographic fields.");
    }

    return parsed as OpenRailsLink;
  }

  /**
   * Returns true if the token string is a structurally valid OpenRails payload.
   */
  static isValidToken(token: string): boolean {
    try {
      OpenRailsSDK.deserializePayload(token);
      return true;
    } catch {
      return false;
    }
  }
}

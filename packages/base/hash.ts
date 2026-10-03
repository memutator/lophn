import { canonicalize } from "./canonical-json.ts";

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function fingerprint(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

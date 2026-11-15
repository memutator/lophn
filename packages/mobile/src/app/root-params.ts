import type { RemotePairing } from "../remote.ts";

/** The root stack: the frame (sidebar and its stack) and the start flow that pairs a computer. */
export type RootParams = {
  frame: undefined;
  welcome: undefined;
  scan: undefined;
  pairing: { qr: RemotePairing };
  paired: { key: string };
  "pair-failed": { why: "expired" | "unreachable"; qr: RemotePairing };
};

/** What a computer goes by before it is named: the first address it was paired on (as the computer store names it). */
export function nameOf(qr: RemotePairing): string {
  return qr.addresses[0] ?? qr.key.slice(0, 8);
}

import { z } from "zod";

// Stand-in for `packages/protocol/remote/client.ts` (plan phone-remote-web) until it reaches main.
// Same export names, so the swap is one line: `export * from "../../packages/protocol/remote/client.ts";`
export {
  connectRemote,
  REMOTE_FRAME_MAX_BYTES,
  type RemoteClientChannel,
  type RemotePeer,
  type RemoteTransport,
} from "../../packages/protocol/remote/channel.ts";
export {
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientFrame,
  type RemoteHello,
  type RemoteServerFrame,
} from "../../packages/protocol/remote/frames.ts";
export {
  generateKeyPair,
  type KeyPair,
} from "../../packages/protocol/remote/noise.ts";

// On main these live in routes.ts, which pulls the route definitions; client.ts moves them next to frames and noise.
export const REMOTE_PATH = "/remote";

export const remotePairingSchema = z.strictObject({
  addresses: z.array(z.string().min(1)).max(16),
  port: z.number().int().min(1).max(65535),
  key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().min(1).max(128),
});
export type RemotePairing = z.infer<typeof remotePairingSchema>;

export function remoteKeyText(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function remoteKeyBytes(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return undefined;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/") + "=");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

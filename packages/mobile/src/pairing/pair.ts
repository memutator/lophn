import { Dimensions, PixelRatio, Platform } from "react-native";
import { type Dial, openFirst } from "../connection/connection.ts";
import {
  type KeyPair,
  type RemotePairing,
  remotePairingSchema,
} from "../remote.ts";
import type { Computer } from "./store.ts";
import { random } from "./store.ts";

// The QR (or pasted text) is the JSON from the computer's `pairing/start`.
export function parseQr(text: string): RemotePairing | undefined {
  try {
    const parsed = remotePairingSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// What the core shows in its device list and uses for the phone's screen slot.
function thisDevice() {
  const { width, height } = Dimensions.get("screen");
  const constants = Platform.constants as { Model?: string };
  return {
    name: (constants.Model ?? `${Platform.OS} phone`).slice(0, 40),
    os: Platform.OS === "ios" ? ("ios" as const) : ("android" as const),
    width: Math.round(width),
    height: Math.round(height),
    dpr: PixelRatio.get(),
  };
}

// Why pairing failed. Screens say it in words; `refused` carries the core's error code (an expired or used code is `not_found`).
export type PairFailure =
  | { kind: "unreachable" }
  | { kind: "closed" }
  | { kind: "refused"; code: string };

// Connects to the first address (or the relay) that answers and sends `pair` with the one-time code.
export async function pair(
  qr: RemotePairing,
  deps: { phone: KeyPair; dial: Dial },
): Promise<
  { ok: true; computer: Computer } | { ok: false; failure: PairFailure }
> {
  const opened = await openFirst(qr, { ...deps, random });
  if (!opened) return { ok: false, failure: { kind: "unreachable" } };
  const { channel } = opened;
  const answer = new Promise<
    { ok: true; device: string } | { ok: false; failure: PairFailure }
  >((resolve) => {
    channel.onClose(() =>
      resolve({ ok: false, failure: { kind: "closed" } }),
    );
    channel.onFrame((frame) => {
      if (frame.type !== "result" || frame.id !== "pair") return;
      resolve(
        frame.ok
          ? { ok: true, device: (frame.value as { device: string }).device }
          : {
              ok: false,
              failure: { kind: "refused", code: frame.error.code },
            },
      );
    });
  });
  channel.send({ type: "pair", id: "pair", code: qr.code, ...thisDevice() });
  const done = await answer;
  channel.close();
  if (!done.ok) return done;
  return {
    ok: true,
    computer: {
      addresses: qr.addresses,
      port: qr.port,
      key: qr.key,
      relay: qr.relay,
      device: done.device,
      revoked: false,
    },
  };
}

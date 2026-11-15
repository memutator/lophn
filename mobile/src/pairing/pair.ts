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

// Connects to the first address (or the relay) that answers and sends `pair` with the one-time code.
export async function pair(
  qr: RemotePairing,
  deps: { phone: KeyPair; dial: Dial },
): Promise<{ ok: true; computer: Computer } | { ok: false; message: string }> {
  const channel = await openFirst(qr, { ...deps, random });
  if (!channel) return { ok: false, message: "No address answered." };
  const answer = new Promise<
    { ok: true; device: string } | { ok: false; message: string }
  >((resolve) => {
    channel.onClose(() =>
      resolve({ ok: false, message: "The computer closed the connection." }),
    );
    channel.onFrame((frame) => {
      if (frame.type !== "result" || frame.id !== "pair") return;
      resolve(
        frame.ok
          ? { ok: true, device: (frame.value as { device: string }).device }
          : { ok: false, message: frame.error.message },
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

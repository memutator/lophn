import type { Id } from "../protocol/base/ids.ts";
import {
  type RemoteClientFrame,
  type RemotePairing,
  remotePairingSchema,
} from "../protocol/remote/client.ts";
import { devicesUnpair } from "../protocol/remote/routes.ts";
import type { Computer } from "./computers.ts";
import {
  type Client,
  type CoreSource,
  openFirst,
  type Update,
} from "./connection.ts";

// The pairing text (the phone's QR, or pasted) is the JSON from the computer's `pairing/start`.
export function parsePairingText(text: string): RemotePairing | undefined {
  try {
    const parsed = remotePairingSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// Why pairing failed. Screens say it in words; `refused` carries the core's error code (an expired or used code is
// `not_found`); `this_computer` is a pairing text from the machine doing the pairing; `update` is a computer whose
// protocol versions do not meet this app's, with who must update and the computer's name. No pair frame went out then, so
// the same code works again after the update.
export type PairFailure =
  | { kind: "unreachable" }
  | { kind: "update"; update: Update; name: string }
  | { kind: "closed" }
  | { kind: "refused"; code: string }
  | { kind: "this_computer" };

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// What this device tells the computer about itself when it pairs: its kind and what goes with it (a phone's screen, a
// desktop's os). The name is not here: every connection sends it in the hello.
export type PairDevice = Without<
  Extract<RemoteClientFrame, { type: "pair" }>,
  "type" | "id" | "code"
>;

// Connects to the first address (or the relay) that answers and sends `pair` with the one-time code. The computer's
// hello gives its id and name, which the new entry keeps. `self` is this machine's id: a hello that carries it means the
// text came from this machine, and no pair frame is sent.
export async function pair(
  qr: RemotePairing,
  client: Client & { device: PairDevice; self?: Id<"mch"> },
): Promise<
  { ok: true; computer: Computer } | { ok: false; failure: PairFailure }
> {
  const opened = await openFirst(qr, client);
  if (!opened) return { ok: false, failure: { kind: "unreachable" } };
  if (!("channel" in opened)) {
    return { ok: false, failure: { kind: "update", ...opened } };
  }
  const { channel } = opened;
  const { machine } = channel.peer;
  if (client.self !== undefined && machine.id === client.self) {
    channel.close();
    return { ok: false, failure: { kind: "this_computer" } };
  }
  const answer = new Promise<
    { ok: true; device: string } | { ok: false; failure: PairFailure }
  >((resolve) => {
    channel.onClose(() => resolve({ ok: false, failure: { kind: "closed" } }));
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
  channel.send({ type: "pair", id: "pair", code: qr.code, ...client.device });
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
      machine: machine.id,
      announced: machine.name,
      device: done.device,
      revoked: false,
    },
  };
}

// Asks the computer to drop this device from its device list. Settles on the answer or when the computer closes the
// connection (it does so right after, as for any removed device); the device forgets the computer either way. The body
// is the command envelope (protocol `commandRequestSchema`); this package cannot import the renderer's `commandCall`.
// `key` is the idempotency key.
export async function unpair(
  core: Pick<CoreSource, "call">,
  key: string,
): Promise<void> {
  await core.call({
    kind: "command",
    resource: devicesUnpair.resource,
    method: devicesUnpair.method,
    body: { input: {}, idempotency_key: key, compare: {}, prepared: [] },
  });
}

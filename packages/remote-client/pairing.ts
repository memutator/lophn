import type { Id } from "../protocol/base/ids.ts";
import {
  type RemoteClientFrame,
  type RemotePairing,
  remoteKeyBytes,
  remotePairingSchema,
  type RosterEntryBody,
  type RosterInvitedStatement,
  type RosterInviteText,
  rosterInviteTextSchema,
  rosterJoinedSchema,
  type RosterSnapshot,
  type RosterStatement,
  signRoster,
  verifyRoster,
} from "../protocol/remote/client.ts";
import {
  ROSTER_JOIN_STATEMENTS_MAX,
  rosterStatementSchema,
} from "../protocol/remote/roster.ts";
import { devicesUnpair, rosterLeave } from "../protocol/remote/routes.ts";
import type { Computer } from "./computers.ts";
import {
  type Client,
  type CoreSource,
  type Joined,
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

// The invite text (the QR, or pasted) is the JSON from a computer's `roster/invite`.
export function parseInviteText(text: string): RosterInviteText | undefined {
  try {
    const parsed = rosterInviteTextSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// Why joining failed. `refused` carries the computer's error code and `details.reason` (expired, used, removed, …) and, when
// this device's key was removed, the removal statement for the caller to check against its roots. `untrusted` is an invite
// whose issuer or signature does not check out, found before dialling; `wrong_kind` an invite for another kind of device.
export type JoinFailure =
  | { kind: "unreachable" }
  | { kind: "update"; update: Update; name: string }
  | { kind: "closed" }
  | {
      kind: "refused";
      code: string;
      reason?: string;
      removal?: RosterStatement;
    }
  | { kind: "this_computer" }
  | { kind: "untrusted" }
  | { kind: "wrong_kind" };

// This device's entry before the invite fills `invite` and `terminal_input`. Its id and rev are the caller's: the id it
// already has in the roster with the next rev (so one device never gets two ids), else a new `dev_` id and rev 1.
export type JoinEntry = Omit<
  RosterEntryBody,
  "type" | "invite" | "terminal_input"
>;

export type JoinResult =
  | {
      ok: true;
      joined: Joined & { roster: RosterSnapshot };
      issuer: RosterInviteText["issuer"];
    }
  | { ok: false; failure: JoinFailure };

// Joins the roster with an invite: checks the issuer's self-signed entry and the invite's signature, signs this device's
// entry with the invite's one-time key, connects to the issuer and sends `join` with that statement and the statements
// about this device it already holds. `self` is this machine's id: an invite from this machine is refused before dialling.
export async function join(
  text: RosterInviteText,
  client: Client & {
    entry: JoinEntry;
    statements?: RosterStatement[];
    self?: Id<"mch">;
  },
): Promise<JoinResult> {
  const { invite, issuer, reach, secret } = text;
  const signer = issuer.body.type === "entry" ? issuer.body : undefined;
  const secretKey = remoteKeyBytes(secret);
  if (
    signer === undefined ||
    signer.kind !== "computer" ||
    signer.signing_key === null ||
    signer.machine === null ||
    issuer.by !== signer.id ||
    invite.body.by !== signer.id ||
    secretKey === undefined ||
    !verifyRoster(signer, issuer.signature, signer.signing_key) ||
    !verifyRoster(invite.body, invite.signature, signer.signing_key)
  ) {
    return { ok: false, failure: { kind: "untrusted" } };
  }
  if (invite.body.kind !== client.entry.kind) {
    return { ok: false, failure: { kind: "wrong_kind" } };
  }
  if (client.self !== undefined && signer.machine === client.self) {
    return { ok: false, failure: { kind: "this_computer" } };
  }
  const body: RosterEntryBody = {
    type: "entry",
    ...client.entry,
    terminal_input: invite.body.terminal_input,
    invite: invite.body.key,
  };
  const invited: RosterInvitedStatement = {
    body,
    invite,
    signature: signRoster(body, secretKey),
  };
  const opened = await openFirst(
    {
      addresses: reach.addresses,
      port: reach.port,
      key: signer.key,
      ...(reach.relay === null ? {} : { relay: reach.relay }),
      machine: signer.machine as Id<"mch">,
    },
    client,
  );
  if (!opened) return { ok: false, failure: { kind: "unreachable" } };
  if (!("channel" in opened)) {
    return { ok: false, failure: { kind: "update", ...opened } };
  }
  const { channel } = opened;
  const answer = new Promise<JoinResult>((resolve) => {
    channel.onClose(() => resolve({ ok: false, failure: { kind: "closed" } }));
    channel.onFrame((frame) => {
      if (frame.type !== "result" || frame.id !== "join") return;
      if (!frame.ok) {
        const details = frame.error.details ?? {};
        const removal = rosterStatementSchema.safeParse(details.removal);
        resolve({
          ok: false,
          failure: {
            kind: "refused",
            code: frame.error.code,
            ...(typeof details.reason === "string"
              ? { reason: details.reason }
              : {}),
            ...(removal.success ? { removal: removal.data } : {}),
          },
        });
        return;
      }
      const value = rosterJoinedSchema.safeParse(frame.value);
      resolve(
        value.success
          ? { ok: true, joined: value.data, issuer }
          : { ok: false, failure: { kind: "closed" } },
      );
    });
  });
  channel.send({
    type: "join",
    id: "join",
    statements: [
      invited,
      ...(client.statements ?? []).slice(0, ROSTER_JOIN_STATEMENTS_MAX - 1),
    ],
  });
  const done = await answer;
  channel.close();
  return done;
}

// Takes this device off the roster (`roster/leave`): the computer signs the removal and every other computer hears it.
// The body is the memory call body; settles on the answer or when the computer closes the connection.
export async function leave(core: Pick<CoreSource, "call">): Promise<void> {
  await core.call({
    kind: "memory",
    resource: rosterLeave.resource,
    method: rosterLeave.method,
    body: {},
  });
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

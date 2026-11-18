import { ed25519 } from "@noble/curves/ed25519.js";
import { z } from "zod";
import {
  canonicalize,
  err,
  type LophnError,
  ok,
  type RandomSource,
  type Result,
} from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { machineIdSchema } from "../machine/mod.ts";
import { type KeyPair, remoteKeyText } from "./noise.ts";

// 내 기기 명단: 서명한 항목·빼기·초대장과, 믿음과 합치기를 계산하는 순수 함수. 폰의 JavaScript engine에서도
// 같은 code가 돌아 Node 내장 module과 Buffer를 쓰지 않는다(noise.ts와 같다). 설계는 architecture `remote.md`의 "명단".

// 서명하는 bytes의 앞머리. 다른 용도의 Ed25519 서명이 명단 서명으로 읽히지 않게 한다.
export const ROSTER_SIGN_CONTEXT = "lophn-roster/1";
export const ROSTER_INVITE_SHORT_MS = 1_800_000;
// 새 기기가 초대한 컴퓨터와 같은 때 켜질 수 없을 때(dual boot, 집과 직장) 사람이 고른다.
export const ROSTER_INVITE_LONG_MS = 604_800_000;
export const ROSTER_STATEMENTS_MAX = 4096;
export const ROSTER_JOIN_STATEMENTS_MAX = 8;
// 붙기 전 연결이 받는 frame 상한. 아직 누구인지 모르는 쪽이 메모리를 정하지 못하게 한다.
export const ROSTER_JOIN_MAX_BYTES = 16 * 1024;

// 공개 key의 글자 꼴(base64url, 32 bytes). `remoteKeyText`가 만든 글자만 받는다: 끝 글자의 남는 bit가 0이 아닌
// 다른 글자도 같은 bytes로 읽히는데, 빼기와 "이미 쓰인 초대장"이 key를 글자로 견주므로 한 key가 두 글자를 가지면 안 된다.
export const keyTextSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);

// 붙는 쪽이 `ws://<address>:<port>/remote`로 거는 주소 후보(IP나 domain, port 없이). QR과 core hello가 싣는다.
export const remoteAddressesSchema = z
  .array(z.string().min(1).max(253))
  .max(16);

// 기기의 이름. 명단 항목에 있고 명단 전체에서 하나다.
export const deviceNameSchema = z.string().min(1).max(64);

const deviceIdSchema = idSchema("dev");

// Ed25519 서명 64 bytes의 base64url. 키와 같은 까닭으로 끝 글자를 하나로 정한다.
export const signatureTextSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{85}[AQgw]$/);

export const rosterKindSchema = z.enum(["computer", "phone"]);

const COMPUTER_OS = ["linux", "macos", "windows"];
const PHONE_OS = ["ios", "android"];

// 기기 하나. `key`는 Noise static key(컴퓨터는 host key, 폰은 기기 key)이고 기기를 가리키는 것은 이 key다.
// `invite`는 그 기기가 들어온 초대장의 key다(컴퓨터가 스스로 만든 항목과 옮긴 항목은 null).
export const rosterEntryBodySchema = z
  .strictObject({
    type: z.literal("entry"),
    id: deviceIdSchema,
    kind: rosterKindSchema,
    key: keyTextSchema,
    signing_key: keyTextSchema.nullable(),
    machine: machineIdSchema.nullable(),
    name: deviceNameSchema,
    os: z.enum(["ios", "android", "linux", "macos", "windows"]),
    terminal_input: z.boolean(),
    rev: z.number().int().min(1),
    invite: keyTextSchema.nullable(),
  })
  .refine(
    (body) =>
      body.kind === "computer"
        ? body.signing_key !== null &&
          body.machine !== null &&
          COMPUTER_OS.includes(body.os)
        : body.signing_key === null &&
          body.machine === null &&
          PHONE_OS.includes(body.os),
    { message: "computer and phone fields do not match the kind" },
  );
export type RosterEntryBody = z.infer<typeof rosterEntryBodySchema>;

export const rosterRemovalBodySchema = z.strictObject({
  type: z.literal("removal"),
  id: deviceIdSchema,
  key: keyTextSchema,
  at: atSchema,
});
export type RosterRemovalBody = z.infer<typeof rosterRemovalBodySchema>;

// `by`는 서명한 컴퓨터의 id다.
export const rosterSignedStatementSchema = z.strictObject({
  body: z.discriminatedUnion("type", [
    rosterEntryBodySchema,
    rosterRemovalBodySchema,
  ]),
  by: deviceIdSchema,
  signature: signatureTextSchema,
});
export type RosterSignedStatement = z.infer<typeof rosterSignedStatementSchema>;

// `key`는 한 번 쓸 Ed25519 공개 key다. 초대한 컴퓨터(`by`)의 서명 key로 서명한다.
export const rosterInviteBodySchema = z.strictObject({
  type: z.literal("invite"),
  key: keyTextSchema,
  by: deviceIdSchema,
  terminal_input: z.boolean(),
  expires_at: atSchema,
});
export type RosterInviteBody = z.infer<typeof rosterInviteBodySchema>;

export const rosterInviteSchema = z.strictObject({
  body: rosterInviteBodySchema,
  signature: signatureTextSchema,
});
export type RosterInvite = z.infer<typeof rosterInviteSchema>;

// 새 기기가 초대장의 key로 스스로 서명한 자기 항목. 믿음 계산에 쓰지 않는다: 검증하는 컴퓨터가 닿은 때
// `checkInvited`로 한 번 보고 자기 key로 다시 서명한 것이 퍼진다.
export const rosterInvitedStatementSchema = z.strictObject({
  body: rosterEntryBodySchema,
  invite: rosterInviteSchema,
  signature: signatureTextSchema,
});
export type RosterInvitedStatement = z.infer<
  typeof rosterInvitedStatementSchema
>;

export const rosterStatementSchema = z.union([
  rosterSignedStatementSchema,
  rosterInvitedStatementSchema,
]);
export type RosterStatement = z.infer<typeof rosterStatementSchema>;

// 서명하지 않는다. 틀린 주소는 Noise가 key로 막아 못 닿을 뿐이고, 주소는 자주 바뀐다.
export const rosterReachSchema = z.strictObject({
  device: deviceIdSchema,
  addresses: remoteAddressesSchema,
  port: z.number().int().min(1).max(65535),
  relay: z.string().url().nullable(),
});
export type RosterReach = z.infer<typeof rosterReachSchema>;

export const rosterSnapshotSchema = z.strictObject({
  statements: z.array(rosterStatementSchema).max(ROSTER_STATEMENTS_MAX),
  reach: z.array(rosterReachSchema).max(256),
});
export type RosterSnapshot = z.infer<typeof rosterSnapshotSchema>;

// QR과 CLI가 싣는 글의 JSON. `secret`은 한 번 쓸 key의 비밀 32 bytes이고, `issuer`는 초대한 컴퓨터의 자기 서명 항목이다.
export const rosterInviteTextSchema = z.strictObject({
  invite: rosterInviteSchema,
  secret: keyTextSchema,
  issuer: rosterSignedStatementSchema,
  reach: rosterReachSchema,
});
export type RosterInviteText = z.infer<typeof rosterInviteTextSchema>;

// `join`의 답 value.
export const rosterJoinedSchema = z.strictObject({
  device: deviceIdSchema,
  roster: rosterSnapshotSchema,
});

type SignedBody = RosterEntryBody | RosterRemovalBody | RosterInviteBody;

const encoder = new TextEncoder();

function message(bodyText: string): Uint8Array {
  return encoder.encode(`${ROSTER_SIGN_CONTEXT}\n${bodyText}`);
}

// base64url(패딩 없음) 글자를 bytes로. 꼴은 schema가 이미 보았다.
function bytesOf(text: string): Uint8Array {
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function generateSigningKey(random: RandomSource): KeyPair {
  const secretKey = new Uint8Array(32);
  random.fill(secretKey);
  return { publicKey: ed25519.getPublicKey(secretKey), secretKey };
}

export function signRoster(body: SignedBody, secretKey: Uint8Array): string {
  return remoteKeyText(ed25519.sign(message(canonicalize(body)), secretKey));
}

function verifyText(
  bodyText: string,
  signature: string,
  signingKey: string,
): boolean {
  try {
    return ed25519.verify(
      bytesOf(signature),
      message(bodyText),
      bytesOf(signingKey),
    );
  } catch {
    // 곡선 위의 점이 아닌 key 같은 틀린 입력은 던진다. 서명이 맞지 않는 것과 같다.
    return false;
  }
}

export function verifyRoster(
  body: SignedBody,
  signature: string,
  signingKey: string,
): boolean {
  return verifyText(canonicalize(body), signature, signingKey);
}

type Item = { statement: RosterStatement; text: string; bodyText: string };

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 같은 statement(canonical 글이 같은 것)는 하나로 두고 canonical 글 순서로 줄 세운다. 어느 순서로 받아도 같은 배열이다.
function itemsOf(statements: readonly RosterStatement[]): Item[] {
  const byText = new Map<string, Item>();
  for (const statement of statements) {
    const text = canonicalize(statement);
    if (!byText.has(text)) {
      byText.set(text, {
        statement,
        text,
        bodyText: canonicalize(statement.body),
      });
    }
  }
  return [...byText.values()].sort((a, b) => compare(a.text, b.text));
}

export function mergeRoster(
  ...lists: (readonly RosterStatement[])[]
): RosterStatement[] {
  return itemsOf(lists.flat()).map((item) => item.statement);
}

function isSigned(
  statement: RosterStatement,
): statement is RosterSignedStatement {
  return "by" in statement;
}

type Verify = (item: Item, signingKey: string) => boolean;

// 한 번 계산하는 동안 같은 (statement, key)를 두 번 검증하지 않는다. 폰의 engine에서 Ed25519 검증은 느리고
// 믿음 계산은 두 번 돈다.
function verifier(): Verify {
  const seen = new Map<string, boolean>();
  return (item, signingKey) => {
    const key = `${signingKey}\n${item.text}`;
    let valid = seen.get(key);
    if (valid === undefined) {
      const { signature } = item.statement as RosterSignedStatement;
      valid = verifyText(item.bodyText, signature, signingKey);
      seen.set(key, valid);
    }
    return valid;
  };
}

type Trust = { accepted: Set<Item>; signers: Map<string, string[]> };

// 규칙 1·2: root의 자기 서명 항목에서 시작해 믿는 컴퓨터의 서명을 따라 더 늘지 않을 때까지 넓힌다.
// removed의 key는 항목도, 서명자도, root도 되지 못한다. root를 host key가 아니라 서명 key로 잡는 것은 host key(X25519)가
// 서명하지 못해서다: host key로 잡으면 누구나 "이 host key, 내 서명 key"인 항목을 스스로 서명해 root 행세를 한다.
function trust(
  items: readonly Item[],
  roots: ReadonlySet<string>,
  removed: ReadonlySet<string>,
  verify: Verify,
): Trust {
  const accepted = new Set<Item>();
  const signers = new Map<string, string[]>();
  const signed = items.filter((item) => {
    const { statement } = item;
    if (!isSigned(statement)) return false;
    return !(
      statement.body.type === "entry" && removed.has(statement.body.key)
    );
  });
  const accept = (item: Item) => {
    accepted.add(item);
    const { body } = item.statement;
    if (body.type === "entry" && body.signing_key !== null) {
      signers.set(body.id, [...(signers.get(body.id) ?? []), body.signing_key]);
    }
  };
  for (const item of signed) {
    const { body, by } = item.statement as RosterSignedStatement;
    if (
      body.type === "entry" &&
      body.signing_key !== null &&
      roots.has(body.signing_key) &&
      by === body.id &&
      verify(item, body.signing_key)
    ) {
      accept(item);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of signed) {
      if (accepted.has(item)) continue;
      const keys = signers.get((item.statement as RosterSignedStatement).by);
      if (keys?.some((key) => verify(item, key))) {
        accept(item);
        grew = true;
      }
    }
  }
  return { accepted, signers };
}

export type RosterDevice = {
  // 이긴 항목. id는 접힌 id다.
  body: RosterEntryBody;
  // 이 body 그대로에 서명한 컴퓨터의 id. 접혀 id가 바뀐 body는 아직 아무도 서명하지 않았으면 비었다.
  signed_by: string[];
};

export type RosterView = {
  devices: RosterDevice[];
  removed: { id: string; key: string; at: string; by: string }[];
  folded: { from: string; to: string }[];
  keep: RosterStatement[];
};

type Pick = { key: string; id: string; winner: Item; items: Item[] };

function entryOf(item: Item): RosterEntryBody {
  return item.statement.body as RosterEntryBody;
}

// roots는 믿음이 시작하는 컴퓨터의 서명 key다(컴퓨터는 자기 것 하나, 폰은 저장한 컴퓨터의 것들. 폰은 초대장의 issuer와
// 명단에서 믿은 컴퓨터 항목에서 배운다).
// 결과는 statements의 집합만으로 정해진다: 들어온 순서와 시각을 보지 않는다.
export function rosterView(
  statements: readonly RosterStatement[],
  roots: readonly string[],
): RosterView {
  const all = itemsOf(statements);
  const rootSet = new Set(roots);
  const verify = verifier();

  // 규칙 3: 빼기는 빼기를 모르는 채 넓힌 믿음(T0)으로 모은다. 그래서 서명자가 나중에 빠져도 빼기는 남는다.
  const first = trust(all, rootSet, new Set(), verify);
  const removals = all.filter(
    (item) =>
      first.accepted.has(item) && item.statement.body.type === "removal",
  );
  const removedKeys = new Set(
    removals.map((item) => (item.statement.body as RosterRemovalBody).key),
  );
  const removedIds = new Set(
    removals.map((item) => (item.statement.body as RosterRemovalBody).id),
  );

  // 규칙 4: 뺀 key를 빼고 다시 넓힌다. 늦게 온 항목도 뺀 key를 되살리지 못한다.
  const second = trust(all, rootSet, removedKeys, verify);

  // 규칙 5: key마다 (rev, body 글)이 가장 작은 항목이 kind·signing_key·machine을 정하고, 다른 항목은 버린다.
  const byKey = new Map<string, Item[]>();
  for (const item of all) {
    if (!second.accepted.has(item) || item.statement.body.type !== "entry") {
      continue;
    }
    const key = item.statement.body.key;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const picks: Pick[] = [];
  for (const [key, list] of byKey) {
    const ordered = [...list].sort(
      (a, b) =>
        entryOf(a).rev - entryOf(b).rev || compare(a.bodyText, b.bodyText),
    );
    const base = entryOf(ordered[0] as Item);
    const items = ordered.filter((item) => {
      const body = entryOf(item);
      return (
        body.kind === base.kind &&
        body.signing_key === base.signing_key &&
        body.machine === base.machine
      );
    });
    const top = Math.max(...items.map((item) => entryOf(item).rev));
    const winner = items.find((item) => entryOf(item).rev === top) as Item;
    // 규칙 6: 같은 key의 여러 id(컴퓨터마다 따로 만든 dev_)는 가장 작은 id 하나로 접는다.
    const id = items.map((item) => entryOf(item).id).sort(compare)[0] as string;
    picks.push({ key, id, winner, items });
  }
  // 규칙 6: 다른 key가 같은 id를 가지면 key가 작은 쪽만 남는다.
  const owners = new Map<string, Pick>();
  for (const pick of picks) {
    const other = owners.get(pick.id);
    if (other === undefined || pick.key < other.key) owners.set(pick.id, pick);
  }
  const kept = [...owners.values()].sort((a, b) => compare(a.id, b.id));
  const trustedKeys = new Set(kept.map((pick) => pick.key));

  const devices = kept.map((pick): RosterDevice => {
    const body = { ...entryOf(pick.winner), id: pick.id };
    const text = canonicalize(body);
    const signedBy = pick.items
      .filter((item) => item.bodyText === text)
      .map((item) => (item.statement as RosterSignedStatement).by);
    return { body, signed_by: [...new Set(signedBy)].sort(compare) };
  });
  const folded = kept
    .flatMap((pick) =>
      [...new Set(pick.items.map((item) => entryOf(item).id))]
        .filter((id) => id !== pick.id)
        .map((from) => ({ from, to: pick.id })),
    )
    .sort((a, b) => compare(a.from, b.from));
  const removed: RosterView["removed"] = [];
  for (const item of removals) {
    const { body, by } = item.statement as RosterSignedStatement;
    const removal = body as RosterRemovalBody;
    if (removed.some((r) => r.key === removal.key)) continue;
    removed.push({ id: removal.id, key: removal.key, at: removal.at, by });
  }

  // 저장하고 보낼 것: 빼기, 남은 key마다 이긴 항목, 아직 판단할 수 없는 것. 빠진 것과 진 것은 버린다.
  const winners = new Set(kept.map((pick) => pick.winner.bodyText));
  const keep = all
    .filter((item) => {
      const { statement } = item;
      if (!isSigned(statement)) {
        const { key } = statement.body;
        return !trustedKeys.has(key) && !removedKeys.has(key);
      }
      if (first.accepted.has(item) || second.accepted.has(item)) {
        if (statement.body.type === "removal") return true;
        return (
          second.accepted.has(item) &&
          trustedKeys.has(statement.body.key) &&
          winners.has(item.bodyText)
        );
      }
      // 믿는 서명자의 id인데 서명이 맞지 않으면 틀린 statement다. 모르는 서명자의 것은 나중에 믿게 될 수 있어 남긴다.
      if (removedIds.has(statement.by) || second.signers.has(statement.by)) {
        return false;
      }
      return !(
        statement.body.type === "entry" && removedKeys.has(statement.body.key)
      );
    })
    .map((item) => item.statement);

  return { devices, removed, folded, keep };
}

export type InviteCheck = {
  // 검증하는 컴퓨터의 지금(ms).
  now: number;
  // 믿는 컴퓨터의 서명 key. 모르거나 믿지 않으면 undefined.
  signer: (id: string) => string | undefined;
  // 그 초대 key로 이미 든 기기의 key.
  usedBy: (invite: string) => string | undefined;
  removed: (key: string) => boolean;
};

function refused(
  code: LophnError["code"],
  reason: "untrusted" | "expired" | "used" | "removed",
): Result<never> {
  return err({
    code,
    message: `roster invite refused: ${reason}`,
    details: { reason },
  });
}

// 초대 서명 statement가 검증하는 컴퓨터에 닿을 때(`join`, `roster` frame, 어느 쪽으로 왔든) 한 번 부른다.
// 맞으면 그 컴퓨터가 돌려받은 항목에 자기 key로 서명해 둔다. 수명은 여기서만 본다.
export function checkInvited(
  statement: RosterInvitedStatement,
  input: InviteCheck,
): Result<RosterEntryBody> {
  const { body, invite, signature } = statement;
  const issuer = input.signer(invite.body.by);
  if (
    issuer === undefined ||
    !verifyRoster(invite.body, invite.signature, issuer) ||
    !verifyRoster(body, signature, invite.body.key) ||
    body.invite !== invite.body.key ||
    body.terminal_input !== invite.body.terminal_input
  ) {
    return refused("unauthorized", "untrusted");
  }
  // 뺀 기기가 수명이 남은 초대장을 다시 내도 "새 초대장을 받아라"가 아니라 "key를 버려라"를 알게 한다.
  if (input.removed(body.key)) return refused("unauthorized", "removed");
  if (input.now > Date.parse(invite.body.expires_at)) {
    return refused("unauthorized", "expired");
  }
  const used = input.usedBy(invite.body.key);
  if (used !== undefined && used !== body.key) {
    return refused("conflict", "used");
  }
  return ok(body);
}

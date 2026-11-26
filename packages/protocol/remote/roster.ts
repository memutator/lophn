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
// keep이 남기는 믿음에 들지 않은 statement(모르는 서명자, 모르는 초대장)의 상한. 붙은 기기 하나가 저장소를
// `ROSTER_STATEMENTS_MAX`까지 채워 빼기와 믿는 항목이 저장되지 못하게 하지 못한다.
export const ROSTER_UNKNOWN_MAX = 512;
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
    // 옛 판이 서명한 statement에만 있다(서명한 bytes라 검증에 필요하다). 새 statement는 싣지 않고 아무도 허락으로 읽지 않는다:
    // 터미널 입력 허락은 받는 컴퓨터의 ledger에 있다(`core/remote/grants.ts`). 옮기기 한 자리만 읽는다.
    terminal_input: z.boolean().optional(),
    rev: z.number().int().min(1),
    invite: keyTextSchema.nullable(),
  })
  .refine(
    (body) =>
      body.kind === "computer"
        ? body.signing_key !== null &&
          body.machine !== null &&
          COMPUTER_OS.includes(body.os)
        : body.machine === null && PHONE_OS.includes(body.os),
    { message: "computer and phone fields do not match the kind" },
  );
export type RosterEntryBody = z.infer<typeof rosterEntryBodySchema>;

// 컴퓨터를 빼면 `signing_key`에 그 서명 key를 싣는다(폰은 null). 뺀 서명 key는 root도 서명자도 어느 항목의 서명 key도
// 되지 못한다: host key만 빼면 같은 서명 key로 새 host key의 항목을 만들어 돌아온다. 빼기는 `key`와 `signing_key`만
// 뺀다. `id`는 서명자가 아무 값이나 달 수 있어 보지 않는다(이미 저장한 빼기의 서명이 덮으므로 칸은 남긴다).
export const rosterRemovalBodySchema = z.strictObject({
  type: z.literal("removal"),
  id: deviceIdSchema,
  key: keyTextSchema,
  signing_key: keyTextSchema.nullable(),
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

// `key`는 한 번 쓸 Ed25519 공개 key다. 초대한 컴퓨터(`by`)의 서명 key로 서명한다. `kind`는 사람이 고른 들일 기기의
// 종류다: 폰 초대장이 새어도 서명자(컴퓨터)가 들지 못한다. `terminal_input`은 초대한 컴퓨터가 그 초대로 든 기기를 받아들일 때
// 자기 표에 적는 값이다(항목에는 실리지 않고 다른 컴퓨터는 읽지 않는다).
export const rosterInviteBodySchema = z.strictObject({
  type: z.literal("invite"),
  key: keyTextSchema,
  by: deviceIdSchema,
  kind: rosterKindSchema,
  terminal_input: z.boolean(),
  expires_at: atSchema,
});
export type RosterInviteBody = z.infer<typeof rosterInviteBodySchema>;

export const rosterInviteSchema = z.strictObject({
  body: rosterInviteBodySchema,
  signature: signatureTextSchema,
});

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
  hub: z.boolean().optional(),
  relays: z.array(z.string().url()).optional(),
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

// `join`의 답 value. `computer`는 답한 컴퓨터의 id와 서명 key다. 붙는 쪽은 Noise로 확인한 host key의 컴퓨터가 낸 값이라
// 이 서명 key를 root로 삼는다(host key만 저장한 옮긴 폰이 서명 key를 배우는 길). 모든 연결의 첫 frame이 `join`이라
// hello나 `roster` 답에는 싣지 않는다.
export const rosterJoinedSchema = z.strictObject({
  device: deviceIdSchema,
  computer: z.strictObject({
    id: deviceIdSchema,
    signing_key: keyTextSchema,
  }),
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

export function signDetached(
  context: string,
  bodyText: string,
  secretKey: Uint8Array,
): string {
  return remoteKeyText(
    ed25519.sign(encoder.encode(`${context}\n${bodyText}`), secretKey),
  );
}

export function verifyDetached(
  context: string,
  bodyText: string,
  signature: string,
  signingKey: string,
): boolean {
  if (!signatureTextSchema.safeParse(signature).success) return false;
  if (!keyTextSchema.safeParse(signingKey).success) return false;
  try {
    return ed25519.verify(
      bytesOf(signature),
      encoder.encode(`${context}\n${bodyText}`),
      bytesOf(signingKey),
    );
  } catch {
    return false;
  }
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

function signedOf(item: Item): RosterSignedStatement {
  return item.statement as RosterSignedStatement;
}

function entryOf(item: Item): RosterEntryBody {
  return item.statement.body as RosterEntryBody;
}

// 같은 key의 항목 가운데 앞서는 것: rev가 큰 것, 같으면 body canonical 글이 작은 것. 같은 rev에서 글은 id가 맨 앞이라
// 작은 id의 body가 앞선다(접힌 id가 굳는 까닭).
function ahead(a: Item, b: Item): number {
  return entryOf(b).rev - entryOf(a).rev || compare(a.bodyText, b.bodyText);
}

type Verify = (item: Item, signingKey: string) => boolean;

// 한 번 계산하는 동안 같은 (statement, key)를 두 번 검증하지 않는다. 폰의 engine에서 Ed25519 검증은 느리고
// 믿음 계산은 여러 번 돈다.
function verifier(): Verify {
  const seen = new Map<string, boolean>();
  return (item, signingKey) => {
    const key = `${signingKey}\n${item.text}`;
    let valid = seen.get(key);
    if (valid === undefined) {
      const { signature } = item.statement as { signature: string };
      valid = verifyText(item.bodyText, signature, signingKey);
      seen.set(key, valid);
    }
    return valid;
  };
}

// 믿음 계산에서 빼는 것. key는 host key(폰은 기기 key), signing은 서명 key다.
type Excluded = { keys: Set<string>; signing: Set<string> };

function excluded(body: RosterEntryBody, out: Excluded): boolean {
  return (
    out.keys.has(body.key) ||
    (body.signing_key !== null && out.signing.has(body.signing_key))
  );
}

type Trust = {
  accepted: Set<Item>;
  // id → 그 id로 서명하는 믿는 서명 key들.
  signers: Map<string, string[]>;
  // 받아들인 statement를 맞춘 서명 key.
  signedWith: Map<Item, string>;
  // root가 스스로 서명한 항목의 key. 충돌에서 빠지지 않는다.
  rootKeys: Set<string>;
};

// 규칙 1·2: root의 자기 서명 항목에서 시작해 믿는 컴퓨터의 서명을 따라 더 늘지 않을 때까지 넓힌다.
// root를 host key가 아니라 서명 key로 잡는 것은 host key(X25519)가 서명하지 못해서다: host key로 잡으면 누구나
// "이 host key, 내 서명 key"인 항목을 스스로 서명해 root 행세를 한다. 같은 까닭으로 root의 key에 다른 서명 key를 단 항목은 쓰지 않는다.
function trust(
  items: readonly Item[],
  roots: ReadonlySet<string>,
  out: Excluded,
  verify: Verify,
): Trust {
  const accepted = new Set<Item>();
  const signers = new Map<string, string[]>();
  const signedWith = new Map<Item, string>();
  const rootKeys = new Set<string>();
  const signed = items.filter((item) => {
    const { statement } = item;
    if (!isSigned(statement)) return false;
    return !(statement.body.type === "entry" && excluded(statement.body, out));
  });
  const accept = (item: Item, signingKey: string) => {
    accepted.add(item);
    signedWith.set(item, signingKey);
    const { body } = item.statement;
    if (
      body.type === "entry" &&
      body.kind === "computer" &&
      body.signing_key !== null
    ) {
      signers.set(body.id, [...(signers.get(body.id) ?? []), body.signing_key]);
    }
  };
  for (const item of signed) {
    const { body, by } = signedOf(item);
    if (
      body.type === "entry" &&
      body.signing_key !== null &&
      roots.has(body.signing_key) &&
      by === body.id &&
      verify(item, body.signing_key)
    ) {
      accept(item, body.signing_key);
      rootKeys.add(body.key);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of signed) {
      if (accepted.has(item)) continue;
      const { body, by } = signedOf(item);
      if (
        body.type === "entry" &&
        rootKeys.has(body.key) &&
        !(body.signing_key !== null && roots.has(body.signing_key))
      ) {
        continue;
      }
      const key = signers.get(by)?.find((k) => verify(item, k));
      if (key !== undefined) {
        accept(item, key);
        grew = true;
      }
    }
  }
  return { accepted, signers, signedWith, rootKeys };
}

export type RosterConflict = {
  key: string;
  ids: string[];
  // id: 다른 key가 같은 id. signing_key: 한 서명 key에 host key 둘, 또는 한 host key에 서명 key 둘. shape: 한 key의
  // kind·machine이 항목마다 다름. invite: 한 초대장으로 다른 key 둘.
  reason: "id" | "signing_key" | "shape" | "invite";
};

// 믿는 항목끼리 부딪는 key를 찾는다. 어느 쪽이 맞는지 모르므로 둘 다 뺀다(root의 자기 key만 남긴다).
function conflictsOf(t: Trust): Map<string, RosterConflict> {
  const entries = [...t.accepted].filter(
    (item) => item.statement.body.type === "entry",
  );
  const found = new Map<string, RosterConflict>();
  const flag = (key: string, reason: RosterConflict["reason"]) => {
    if (t.rootKeys.has(key) || found.has(key)) return;
    const ids = entries
      .filter((item) => entryOf(item).key === key)
      .map((item) => entryOf(item).id);
    found.set(key, { key, ids: [...new Set(ids)].sort(compare), reason });
  };
  const groups = (field: (body: RosterEntryBody) => string | null) => {
    const map = new Map<string, Set<string>>();
    for (const item of entries) {
      const value = field(entryOf(item));
      if (value === null) continue;
      map.set(value, (map.get(value) ?? new Set()).add(entryOf(item).key));
    }
    return [...map.values()].filter((keys) => keys.size > 1);
  };
  const shapes = new Map<string, Set<string>>();
  const signings = new Map<string, Set<string>>();
  for (const item of entries) {
    const body = entryOf(item);
    shapes.set(
      body.key,
      (shapes.get(body.key) ?? new Set()).add(`${body.kind} ${body.machine}`),
    );
    signings.set(
      body.key,
      (signings.get(body.key) ?? new Set()).add(String(body.signing_key)),
    );
  }
  for (const [key, set] of signings) if (set.size > 1) flag(key, "signing_key");
  for (const keys of groups((body) => body.signing_key)) {
    for (const key of keys) flag(key, "signing_key");
  }
  for (const [key, set] of shapes) if (set.size > 1) flag(key, "shape");
  for (const keys of groups((body) => body.id)) {
    for (const key of keys) flag(key, "id");
  }
  for (const keys of groups((body) => body.invite)) {
    for (const key of keys) flag(key, "invite");
  }
  return found;
}

// 충돌한 key를 빼고 다시 넓히기를 더 빠지는 것이 없을 때까지 한다. 빼는 것만 늘어 끝난다.
function settle(
  items: readonly Item[],
  roots: ReadonlySet<string>,
  removed: Excluded,
  verify: Verify,
): { t: Trust; conflicts: Map<string, RosterConflict> } {
  const conflicts = new Map<string, RosterConflict>();
  for (;;) {
    const t = trust(
      items,
      roots,
      {
        keys: new Set([...removed.keys, ...conflicts.keys()]),
        signing: removed.signing,
      },
      verify,
    );
    const found = [...conflictsOf(t).values()].filter(
      (c) => !conflicts.has(c.key),
    );
    if (found.length === 0) return { t, conflicts };
    for (const c of found) conflicts.set(c.key, c);
  }
}

export type RosterDevice = {
  // 이긴 항목. id는 접힌 id다.
  body: RosterEntryBody;
  // 이 body 그대로에 서명한 컴퓨터의 id. 접혀 id가 바뀐 body는 아직 아무도 서명하지 않았으면 비었다.
  signed_by: string[];
  // 그 기기의 믿는 항목(어느 rev든)이 모두 그 기기 자신의 서명뿐이다. 다른 컴퓨터가 아직 받아들이지 않았다.
  pending: boolean;
};

export type RosterView = {
  devices: RosterDevice[];
  // 효력이 있는 빼기. 뺀 key마다 하나(canonical 글이 앞선 body)다. `settled`(IN)인 것만 컴퓨터가 같이 서명한다.
  // 정해지지 않은 것(서로 물고 도는 빼기)은 대상을 빼되(fail-closed) 서명하지 않는다: 아무도 빼지 않은 서명자의
  // 서명이 붙으면 IN이 되어 퍼진다. 사람이 그 key를 이 컴퓨터에서 다시 빼면 이 컴퓨터의 빼기라 풀린다. `entry`는 그 key의
  // 항목 가운데 지금 믿는 서명자가 서명한 것의 이긴 것(id는 그 가운데 가장 작은 id)이고, 없으면 그 key의 서명 key로 스스로
  // 서명한 것, 그것도 없으면 null이다. 빠진 기기의 id와 이름은 여기서만 얻는다(빠진 서명자가 다른 key에 단 id·이름을 쓰지 않는다).
  removed: {
    body: RosterRemovalBody;
    signed_by: string[];
    settled: boolean;
    entry: RosterEntryBody | null;
  }[];
  folded: { from: string; to: string }[];
  // 충돌로 뺀 key. devices에 없다.
  conflicts: RosterConflict[];
  // 쓰인 초대장: 빼기 전 믿음(T0)의 항목 가운데 지금 믿는 컴퓨터가 서명한 것(빠진 기기의 것 포함)과, 지금 믿는 컴퓨터가 낸
  // 초대장의 초대 서명 statement(초대 key마다 canonical 글이 앞선 하나)가 든 (초대 key, 기기 key). 쓰인 초대장은 그것으로 든
  // 기기를 빼도 쓰인 것이다.
  invites: { invite: string; key: string }[];
  keep: RosterStatement[];
};

type Identity = { id: string; signingKey: string; keys: Set<string> };

// 빼기가 그 서명자를 대상으로 하는가. key와 서명 key로 맞춘다(id는 아무 항목이나 달 수 있어 보지 않는다).
function targets(body: RosterRemovalBody, who: Identity): boolean {
  return who.keys.has(body.key) || body.signing_key === who.signingKey;
}

// roots는 믿음이 시작하는 컴퓨터의 서명 key다(컴퓨터는 자기 것 하나, 폰은 저장한 컴퓨터의 것들. 폰은 초대장의 issuer,
// `join` 답의 `computer`, 명단에서 믿은 컴퓨터 항목에서 배운다). `self`는 이 view가 그 컴퓨터 자신의 것일 때 그 서명 key다
// (폰은 null): 자기가 서명한 빼기는 처음부터 효력이 있고 자기는 정해지지 않은 빼기로 빠지지 않는다. 폰의 root에는 이 둘이
// 없다: 폰이 저장한 도둑 컴퓨터의 빼기가 처음부터 효력을 가지면 폰이 도둑만 믿게 된다.
// 결과는 statements의 집합만으로 정해진다: 들어온 순서와 시각을 보지 않는다. view는 keep에서 계산한 것이고(keep을 더 줄지
// 않을 때까지 되풀이한다) keep만으로 다시 계산해도 같은 view다.
export function rosterView(
  statements: readonly RosterStatement[],
  roots: readonly string[],
  self: string | null,
): RosterView {
  const rootSet = new Set(roots);
  const verify = verifier();
  let items = itemsOf(statements);
  for (;;) {
    const { view, kept } = compute(items, rootSet, self, verify);
    if (kept.length === items.length) return view;
    items = kept;
  }
}

function compute(
  all: readonly Item[],
  rootSet: ReadonlySet<string>,
  self: string | null,
  verify: Verify,
): { view: RosterView; kept: Item[] } {
  const nothing: Excluded = { keys: new Set(), signing: new Set() };

  // 규칙 3: 빼기는 빼기를 모르는 채 넓힌 믿음(T0)으로 모은다(K0).
  const t0 = trust(all, rootSet, nothing, verify);
  // 서명 key가 말하는 host key: 그 서명 key로 스스로 서명한 항목에서만 얻는다. 남이 서명한 항목이 다른 컴퓨터의 서명 key를
  // 달면(빠진 도둑이 자기 항목에 구경꾼의 서명 key를 단다) 그 컴퓨터가 도둑의 host key를 자기 것으로 보게 된다.
  const hostsOf = new Map<string, Set<string>>();
  // T0가 아는 기기 key. 아무 항목도 없는 key의 빼기는 아무것도 빼지 못하므로 효력 계산에 넣지 않는다(keep에서는 믿는 컴퓨터의
  // 것이 아니면 상한 안이다).
  const knownToT0 = new Set<string>();
  for (const item of t0.accepted) {
    const body = item.statement.body;
    if (body.type !== "entry") continue;
    knownToT0.add(body.key);
    if (
      body.signing_key === null ||
      t0.signedWith.get(item) !== body.signing_key
    )
      continue;
    hostsOf.set(
      body.signing_key,
      (hostsOf.get(body.signing_key) ?? new Set()).add(body.key),
    );
  }
  const k0 = all
    .filter(
      (item) =>
        t0.accepted.has(item) &&
        item.statement.body.type === "removal" &&
        knownToT0.has(item.statement.body.key),
    )
    .map((item) => {
      const signingKey = t0.signedWith.get(item) as string;
      return {
        item,
        body: item.statement.body as RosterRemovalBody,
        signer: {
          id: signedOf(item).by,
          signingKey,
          keys: hostsOf.get(signingKey) ?? new Set<string>(),
        },
      };
    });
  // 어느 빼기가 효력이 있는지는 공격 그래프의 grounded labelling(최소 고정점)으로 정한다. 빼기 r이 빼기 s를 공격한다는
  // 것은 r의 대상이 s의 서명자라는 것이다. 공격하는 빼기가 모두 OUT이면 IN, 공격하는 빼기 하나라도 IN이면 OUT이다.
  // 단조라 끝나고 statement 집합과 root로만 정해진다. 컴퓨터의 view에서 그 컴퓨터가 서명한 빼기는 처음부터 IN이다(자기
  // 판단을 믿는다). 끝까지 정해지지 않은 빼기(시각 없이는 깰 수 없는 서로 물고 도는 빼기)는 대상을 뺀다(fail-closed). 다만
  // 그 컴퓨터 자신은 정해지지 않은 빼기로 빠지지 않는다.
  // 폰의 view(self 없음)에서는 저장한 컴퓨터(root)가 서명한 빼기가 처음부터 IN이다. 다만 다른 저장한 컴퓨터가 서명한 빼기가 그것을
  // 공격하면(저장한 컴퓨터끼리 서로 뺐다) 정해지지 않은 채로 둔다: 폰이 도둑의 컴퓨터도 저장했으면 어느 쪽도 믿지 않고, 저장하지
  // 않았으면 저장한 컴퓨터의 판단을 따른다(도둑의 맞빼기 하나로 폰이 정직한 컴퓨터를 영영 잃지 않는다).
  const attackers = k0.map(({ signer }) =>
    k0.flatMap((other, i) => (targets(other.body, signer) ? [i] : [])),
  );
  const label: ("in" | "out" | "open")[] = k0.map(({ signer }, i) => {
    if (self !== null) return signer.signingKey === self ? "in" : "open";
    return rootSet.has(signer.signingKey) &&
      !(attackers[i] ?? []).some((j) =>
        rootSet.has((k0[j] as (typeof k0)[0]).signer.signingKey),
      )
      ? "in"
      : "open";
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (const [i, from] of attackers.entries()) {
      if (label[i] !== "open") continue;
      if (from.some((j) => label[j] === "in")) label[i] = "out";
      else if (from.every((j) => label[j] === "out")) label[i] = "in";
      else continue;
      changed = true;
    }
  }
  const selfHosts =
    (self === null ? undefined : hostsOf.get(self)) ?? new Set();
  const counting = k0
    .map((r, i) => ({ ...r, settled: label[i] === "in" }))
    .filter(
      (r, i) =>
        label[i] === "in" ||
        (label[i] === "open" &&
          !selfHosts.has(r.body.key) &&
          !(r.body.signing_key !== null && r.body.signing_key === self)),
    );
  // 빼기는 key와 서명 key로만 뺀다.
  const removedOut: Excluded = {
    keys: new Set(counting.map((r) => r.body.key)),
    signing: new Set(
      counting.flatMap((r) =>
        r.body.signing_key === null ? [] : [r.body.signing_key],
      ),
    ),
  };

  // 규칙 4~6: 뺀 key·서명 key와 충돌한 key를 빼고 다시 넓힌다.
  const { t, conflicts } = settle(all, rootSet, removedOut, verify);
  const trustedSigning = new Set([...t.signers.values()].flat());
  // 지금 믿는 서명자가 서명한 T0 statement.
  const byTrusted = (item: Item) =>
    trustedSigning.has(t0.signedWith.get(item) as string);

  // 빠진 key의 항목: 지금 믿는 서명자가 서명한 것, 없으면 그 key의 서명 key로 스스로 서명한 것.
  const t0Entries = new Map<string, Item[]>();
  for (const item of all) {
    if (!t0.accepted.has(item) || item.statement.body.type !== "entry")
      continue;
    const key = item.statement.body.key;
    t0Entries.set(key, [...(t0Entries.get(key) ?? []), item]);
  }
  // 스스로 서명한 항목은 빼기가 말하는 서명 key로 서명했을 때만 쓴다: 다른 서명자가 그 key의 항목에 자기 서명 key를 달아
  // 스스로 서명한 것처럼 꾸미지 못한다.
  const entryOfKey = (key: string): RosterEntryBody | null => {
    const list = t0Entries.get(key) ?? [];
    const trusted = list.filter(byTrusted);
    const named = new Set(
      counting.flatMap((r) =>
        r.body.key === key && r.body.signing_key !== null
          ? [r.body.signing_key]
          : [],
      ),
    );
    const chosen =
      trusted.length > 0
        ? trusted
        : list.filter((item) => {
            const signing = entryOf(item).signing_key;
            return (
              signing !== null &&
              t0.signedWith.get(item) === signing &&
              named.has(signing)
            );
          });
    if (chosen.length === 0) return null;
    const winner = [...chosen].sort(ahead)[0] as Item;
    const id = chosen
      .map((item) => entryOf(item).id)
      .sort(compare)[0] as string;
    return { ...entryOf(winner), id };
  };
  const removed: RosterView["removed"] = [];
  for (const key of new Set(counting.map((r) => r.body.key))) {
    const forKey = counting.filter((r) => r.body.key === key);
    const settled = forKey.some((r) => r.settled);
    const first = forKey.find(
      (r) => r.settled === settled,
    ) as (typeof forKey)[0];
    const signedBy = forKey
      .filter(
        (r) => r.item.bodyText === first.item.bodyText && r.settled === settled,
      )
      .map((r) => r.signer.id);
    removed.push({
      body: first.body,
      signed_by: [...new Set(signedBy)].sort(compare),
      settled,
      entry: entryOfKey(key),
    });
  }
  const removedIds = new Set(
    removed.flatMap((r) => (r.entry === null ? [] : [r.entry.id])),
  );

  const byKey = new Map<string, Item[]>();
  for (const item of all) {
    if (!t.accepted.has(item) || item.statement.body.type !== "entry") continue;
    const key = item.statement.body.key;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const devices: RosterDevice[] = [];
  const folded: RosterView["folded"] = [];
  for (const list of byKey.values()) {
    // root의 자기 key만 여기서 kind·machine이 다를 수 있다(남의 key면 충돌로 빠졌다). 가장 앞선 항목과 같은 것만 쓴다.
    const base = entryOf(
      [...list].sort(
        (a, b) =>
          entryOf(a).rev - entryOf(b).rev || compare(a.bodyText, b.bodyText),
      )[0] as Item,
    );
    const items = list.filter(
      (item) =>
        entryOf(item).kind === base.kind &&
        entryOf(item).machine === base.machine,
    );
    const winner = [...items].sort(ahead)[0] as Item;
    const ids = [...new Set(items.map((item) => entryOf(item).id))].sort(
      compare,
    );
    const id = ids[0] as string;
    for (const from of ids.slice(1)) folded.push({ from, to: id });
    const body = { ...entryOf(winner), id };
    const text = canonicalize(body);
    const signedBy = items
      .filter((item) => item.bodyText === text)
      .map((item) => signedOf(item).by);
    devices.push({
      body,
      signed_by: [...new Set(signedBy)].sort(compare),
      pending: items.every((item) => ids.includes(signedOf(item).by)),
    });
  }
  devices.sort((a, b) => compare(a.body.id, b.body.id));
  folded.sort((a, b) => compare(a.from, b.from));
  const deviceKeys = new Set(devices.map((d) => d.body.key));

  // 초대 서명 statement: 초대 key의 서명이 맞아야 남는다(초대장의 비밀을 가진 쪽만 만든다). 지금 믿는 컴퓨터가 낸 초대장이면
  // 초대 key마다 canonical 글이 앞선 하나가 상한 밖이고 쓰인 초대로 센다. 나머지는 상한 안이다.
  const invitedValid = (item: Item) =>
    verify(item, (item.statement as RosterInvitedStatement).invite.body.key);
  const issuerTrusted = (statement: RosterInvitedStatement) =>
    t.signers
      .get(statement.invite.body.by)
      ?.some((k) =>
        verifyRoster(statement.invite.body, statement.invite.signature, k),
      ) === true;
  const firstInvited = new Map<string, Item>();
  for (const item of all) {
    const { statement } = item;
    if (isSigned(statement) || firstInvited.has(statement.invite.body.key))
      continue;
    if (invitedValid(item) && issuerTrusted(statement))
      firstInvited.set(statement.invite.body.key, item);
  }
  const firstInvitedItems = new Set(firstInvited.values());

  // 쓰인 초대의 항목 쪽은 빼기 전 믿음(T0)으로 센다: 기기를 빼도 그 초대장은 쓰인 것이다. 지금 믿는 컴퓨터가 서명한 것만
  // 센다(빠진 컴퓨터가 남의 초대 key를 단 항목을 세지 않는다).
  const usedEntry = (item: Item) =>
    t0.accepted.has(item) &&
    item.statement.body.type === "entry" &&
    entryOf(item).invite !== null &&
    byTrusted(item);
  const used = new Set<string>();
  for (const item of all) {
    const { statement } = item;
    if (isSigned(statement)) {
      if (usedEntry(item)) {
        used.add(`${entryOf(item).invite}\n${entryOf(item).key}`);
      }
    } else if (firstInvitedItems.has(item)) {
      used.add(`${statement.invite.body.key}\n${statement.body.key}`);
    }
  }
  const invites = [...used].sort(compare).map((pair) => {
    const [invite, key] = pair.split("\n") as [string, string];
    return { invite, key };
  });

  // 저장하고 보낼 것(keep). 같은 서명자가 같은 key에 같은 id·초대·모양으로 더 앞선 항목에 서명했으면 뒤진 항목은 버린다: 그
  // 서명자의 더 앞선 항목이 같은 믿음, 같은 id, 같은 쓰인 초대를 남긴다. 같은 서명자가 같은 대상(key, 서명 key)에 낸 빼기는
  // canonical 글이 앞선 하나만 남긴다: 효력과 `removed`가 서명자와 대상으로만 정해진다.
  const best = new Map<string, Item>();
  const firstRemoval = new Map<string, Item>();
  for (const item of all) {
    if (!t0.accepted.has(item)) continue;
    const body = item.statement.body;
    if (body.type === "removal") {
      const group = [t0.signedWith.get(item), body.key, body.signing_key].join(
        "\n",
      );
      if (!firstRemoval.has(group)) firstRemoval.set(group, item);
      continue;
    }
    if (body.type !== "entry") continue;
    const group = [
      signedOf(item).by,
      body.key,
      body.id,
      body.invite,
      body.kind,
      body.signing_key,
      body.machine,
    ].join("\n");
    const other = best.get(group);
    if (other === undefined || ahead(item, other) < 0) best.set(group, item);
  }
  const bestItems = new Set(best.values());
  const firstRemovals = new Set(firstRemoval.values());
  // 지금 믿는 서명자가 보증한 key와 서명 key. 빠진(믿지 않는) 서명자의 빼기는 이것들끼리일 때만 상한 밖이다: 엇갈림을 정하는 데
  // 들고, 수가 믿는 쪽이 보증한 기기 수로 묶인다.
  const knownKeys = new Set<string>();
  const knownSigning = new Set<string>();
  for (const list of t0Entries.values()) {
    for (const item of list) {
      if (!byTrusted(item)) continue;
      knownKeys.add(entryOf(item).key);
      const signing = entryOf(item).signing_key;
      if (signing !== null) knownSigning.add(signing);
    }
  }
  // "capped"는 상한 안이다: 지금 믿지 않는 서명자·초대장 서명자의 것과 서명자를 모르는 것. 나중에 믿게 될 수 있어 남기되
  // `ROSTER_UNKNOWN_MAX`까지만 canonical 글 순서로 앞선 것을 남긴다. 받은 순서와 상관없이 모든 기계가 같은 것을 남기고, 믿는
  // 쪽이 쓴 것을 밀어내지 못한다. 그래서 지금 믿지 않는 누구도 저장소를 `ROSTER_STATEMENTS_MAX`까지 채우지 못한다.
  const fate = (item: Item): "keep" | "drop" | "capped" => {
    const { statement } = item;
    if (!isSigned(statement)) {
      if (!invitedValid(item)) return "drop";
      return firstInvitedItems.has(item) ? "keep" : "capped";
    }
    const { body } = statement;
    // 아무 항목도 없는 key의 빼기는 아무것도 빼지 못한다. 지금 믿는 컴퓨터의 것은 남기고 나머지는 상한 안에 둔다: 버리면
    // 서명자와 대상을 아직 모르는 정직한 빼기를 잃어, 닿은 순서가 엇갈림의 결과를 바꾼다.
    if (body.type === "removal" && !knownToT0.has(body.key)) {
      if (t0.accepted.has(item) && !firstRemovals.has(item)) return "drop";
      return t0.accepted.has(item) && byTrusted(item) ? "keep" : "capped";
    }
    if (t0.accepted.has(item)) {
      if (body.type === "removal") {
        if (!firstRemovals.has(item)) return "drop";
        if (byTrusted(item)) return "keep";
        const known =
          knownSigning.has(t0.signedWith.get(item) as string) &&
          knownKeys.has(body.key) &&
          (body.signing_key === null || knownSigning.has(body.signing_key));
        return known ? "keep" : "capped";
      }
      if (!bestItems.has(item)) return "drop";
      // 컴퓨터 항목은 빠졌어도 남긴다: 그 컴퓨터가 서명한 K0 빼기를 다시 맞춰 보는 데 든다. 빠진 기기의 항목도 남긴다:
      // 빠진 기기의 `entry`와 쓰인 초대의 기록이다.
      const wanted =
        body.kind === "computer" ||
        deviceKeys.has(body.key) ||
        conflicts.has(body.key) ||
        removedOut.keys.has(body.key) ||
        usedEntry(item);
      if (!wanted) return "drop";
      return byTrusted(item) ? "keep" : "capped";
    }
    // 믿는 서명자의 id인데 맞지 않으면 틀린 statement다.
    if (t0.signers.has(statement.by) || removedIds.has(statement.by)) {
      return "drop";
    }
    return body.type === "entry" && excluded(body, removedOut)
      ? "drop"
      : "capped";
  };
  let capped = 0;
  const kept = all.filter((item) => {
    const f = fate(item);
    if (f !== "capped") return f === "keep";
    capped += 1;
    return capped <= ROSTER_UNKNOWN_MAX;
  });

  return {
    view: {
      devices,
      removed,
      folded,
      conflicts: [...conflicts.values()].sort((a, b) => compare(a.key, b.key)),
      invites,
      keep: kept.map((item) => item.statement),
    },
    kept,
  };
}

// 초대장으로 들었는데 다른 컴퓨터가 아직 받아들이지 않은 기기: 초대 서명 statement뿐이거나, 항목이 그 기기 자신의 서명뿐이고
// 초대로 든 표(이긴 항목의 `invite`나 남겨 둔 초대 서명 statement)가 있다. 초대 없이 선 항목(컴퓨터의 첫 자기 항목, 옮긴 폰)은
// 기다리는 것이 없어 pending이 아니다. 초대한 컴퓨터에 못 닿고 든 컴퓨터는 이긴 항목이 아직 초대 전 rev라 남겨 둔 statement로 본다.
export function rosterPending(view: RosterView, key: string): boolean {
  const invited = view.keep.some((s) => !isSigned(s) && s.body.key === key);
  const device = view.devices.find((d) => d.body.key === key);
  if (device === undefined) return invited;
  return device.pending && (device.body.invite !== null || invited);
}

// 저장하는 쪽이 자기 시계로 초대 서명 statement를 거른다: 수명이 지났거나, 지금부터 긴 수명보다 더 먼 수명(쓰레기로
// 저장소를 채우는 것)을 단 것을 버린다. view는 시각을 보지 않으므로 이것은 저장할 때 따로 한다.
export function rosterFresh(
  statements: readonly RosterStatement[],
  now: number,
): RosterStatement[] {
  return statements.filter((statement) => {
    if (isSigned(statement)) return true;
    const expires = Date.parse(statement.invite.body.expires_at);
    return now <= expires && expires <= now + ROSTER_INVITE_LONG_MS;
  });
}

export type InviteCheck = {
  // 검증하는 컴퓨터의 지금(ms).
  now: number;
  // 검증하는 컴퓨터의 지금 view(자기 서명 key를 root로).
  view: RosterView;
};

type RefuseReason =
  | "untrusted"
  | "removed"
  | "id_taken"
  | "key_taken"
  | "expired"
  | "used";

function refused(
  code: LophnError["code"],
  reason: RefuseReason,
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
  const { view, now } = input;
  const issuer = view.devices.find(
    (d) => d.body.kind === "computer" && d.body.id === invite.body.by,
  )?.body.signing_key;
  const expires = Date.parse(invite.body.expires_at);
  if (
    issuer === undefined ||
    issuer === null ||
    !verifyRoster(invite.body, invite.signature, issuer) ||
    !verifyRoster(body, signature, invite.body.key) ||
    body.invite !== invite.body.key ||
    body.kind !== invite.body.kind ||
    // 어느 컴퓨터도 긴 수명보다 먼 초대장을 내지 않는다.
    expires > now + ROSTER_INVITE_LONG_MS
  ) {
    return refused("unauthorized", "untrusted");
  }
  // 뺀 기기가 수명이 남은 초대장을 다시 내도 "새 초대장을 받아라"가 아니라 "key를 버려라"를 알게 한다.
  if (
    view.removed.some(
      ({ body: r, entry }) =>
        r.key === body.key ||
        entry?.id === body.id ||
        (r.signing_key !== null && r.signing_key === body.signing_key),
    )
  ) {
    return refused("unauthorized", "removed");
  }
  const held = [
    ...view.devices.map((d) => ({
      key: d.body.key,
      ids: [
        d.body.id,
        ...view.folded.filter((f) => f.to === d.body.id).map((f) => f.from),
      ],
      body: d.body as RosterEntryBody | undefined,
    })),
    ...view.conflicts.map((c) => ({ key: c.key, ids: c.ids, body: undefined })),
  ];
  if (held.some((h) => h.key !== body.key && h.ids.includes(body.id))) {
    return refused("conflict", "id_taken");
  }
  const same = held.find((h) => h.key === body.key);
  if (
    (same !== undefined &&
      (same.body === undefined ||
        same.body.kind !== body.kind ||
        same.body.signing_key !== body.signing_key ||
        same.body.machine !== body.machine)) ||
    (body.signing_key !== null &&
      held.some(
        (h) => h.key !== body.key && h.body?.signing_key === body.signing_key,
      ))
  ) {
    return refused("conflict", "key_taken");
  }
  if (now > expires) return refused("unauthorized", "expired");
  if (
    view.invites.some((u) => u.invite === invite.body.key && u.key !== body.key)
  ) {
    return refused("conflict", "used");
  }
  return ok(body);
}

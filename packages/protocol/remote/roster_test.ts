import assert from "node:assert/strict";
import { test } from "node:test";
import { seededRandom } from "../../base/mod.ts";
import { generateKeyPair, type KeyPair, remoteKeyText } from "./noise.ts";
import {
  checkInvited,
  generateSigningKey,
  type InviteCheck,
  mergeRoster,
  type RosterEntryBody,
  type RosterInvitedStatement,
  type RosterStatement,
  rosterStatementSchema,
  rosterView,
  signRoster,
} from "./roster.ts";

const random = seededRandom(7);
let serial = 0;

function newId(): string {
  serial += 1;
  return `dev_0${String(serial).padStart(25, "0")}`;
}

type Computer = { id: string; key: string; signing: KeyPair };

function computer(): Computer {
  return {
    id: newId(),
    key: remoteKeyText(generateKeyPair(random).publicKey),
    signing: generateSigningKey(random),
  };
}

// 믿음은 컴퓨터의 서명 key에서 시작한다.
function root(c: Computer): string {
  return remoteKeyText(c.signing.publicKey);
}

function computerEntry(c: Computer, rev = 1): RosterEntryBody {
  return {
    type: "entry",
    id: c.id,
    kind: "computer",
    key: c.key,
    signing_key: remoteKeyText(c.signing.publicKey),
    machine: `mch_0${c.id.slice(5)}`,
    name: "computer",
    os: "linux",
    terminal_input: true,
    rev,
    invite: null,
  };
}

function phoneEntry(
  id: string,
  key: string,
  rev = 1,
  invite: string | null = null,
): RosterEntryBody {
  return {
    type: "entry",
    id,
    kind: "phone",
    key,
    signing_key: null,
    machine: null,
    name: "phone",
    os: "android",
    terminal_input: false,
    rev,
    invite,
  };
}

function signed(body: RosterStatement["body"], by: Computer): RosterStatement {
  // 만든 statement가 schema를 지나는지도 같이 본다. 틀린 fixture로 통과하는 test가 되지 않게.
  return rosterStatementSchema.parse({
    body,
    by: by.id,
    signature: signRoster(body, by.signing.secretKey),
  });
}

function removal(id: string, key: string): RosterStatement["body"] {
  return { type: "removal", id, key, at: "2026-11-18T00:00:00.000Z" };
}

function phoneKey(): string {
  return remoteKeyText(generateKeyPair(random).publicKey);
}

function deviceIds(statements: RosterStatement[], roots: string[]): string[] {
  return rosterView(statements, roots).devices.map((d) => d.body.id);
}

// A가 B를 믿고 B가 A를 믿는 두 컴퓨터. 서로의 항목에 서명했다.
function pair(): { a: Computer; b: Computer; base: RosterStatement[] } {
  const a = computer();
  const b = computer();
  return {
    a,
    b,
    base: [
      signed(computerEntry(a), a),
      signed(computerEntry(b), b),
      signed(computerEntry(b), a),
      signed(computerEntry(a), b),
    ],
  };
}

test("믿는 컴퓨터의 서명이 없는 항목, 수명이 지난 초대장(닿은 때 기준), 한 번 쓰인 초대장으로는 들어오지 못한다", () => {
  const { a, base } = pair();
  const stranger = computer();
  const unknownPhone = newId();
  const unknownKey = phoneKey();
  const fromStranger = signed(phoneEntry(unknownPhone, unknownKey), stranger);
  // 믿는 컴퓨터(A)의 이름을 달고 다른 key로 서명한 것.
  const forged = { ...fromStranger, by: a.id };
  // A의 host key를 단 항목을 남의 서명 key로 스스로 서명해 root 행세를 한다.
  const fakeRoot = signed(
    { ...computerEntry(stranger), key: a.key, id: a.id },
    { ...stranger, id: a.id },
  );
  const view = rosterView([...base, fromStranger, forged, fakeRoot], [root(a)]);
  assert.ok(!view.devices.some((d) => d.body.id === unknownPhone));
  // 서명자를 아직 모르는 statement는 버리지 않는다. 그 서명자를 나중에 믿게 될 수 있다.
  assert.ok(view.keep.includes(fromStranger));
  assert.ok(!view.keep.includes(forged));

  const invite = generateSigningKey(random);
  const inviteKey = remoteKeyText(invite.publicKey);
  const expires = Date.parse("2026-11-18T00:30:00.000Z");
  function invited(
    issuer: Computer,
    key: string,
    options: { terminal?: boolean; entryTerminal?: boolean } = {},
  ): RosterInvitedStatement {
    const inviteBody = {
      type: "invite" as const,
      key: inviteKey,
      by: issuer.id,
      terminal_input: options.terminal ?? false,
      expires_at: new Date(expires).toISOString(),
    };
    const body = {
      ...phoneEntry(newId(), key, 1, inviteKey),
      terminal_input: options.entryTerminal ?? options.terminal ?? false,
    };
    return {
      body,
      invite: {
        body: inviteBody,
        signature: signRoster(inviteBody, issuer.signing.secretKey),
      },
      signature: signRoster(body, invite.secretKey),
    };
  }
  const newKey = phoneKey();
  const otherKey = phoneKey();
  const trusted = (id: string) =>
    id === a.id ? remoteKeyText(a.signing.publicKey) : undefined;
  const baseInput: InviteCheck = {
    now: expires - 1,
    signer: trusted,
    usedBy: () => undefined,
    removed: () => false,
  };

  // 초대 서명 statement만으로는 명단에 들지 않는다. 받은 컴퓨터가 확인하고 서명해야 든다.
  const good = invited(a, newKey);
  assert.deepEqual(
    deviceIds([...base, good], [root(a)]).includes(good.body.id),
    false,
  );
  assert.equal(checkInvited(good, baseInput).ok, true);

  const cases: {
    name: string;
    statement: RosterInvitedStatement;
    input?: Partial<InviteCheck>;
    code?: string;
    reason?: string;
  }[] = [
    {
      name: "모르는 컴퓨터가 낸 초대장",
      statement: invited(stranger, newKey),
      code: "unauthorized",
      reason: "untrusted",
    },
    {
      name: "초대장과 다른 터미널 허락",
      statement: invited(a, newKey, { terminal: false, entryTerminal: true }),
      code: "unauthorized",
      reason: "untrusted",
    },
    {
      name: "닿은 때가 수명 뒤",
      statement: good,
      input: { now: expires + 1 },
      code: "unauthorized",
      reason: "expired",
    },
    {
      name: "다른 key가 이미 쓴 초대장",
      statement: good,
      input: { usedBy: () => otherKey },
      code: "conflict",
      reason: "used",
    },
    {
      name: "같은 key가 다시 낸 초대장",
      statement: good,
      input: { usedBy: () => newKey },
    },
    {
      name: "뺀 key",
      statement: good,
      input: { removed: (key) => key === newKey },
      code: "unauthorized",
      reason: "removed",
    },
  ];
  for (const c of cases) {
    const result = checkInvited(c.statement, { ...baseInput, ...c.input });
    if (c.code === undefined) {
      assert.equal(result.ok, true, c.name);
      continue;
    }
    assert.equal(result.ok, false, c.name);
    if (result.ok) continue;
    assert.equal(result.error.code, c.code, c.name);
    assert.equal(result.error.details?.reason, c.reason, c.name);
  }

  // 초대장의 서명을 다른 초대장 body에 옮겨 붙여도(수명을 늘리기) 받지 않는다.
  const stretched: RosterInvitedStatement = {
    ...good,
    invite: {
      ...good.invite,
      body: { ...good.invite.body, expires_at: "2027-01-01T00:00:00.000Z" },
    },
  };
  const result = checkInvited(stretched, { ...baseInput, now: expires + 1 });
  assert.equal(result.ok, false);
});

test("빼기보다 늦게 도착한 뺀 기기의 항목이 빼기를 되돌리지 못한다", () => {
  const { a, b, base } = pair();
  const phone = newId();
  const key = phoneKey();
  const joined = signed(phoneEntry(phone, key), a);
  const removed = signed(removal(phone, key), a);
  // B는 빼기를 모른 채 더 새 rev에 서명했고, 그것이 빼기 뒤에 닿는다.
  const late = signed({ ...phoneEntry(phone, key, 5) }, b);
  // 같은 key로 새 id를 받아 다시 들어오려 한다.
  const again = signed(phoneEntry(newId(), key, 9), b);

  const before = rosterView([...base, joined, removed], [root(a)]);
  assert.ok(!before.devices.some((d) => d.body.key === key));
  for (const roots of [[root(a)], [root(b)], [root(a), root(b)]]) {
    const after = rosterView([...before.keep, late, again], roots);
    assert.ok(!after.devices.some((d) => d.body.key === key), String(roots));
    assert.deepEqual(
      after.removed.map((r) => r.key),
      [key],
    );
    assert.ok(
      !after.keep.some((s) => s.body.type === "entry" && s.body.key === key),
    );
    // keep만으로 다시 계산해도 빼기가 남는다.
    const again2 = rosterView(after.keep, roots);
    assert.deepEqual(
      again2.removed.map((r) => r.key),
      [key],
    );
  }
});

test("뺀 컴퓨터가 서명한 항목은 받아들이지 않는다", () => {
  const { a, b, base } = pair();
  const c = computer();
  const cJoined = [signed(computerEntry(c), a), signed(computerEntry(c), c)];
  // C가 빠지기 전에 들인 폰. A가 그때 같이 서명했다.
  const early = newId();
  const earlyKey = phoneKey();
  const earlyStatements = [
    signed(phoneEntry(early, earlyKey), c),
    signed(phoneEntry(early, earlyKey), a),
  ];
  const cRemoved = signed(removal(c.id, c.key), b);
  // C가 빼기를 모른 채(또는 훔친 사람이) 들인 폰, C가 서명한 B의 새 이름.
  const late = newId();
  const lateKey = phoneKey();
  const afterRemoval = [
    signed(phoneEntry(late, lateKey), c),
    signed({ ...computerEntry(b, 2), name: "stolen" }, c),
  ];
  const all = [
    ...base,
    ...cJoined,
    ...earlyStatements,
    cRemoved,
    ...afterRemoval,
  ];
  for (const roots of [[root(a)], [root(b)]]) {
    const view = rosterView(all, roots);
    const ids = view.devices.map((d) => d.body.id);
    assert.ok(!ids.includes(c.id));
    assert.ok(!ids.includes(late));
    assert.ok(ids.includes(early));
    assert.equal(
      view.devices.find((d) => d.body.id === b.id)?.body.name,
      "computer",
    );
    for (const s of afterRemoval) assert.ok(!view.keep.includes(s));
  }
});

test("두 명단을 어느 순서로 합쳐도 같은 명단이 된다", () => {
  const { a, b, base } = pair();
  const key = phoneKey();
  const onA = newId();
  const onB = newId();
  const other = newId();
  const otherKey = phoneKey();
  const fromA = [
    ...base.slice(0, 1),
    base[2] as RosterStatement,
    signed(phoneEntry(onA, key), a),
    signed({ ...phoneEntry(other, otherKey, 2), name: "renamed on A" }, a),
  ];
  const fromB = [
    ...base.slice(1, 2),
    base[3] as RosterStatement,
    // 같은 폰이 B에서는 다른 id로 pairing되어 있었고 B에서 이름을 바꿨다.
    signed({ ...phoneEntry(onB, key, 2), name: "renamed on B" }, b),
    signed({ ...phoneEntry(other, otherKey, 2), name: "renamed on B" }, b),
    signed(removal(newId(), phoneKey()), b),
  ];
  const orders = [
    [fromA, fromB],
    [fromB, fromA],
    [[...fromB].reverse(), [...fromA].reverse()],
    [
      [...fromA, ...fromB].filter((_, i) => i % 2 === 0),
      [...fromA, ...fromB].filter((_, i) => i % 2 === 1),
    ],
  ];
  const merged = orders.map(([x, y]) => mergeRoster(x ?? [], y ?? []));
  for (const m of merged) assert.deepEqual(m, merged[0]);
  assert.deepEqual(mergeRoster(fromA, fromA, fromB), merged[0]);

  const views = orders.map(([x, y]) =>
    rosterView([...(x ?? []), ...(y ?? [])], [root(a)]),
  );
  for (const v of views) assert.deepEqual(v, views[0]);
  const view = views[0];
  assert.ok(view);
  // 같은 key의 두 id는 작은 id 하나로 접히고, rev가 큰 이름이 이긴다. 같은 rev는 어느 쪽이든 하나로 정해진다.
  const phone = view.devices.find((d) => d.body.key === key);
  assert.equal(phone?.body.id, onA);
  assert.equal(phone?.body.name, "renamed on B");
  assert.deepEqual(view.folded, [{ from: onB, to: onA }]);
  assert.equal(view.devices.filter((d) => d.body.key === otherKey).length, 1);
  // B를 root로 계산해도 같은 기기들이다.
  assert.deepEqual(
    rosterView(merged[0] ?? [], [root(b)]).devices,
    view.devices,
  );
});

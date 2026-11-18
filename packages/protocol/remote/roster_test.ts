import assert from "node:assert/strict";
import { test } from "node:test";
import { seededRandom } from "../../base/mod.ts";
import { generateKeyPair, type KeyPair, remoteKeyText } from "./noise.ts";
import {
  checkInvited,
  generateSigningKey,
  mergeRoster,
  ROSTER_INVITE_LONG_MS,
  ROSTER_STATEMENTS_MAX,
  ROSTER_UNKNOWN_MAX,
  type RosterEntryBody,
  type RosterInvitedStatement,
  type RosterStatement,
  rosterPending,
  rosterStatementSchema,
  rosterView,
  signRoster,
} from "./roster.ts";

// root가 하나면 그 컴퓨터 자신의 view(self)이고, 여럿이면 저장한 컴퓨터들을 root로 둔 폰의 view다.
function viewOf(statements: readonly RosterStatement[], roots: string[]) {
  return rosterView(
    statements,
    roots,
    roots.length === 1 ? (roots[0] as string) : null,
  );
}

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

function removal(
  id: string,
  key: string,
  signingKey: string | null = null,
): RosterStatement["body"] {
  return {
    type: "removal",
    id,
    key,
    signing_key: signingKey,
    at: "2026-11-18T00:00:00.000Z",
  };
}

// 컴퓨터를 빼는 빼기에는 그 서명 key도 싣는다.
function removeComputer(c: Computer): RosterStatement["body"] {
  return removal(c.id, c.key, root(c));
}

const EXPIRES = "2026-11-18T00:30:00.000Z";

// issuer가 낸 초대장과 그 비밀.
function inviteOf(
  issuer: Computer,
  options: {
    kind?: "computer" | "phone";
    terminal?: boolean;
    expires?: string;
  } = {},
) {
  const secret = generateSigningKey(random);
  const body = {
    type: "invite" as const,
    key: remoteKeyText(secret.publicKey),
    by: issuer.id,
    kind: options.kind ?? "phone",
    terminal_input: options.terminal ?? false,
    expires_at: options.expires ?? EXPIRES,
  };
  return {
    secret,
    invite: { body, signature: signRoster(body, issuer.signing.secretKey) },
  };
}

// 새 기기가 초대장의 비밀로 자기 항목에 서명한다. body의 invite와 terminal_input은 초대장을 따른다(over로 어긋나게 한다).
function invitedWith(
  made: ReturnType<typeof inviteOf>,
  entry: RosterEntryBody,
  over: Partial<RosterEntryBody> = {},
): RosterInvitedStatement {
  const body = {
    ...entry,
    invite: made.invite.body.key,
    terminal_input: made.invite.body.terminal_input,
    ...over,
  };
  return {
    body,
    invite: made.invite,
    signature: signRoster(body, made.secret.secretKey),
  };
}

function phoneKey(): string {
  return remoteKeyText(generateKeyPair(random).publicKey);
}

function keysOf(statements: RosterStatement[], roots: string[]): string[] {
  return viewOf(statements, roots).devices.map((d) => d.body.key);
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
  const { a, b, base } = pair();
  const stranger = computer();
  const strangerPhone = phoneKey();
  const fromStranger = signed(phoneEntry(newId(), strangerPhone), stranger);
  // 믿는 컴퓨터(A)의 이름을 달고 다른 key로 서명한 것.
  const forged = { ...fromStranger, by: a.id };
  // A의 host key를 단 항목을 남의 서명 key로 스스로 서명해 root 행세를 한다.
  const fakeRoot = signed(
    { ...computerEntry(stranger), key: a.key, id: a.id },
    { ...stranger, id: a.id },
  );
  const fresh = inviteOf(a);
  const invitedOnly = invitedWith(fresh, phoneEntry(newId(), phoneKey()));
  const view0 = viewOf(
    [...base, fromStranger, forged, fakeRoot, invitedOnly],
    [root(a)],
  );
  assert.deepEqual(
    view0.devices.map((d) => d.body.key),
    keysOf(base, [root(a)]),
  );
  // 서명자를 아직 모르는 statement와 초대 서명 statement는 버리지 않는다. 나중에 믿게 될 수 있다.
  assert.ok(view0.keep.includes(fromStranger));
  assert.ok(view0.keep.includes(invitedOnly));
  assert.ok(!view0.keep.includes(forged));
  assert.ok(rosterPending(view0, invitedOnly.body.key));

  // 검증하는 A가 아는 명단: 초대 iOld로 들었다가 B의 초대 iNew로 rev 2가 된 폰, 뺀 폰과 뺀 컴퓨터, 아직 확인하지
  // 않은 초대 서명 statement 하나.
  const iOld = inviteOf(a);
  const iNew = inviteOf(b);
  const phone = { id: newId(), key: phoneKey() };
  const gone = { id: newId(), key: phoneKey() };
  const goneComputer = computer();
  const waiting = inviteOf(a);
  const waitingKey = phoneKey();
  const known = [
    ...base,
    signed(phoneEntry(phone.id, phone.key, 1, iOld.invite.body.key), a),
    signed(phoneEntry(phone.id, phone.key, 2, iNew.invite.body.key), b),
    signed(phoneEntry(phone.id, phone.key, 2, iNew.invite.body.key), a),
    signed(phoneEntry(gone.id, gone.key), a),
    signed(removal(gone.id, gone.key), a),
    signed(computerEntry(goneComputer), a),
    signed(removeComputer(goneComputer), a),
    invitedWith(waiting, phoneEntry(newId(), waitingKey)),
  ];
  const view = viewOf(known, [root(a)]);
  const now = Date.parse(EXPIRES) - 1;
  const fromNew = (made: ReturnType<typeof inviteOf>, over = {}) =>
    invitedWith(made, phoneEntry(newId(), phoneKey()), over);
  const cases: {
    name: string;
    statement: RosterInvitedStatement;
    now?: number;
    code?: string;
    reason?: string;
  }[] = [
    { name: "새 기기", statement: fromNew(fresh) },
    {
      name: "모르는 컴퓨터가 낸 초대장",
      statement: fromNew(inviteOf(stranger)),
      code: "unauthorized",
      reason: "untrusted",
    },
    {
      name: "초대장과 다른 터미널 허락",
      statement: fromNew(fresh, { terminal_input: true }),
      code: "unauthorized",
      reason: "untrusted",
    },
    {
      name: "폰 초대장으로 든 컴퓨터",
      statement: invitedWith(fresh, computerEntry(computer())),
      code: "unauthorized",
      reason: "untrusted",
    },
    {
      name: "긴 수명보다 먼 초대장",
      statement: fromNew(
        inviteOf(a, {
          expires: new Date(now + ROSTER_INVITE_LONG_MS + 60_000).toISOString(),
        }),
      ),
      code: "unauthorized",
      reason: "untrusted",
    },
    {
      name: "닿은 때가 수명 뒤",
      statement: fromNew(fresh),
      now: Date.parse(EXPIRES) + 1,
      code: "unauthorized",
      reason: "expired",
    },
    {
      name: "다른 key가 옛 rev에서 쓴 초대장",
      statement: fromNew(iOld),
      code: "conflict",
      reason: "used",
    },
    {
      name: "다른 key의 초대 서명 statement가 쓴 초대장",
      statement: fromNew(waiting),
      code: "conflict",
      reason: "used",
    },
    {
      name: "같은 key가 다시 낸 초대장",
      statement: invitedWith(waiting, phoneEntry(newId(), waitingKey)),
    },
    {
      name: "뺀 key",
      statement: invitedWith(fresh, phoneEntry(newId(), gone.key)),
      code: "unauthorized",
      reason: "removed",
    },
    {
      name: "뺀 id",
      statement: invitedWith(fresh, phoneEntry(gone.id, phoneKey())),
      code: "unauthorized",
      reason: "removed",
    },
    {
      name: "뺀 서명 key를 단 새 host key",
      statement: invitedWith(inviteOf(a, { kind: "computer" }), {
        ...computerEntry(computer()),
        signing_key: root(goneComputer),
      }),
      code: "unauthorized",
      reason: "removed",
    },
    {
      name: "다른 기기의 id",
      statement: invitedWith(fresh, phoneEntry(a.id, phoneKey())),
      code: "conflict",
      reason: "id_taken",
    },
    {
      name: "다른 컴퓨터의 서명 key",
      statement: invitedWith(inviteOf(a, { kind: "computer" }), {
        ...computerEntry(computer()),
        signing_key: root(b),
      }),
      code: "conflict",
      reason: "key_taken",
    },
  ];
  for (const c of cases) {
    const result = checkInvited(c.statement, { now: c.now ?? now, view });
    if (c.code === undefined) {
      assert.equal(result.ok, true, c.name);
      continue;
    }
    assert.equal(result.ok, false, c.name);
    if (result.ok) continue;
    assert.equal(result.error.code, c.code, c.name);
    assert.equal(result.error.details?.reason, c.reason, c.name);
  }
});

test("빼기보다 늦게 도착한 뺀 기기의 항목이 빼기를 되돌리지 못한다", () => {
  const { a, b, base } = pair();
  const phone = newId();
  const key = phoneKey();
  const before = viewOf(
    [
      ...base,
      signed(phoneEntry(phone, key), a),
      signed(removal(phone, key), a),
    ],
    [root(a)],
  );
  // 뺀 컴퓨터 R의 서명 key로 새 host key를 단 항목(형제)과, 그것이 들인 폰.
  const r = computer();
  const sibling = { ...computer(), signing: r.signing };
  const evil = phoneKey();
  const rows: {
    name: string;
    statements: RosterStatement[];
    gone: string[];
  }[] = [
    {
      // B는 빼기를 모른 채 더 새 rev와 같은 key의 새 id에 서명했고, 그것이 빼기 뒤에 닿는다.
      name: "늦게 온 새 rev와 새 id",
      statements: [
        ...before.keep,
        signed(phoneEntry(phone, key, 5), b),
        signed(phoneEntry(newId(), key, 9), b),
      ],
      gone: [key],
    },
    {
      name: "뺀 서명 key를 단 형제 항목",
      statements: [
        ...base,
        signed(computerEntry(r), a),
        signed(computerEntry(r), r),
        signed(computerEntry(sibling), r),
        signed(computerEntry(sibling), a),
        signed(removeComputer(r), a),
        signed(phoneEntry(newId(), evil), sibling),
      ],
      gone: [r.key, sibling.key, evil],
    },
  ];
  for (const row of rows) {
    // 폰은 R도 root로 저장해 두었을 수 있다. 뺀 서명 key는 root도 되지 못한다.
    for (const roots of [[root(a)], [root(b)], [root(a), root(b), root(r)]]) {
      const view = viewOf(row.statements, roots);
      const keys = view.devices.map((d) => d.body.key);
      for (const k of row.gone) assert.ok(!keys.includes(k), row.name);
      assert.ok(keys.includes(a.key) && keys.includes(b.key), row.name);
      // keep만으로 다시 계산해도 빼기가 남는다.
      const again = viewOf(view.keep, roots);
      assert.deepEqual(again.removed, view.removed, row.name);
      assert.deepEqual(again.devices, view.devices, row.name);
    }
  }
});

test("뺀 컴퓨터가 서명한 항목은 받아들이지 않는다", () => {
  const { a, b, base } = pair();
  const c = computer();
  const cJoined = [signed(computerEntry(c), a), signed(computerEntry(c), c)];
  // C가 빠지기 전에 들인 폰. A가 그때 같이 서명했다.
  const early = phoneKey();
  const earlyStatements = [
    signed(phoneEntry(newId(), early), c),
    signed(phoneEntry(newId(), early), a),
  ];
  // C가 빼기를 모른 채(또는 훔친 사람이) 들인 폰, C가 서명한 B의 새 이름, C가 빠진 뒤 서명한 A의 빼기(A는 C를 빼지 않았다).
  const late = phoneKey();
  const afterRemoval = [
    signed(phoneEntry(newId(), late), c),
    signed({ ...computerEntry(b, 2), name: "stolen" }, c),
    signed(removeComputer(a), c),
  ];
  const all = [
    ...base,
    ...cJoined,
    ...earlyStatements,
    signed(removeComputer(c), b),
    ...afterRemoval,
  ];
  for (const roots of [[root(a)], [root(b)]]) {
    const view = viewOf(all, roots);
    const keys = view.devices.map((d) => d.body.key);
    assert.deepEqual(
      [keys.includes(c.key), keys.includes(late), keys.includes(early)],
      [false, false, true],
    );
    assert.equal(
      view.devices.find((d) => d.body.key === b.key)?.body.name,
      "computer",
    );
    assert.deepEqual(
      view.removed.map((r) => r.body.key),
      [c.key],
    );
  }
});

// 빼기끼리 엇갈릴 때. 공격 그래프의 grounded labelling이 정하고, root가 서명한 빼기는 처음부터 효력이 있고, 서로 물고
// 도는 빼기는 대상을 모두 뺀다(그 view의 root만은 남긴다).
test("빠진 컴퓨터의 빼기는 자기를 뺀 쪽과 서로 물고 도는 것 말고는 효력이 없다", () => {
  const [x, y, z, r, f] = [
    computer(),
    computer(),
    computer(),
    computer(),
    computer(),
  ] as [Computer, Computer, Computer, Computer, Computer];
  const mesh = (cs: Computer[]) =>
    cs.flatMap((one) => cs.map((other) => signed(computerEntry(one), other)));
  const out = (from: Computer, gone: Computer) =>
    signed(removeComputer(gone), from);
  // R은 빠지기 전에 가짜 컴퓨터 F를 들였고 Y가 같이 서명했다.
  const fake = [
    signed(computerEntry(f), r),
    signed(computerEntry(f), y),
    signed(computerEntry(f), f),
  ];
  type Expect = { root: Computer; gone: Computer[]; settled: boolean };
  const rows: {
    name: string;
    statements: RosterStatement[];
    expect: Expect[];
  }[] = [
    {
      // 빠진 R이 효력 없는 빼기를 Y에 걸어도 Y가 혼자 하는 빼기(Z)는 효력이 있다.
      name: "막지 못하는 빼기",
      statements: [...mesh([x, y, z, r]), out(x, r), out(r, y), out(y, z)],
      expect: [x, y].map((root) => ({ root, gone: [r, z], settled: true })),
    },
    {
      name: "서로 뺐다",
      statements: [...mesh([x, y, z]), out(x, y), out(y, x)],
      expect: [
        { root: x, gone: [y], settled: true },
        { root: y, gone: [x], settled: true },
        { root: z, gone: [x, y], settled: false },
      ],
    },
    {
      // 사람: Y가 F를, X가 R을 뺐다. 그 뒤 도둑: F가 X를, R이 Z를 뺐다. Z는 아무것도 하지 않았다.
      name: "도둑 둘(Q2T)",
      statements: [
        ...mesh([x, y, z, r, f]),
        out(y, f),
        out(x, r),
        out(f, x),
        out(r, z),
      ],
      expect: [x, y, z].map((root) => ({ root, gone: [r, f], settled: true })),
    },
    {
      // 위에 더해 R이 Y도 뺐다. X와 Y는 자기 판단을 믿는다. Z에는 X→R→Y→F→X가 물고 돌아 정해지지 않으므로
      // Z 말고 모두 빠진다(fail-closed).
      name: "도둑 둘과 고리(Q1T)",
      statements: [
        ...mesh([x, y, z, r]),
        ...fake,
        out(y, f),
        out(x, r),
        out(f, x),
        out(r, z),
        out(r, y),
      ],
      expect: [
        { root: x, gone: [r, f], settled: true },
        { root: y, gone: [r, f], settled: true },
        { root: z, gone: [x, y, r, f], settled: false },
      ],
    },
  ];
  const everyone = [x, y, z, r, f];
  for (const row of rows) {
    for (const e of row.expect) {
      const view = viewOf(row.statements, [root(e.root)]);
      const keys = view.devices.map((d) => d.body.key);
      const present = new Set(
        row.statements.flatMap((s) => ("by" in s ? [s.body.key] : [])),
      );
      for (const c of everyone) {
        if (!present.has(c.key)) continue;
        assert.equal(
          keys.includes(c.key),
          !e.gone.includes(c),
          `${row.name}: ${everyone.indexOf(c)} at root ${everyone.indexOf(e.root)}`,
        );
      }
      // 정해진 빼기만 컴퓨터가 같이 서명한다. 정해지지 않은 고리가 있으면 그 고리의 빼기는 settled가 아니다.
      assert.equal(
        view.removed.every((x) => x.settled),
        e.settled,
        row.name,
      );
      assert.deepEqual(viewOf(view.keep, [root(e.root)]), view, row.name);
    }
  }
});

function mesh(cs: Computer[]): RosterStatement[] {
  return cs.flatMap((one) =>
    cs.map((other) => signed(computerEntry(one), other)),
  );
}

function out(from: Computer, gone: Computer): RosterStatement {
  return signed(removeComputer(gone), from);
}

function deviceKeys(view: ReturnType<typeof rosterView>): string[] {
  return view.devices.map((d) => d.body.key);
}

test("엇갈린 빼기에 걸린 key를 사람이 다시 빼면 빠진 쪽만 남고 뺀 쪽이 돌아온다", () => {
  const [x, y, r] = [computer(), computer(), computer()];
  // 사람이 X에서 R을 뺐다. 그 소식이 Y에 닿기 전에 도둑이 R로 X와 Y를 뺀 것이 같이 닿았다.
  const before = [...mesh([x, y, r]), out(x, r), out(r, y), out(r, x)];
  const disputed = viewOf(before, [root(y)]);
  assert.deepEqual(deviceKeys(disputed), [y.key]);
  assert.deepEqual(
    disputed.removed
      .map((one) => [one.entry?.id, one.settled])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [x.id, r.id].sort().map((id) => [id, false]),
  );
  assert.deepEqual(viewOf(disputed.keep, [root(y)]), disputed);
  // Y의 사람이 R을 다시 뺀다(Y가 서명한 빼기). X에서는 처음부터 R만 빠졌다.
  const after = [...disputed.keep, out(y, r)];
  for (const at of [y, x]) {
    const view = viewOf(after, [root(at)]);
    assert.deepEqual(deviceKeys(view).sort(), [x.key, y.key].sort());
    assert.deepEqual(
      view.removed.map((one) => [one.entry?.id, one.settled]),
      [[r.id, true]],
    );
    assert.deepEqual(viewOf(view.keep, [root(at)]), view);
  }
});

test("남의 id를 실은 빼기가 그 id의 기기를 지우지 못한다", () => {
  const [x, y, z, r] = [computer(), computer(), computer(), computer()];
  // X가 R을 뺐고, 도둑이 R로 X를 빼며 빼기의 id 칸에 Y의 id를 실었다.
  const forged = signed(removal(y.id, x.key, root(x)), r);
  const statements = [...mesh([x, y, z, r]), out(x, r), forged];
  for (const at of [y, z]) {
    const view = viewOf(statements, [root(at)]);
    assert.ok(deviceKeys(view).includes(y.key), `root ${at === y ? "y" : "z"}`);
    assert.ok(!view.removed.some((one) => one.entry?.id === y.id));
    assert.deepEqual(viewOf(view.keep, [root(at)]), view);
  }
});

test("빠진 서명자가 단 id와 이름은 엇갈린 줄을 바꾸지 못해 다시 빼기가 고른 key를 뺀다", () => {
  const [x, y, r] = [computer(), computer(), computer()];
  // 도둑 R이 빠진 뒤: X를 빼고, 자기와 X의 항목에 같은 가장 작은 id와 서로 바꾼 이름을 단다.
  const low = `dev_0${"0".padStart(25, "0")}`;
  const steer = [
    signed(
      {
        ...removal(low, x.key, root(x)),
        at: "2000-01-01T00:00:00.000Z",
      } as RosterStatement["body"],
      r,
    ),
    signed({ ...computerEntry(r, 50), id: low, name: "X" }, r),
    signed({ ...computerEntry(x, 50), id: low, name: "R-stolen" }, r),
  ];
  const statements = [...mesh([x, y, r]), out(x, r), ...steer];
  const disputed = viewOf(statements, [root(y)]);
  const rows = disputed.removed.map((one) => ({
    key: one.body.key,
    id: one.entry?.id,
    name: one.entry?.name,
  }));
  assert.deepEqual(
    rows.sort((a, b) => a.key.localeCompare(b.key)),
    [
      { key: x.key, id: x.id, name: "computer" },
      { key: r.key, id: r.id, name: "computer" },
    ].sort((a, b) => a.key.localeCompare(b.key)),
  );
  // 사람이 R의 줄을 고르면 Y는 R의 key로 뺀다. X가 돌아오고 R만 빠진다.
  const after = viewOf([...disputed.keep, out(y, r)], [root(y)]);
  assert.deepEqual(deviceKeys(after).sort(), [x.key, y.key].sort());
  assert.deepEqual(
    after.removed.map((one) => [one.body.key, one.settled]),
    [[r.key, true]],
  );
});

test("빠진 도둑이 구경꾼의 서명 key를 단 항목을 서명해도 구경꾼은 도둑을 엇갈린 줄로 보고 다시 뺀다", () => {
  const [x, y, r] = [computer(), computer(), computer()];
  // R은 빠진 뒤 X를 빼고, 자기 host key에 Y의 서명 key를 단 항목을 서명한다.
  const forged = signed({ ...computerEntry(r, 7), signing_key: root(y) }, r);
  const statements = [...mesh([x, y, r]), out(x, r), out(r, x), forged];
  const disputed = viewOf(statements, [root(y)]);
  assert.deepEqual(
    disputed.removed.map((one) => [one.body.key, one.settled]).sort(),
    [
      [x.key, false],
      [r.key, false],
    ].sort(),
  );
  const after = viewOf([...disputed.keep, out(y, r)], [root(y)]);
  assert.deepEqual(deviceKeys(after).sort(), [x.key, y.key].sort());
  assert.deepEqual(
    after.removed.map((one) => [one.body.key, one.settled]),
    [[r.key, true]],
  );
});

test("저장한 컴퓨터가 모두 도둑에게 맞빼기를 당한 폰이 컴퓨터들이 다시 뺀 뒤 그 컴퓨터들을 다시 믿는다", () => {
  const [x, y, r] = [computer(), computer(), computer()];
  const roots = [root(x), root(y), root(r)];
  // X가 R을 뺐고 도둑 R이 X와 Y를 뺐다. 폰은 셋을 다 저장했다: 아무도 믿지 못하고 아무것도 정해지지 않는다.
  const stuck = [...mesh([x, y, r]), out(x, r), out(r, x), out(r, y)];
  const before = viewOf(stuck, roots);
  assert.deepEqual(deviceKeys(before), []);
  assert.ok(before.removed.every((one) => !one.settled));
  // Y의 사람이 R을 다시 뺐다. R이 아닌 저장한 컴퓨터(X, Y)가 모두 R을 뺐으므로 폰은 그것을 따른다. 어느 순서로 받아도 같다.
  const resolved = [...stuck, out(y, r)];
  for (const order of [resolved, [...resolved].reverse()]) {
    const view = viewOf(order, roots);
    assert.deepEqual(deviceKeys(view).sort(), [x.key, y.key].sort());
    assert.deepEqual(
      view.removed.map((one) => [one.body.key, one.settled]),
      [[r.key, true]],
    );
    assert.deepEqual(viewOf(view.keep, roots), view);
  }
});

test("쓰인 초대장으로 든 기기를 뺀 뒤에도 그 초대장으로 다른 key가 들지 못한다", () => {
  const { a, b, base } = pair();
  const made = inviteOf(a);
  const phone = { id: newId(), key: phoneKey() };
  const statements = [
    ...base,
    signed(phoneEntry(phone.id, phone.key, 1, made.invite.body.key), a),
    signed(phoneEntry(phone.id, phone.key, 1, made.invite.body.key), b),
    signed(removal(phone.id, phone.key), a),
  ];
  const now = Date.parse(EXPIRES) - 1;
  const thief = invitedWith(made, phoneEntry(newId(), phoneKey()));
  for (const at of [a, b]) {
    const view = viewOf(statements, [root(at)]);
    for (const v of [view, viewOf(view.keep, [root(at)])]) {
      const checked = checkInvited(thief, { now, view: v });
      assert.equal(checked.ok, false);
      if (!checked.ok) assert.equal(checked.error.details?.reason, "used");
    }
  }
});

test("컴퓨터가 자기 항목에 다른 기기의 초대 key를 달아도 그 기기를 빼지 못한다", () => {
  const { a, b, base } = pair();
  const r = computer();
  const q = { id: newId(), key: phoneKey() };
  const qInvite = inviteOf(a);
  // R이 믿는 동안 자기 항목에 Q의 초대 key를 달았고 A와 B가 같이 서명했다. 그 뒤 A가 R을 뺐다.
  const claim = { ...computerEntry(r, 2), invite: qInvite.invite.body.key };
  const statements = [
    ...base,
    signed(computerEntry(r), a),
    signed(computerEntry(r), r),
    signed(phoneEntry(q.id, q.key, 1, qInvite.invite.body.key), a),
    signed(phoneEntry(q.id, q.key, 1, qInvite.invite.body.key), b),
    signed(claim, r),
    signed(claim, a),
    signed(claim, b),
    out(a, r),
  ];
  for (const at of [a, b]) {
    const view = viewOf(statements, [root(at)]);
    assert.ok(deviceKeys(view).includes(q.key));
    assert.deepEqual(view.conflicts, []);
  }
});

test("폰이 도둑과 구경꾼 컴퓨터를 저장했어도 도둑만 믿게 되지 않고, 다시 뺀 컴퓨터를 따른다", () => {
  const [x, y, r, z] = [computer(), computer(), computer(), computer()];
  // X가 R을 뺐고 도둑 R이 X와 Y를 뺐다. 폰은 Y와 R을 저장했다.
  const statements = [...mesh([x, y, r, z]), out(x, r), out(r, x), out(r, y)];
  const phone = viewOf(statements, [root(y), root(r)]);
  assert.ok(!deviceKeys(phone).includes(r.key));
  assert.ok(phone.removed.every((one) => !one.settled));
  // R이 빼지 않은 Z가 R을 다시 뺐다. Z도 저장한 폰은 그 결정을 따른다.
  const resolved = viewOf(
    [...statements, out(z, r)],
    [root(y), root(r), root(z)],
  );
  assert.deepEqual(deviceKeys(resolved).sort(), [x.key, y.key, z.key].sort());
  assert.deepEqual(
    resolved.removed.map((one) => [one.body.key, one.settled]),
    [[r.key, true]],
  );
});

test("모르는 서명자의 항목이 상한에 닿아도 빼기가 저장된다", () => {
  const { a, b, base } = pair();
  const phone = { id: newId(), key: phoneKey() };
  const gone = signed(removal(phone.id, phone.key), a);
  const trusted = [...base, signed(phoneEntry(phone.id, phone.key), a), gone];
  // 붙은 기기가 모르는 id로 서명했다는 항목 수천 개를 민다. 서명자를 모르니 서명은 검증되지 않는다.
  const junkKey = phoneKey();
  const signature = (base[0] as { signature: string }).signature;
  const junk: RosterStatement[] = Array.from({ length: 5000 }, () => ({
    body: phoneEntry(newId(), junkKey),
    by: newId(),
    signature,
  }));
  for (const at of [a, b]) {
    const view = viewOf([...junk, ...trusted], [root(at)]);
    const kept = new Set(view.keep.map((s) => JSON.stringify(s)));
    for (const s of [...base, gone]) assert.ok(kept.has(JSON.stringify(s)));
    assert.equal(
      view.keep.filter((s) => junk.includes(s)).length,
      ROSTER_UNKNOWN_MAX,
    );
    assert.ok(view.keep.length <= ROSTER_STATEMENTS_MAX);
  }
});

test("빠진 컴퓨터가 서명한 것으로는 저장 상한에 닿지 못하고 믿는 컴퓨터의 빼기는 저장된다", () => {
  const { a, b, base } = pair();
  const r = computer();
  const phone = { id: newId(), key: phoneKey() };
  // R은 믿는 동안이나 빠진 뒤에 아무 key의 빼기와 컴퓨터 항목, 자기가 낸 초대장의 초대 서명 statement를 많이 서명했다.
  const flood: RosterStatement[] = [];
  for (let i = 0; i < 300; i++) {
    flood.push(signed(removal(newId(), phoneKey()), r));
    flood.push(signed(computerEntry(computer()), r));
    // 아는 key(폰)에 모르는 서명 key를 단 빼기.
    flood.push(signed(removal(phone.id, phone.key, root(computer())), r));
  }
  for (let i = 0; i < 60; i++) {
    flood.push(invitedWith(inviteOf(r), phoneEntry(newId(), phoneKey())));
  }
  // R이 스스로 서명한 자기 항목도 R의 것이라 상한 안이다.
  flood.push(signed(computerEntry(r), r));
  const gone = signed(removal(phone.id, phone.key), a);
  const honest = [
    ...base,
    signed(computerEntry(r), a),
    signed(computerEntry(r), b),
    signed(phoneEntry(phone.id, phone.key), a),
    out(a, r),
    gone,
  ];
  for (const at of [a, b]) {
    const view = viewOf([...flood, ...honest], [root(at)]);
    const kept = new Set(view.keep.map((s) => JSON.stringify(s)));
    for (const s of honest) assert.ok(kept.has(JSON.stringify(s)));
    // R이 서명한 것은 상한 안이다: 믿는 쪽이 쓴 것 말고는 ROSTER_UNKNOWN_MAX를 넘지 않는다.
    assert.ok(view.keep.length <= honest.length + ROSTER_UNKNOWN_MAX);
    assert.ok(deviceKeys(view).includes(a.key));
    assert.deepEqual(
      view.removed.map((one) => one.body.key).sort(),
      [phone.key, r.key].sort(),
    );
  }
});

test("상한을 넘는 statement가 있어도 keep만으로 다시 계산하면 같은 view다", () => {
  const { a, base } = pair();
  const signature = (base[0] as { signature: string }).signature;
  // 가장 작은 id를 단 쓰레기가 앞서 상한을 채운다. 모르는 컴퓨터가 낸 초대장의 초대 서명 statement는 그 뒤에 밀려난다.
  const junk: RosterStatement[] = Array.from({ length: 600 }, (_, i) => ({
    body: phoneEntry(`dev_0${String(i).padStart(25, "0")}`, phoneKey()),
    by: newId(),
    signature,
  }));
  const stranger = invitedWith(
    inviteOf(computer()),
    phoneEntry(newId(), phoneKey()),
  );
  const view = viewOf([...junk, stranger, ...base], [root(a)]);
  assert.deepEqual(view.invites, []);
  assert.deepEqual(viewOf(view.keep, [root(a)]), view);
});

test("두 명단을 어느 순서로 합쳐도 같은 명단이 된다", () => {
  const { a, b, base } = pair();
  const key = phoneKey();
  const onA = newId();
  const onB = newId();
  const other = newId();
  const otherKey = phoneKey();
  // 같은 폰이 A와 B에서 다른 id로 pairing되어 있었고 B에서 이름을 바꿨다. 다른 폰은 같은 rev에서 A가 터미널 입력을
  // 거두고 B가 이름을 바꿨다.
  const folds = [
    ...base,
    signed(phoneEntry(onA, key), a),
    signed({ ...phoneEntry(onB, key, 2), name: "renamed on B" }, b),
    signed({ ...phoneEntry(other, otherKey), terminal_input: true }, a),
    signed({ ...phoneEntry(other, otherKey, 2), terminal_input: false }, a),
    signed(
      { ...phoneEntry(other, otherKey, 2), terminal_input: true, name: "B" },
      b,
    ),
    signed(removal(newId(), phoneKey()), b),
  ];
  // dual boot: B는 A의 긴 초대장으로 들었고 A는 아직 모른다. B의 초대 서명 statement가 A로 가야 한다.
  const longInvite = inviteOf(a, { kind: "computer", terminal: true });
  const dualBoot = [
    signed(computerEntry(a), a),
    signed(computerEntry(a), b),
    signed(computerEntry(b, 2), b),
    invitedWith(longInvite, computerEntry(b, 2)),
  ];
  // C는 B만 서명했고 C가 스스로 rev 2에 서명했다. 사슬(B가 서명한 rev 1)이 남아야 한다.
  const c = computer();
  const chain = [
    ...base,
    signed(computerEntry(c), b),
    signed(computerEntry(c), c),
    signed({ ...computerEntry(c, 2), name: "renamed" }, c),
    signed(phoneEntry(newId(), phoneKey()), c),
  ];
  // 한 초대장으로 다른 key 둘이 각각 다른 컴퓨터에서 들었다. A의 id를 단 폰이 B의 서명으로 들었다.
  const shared = inviteOf(a);
  const twice = [phoneKey(), phoneKey()];
  const idThief = phoneKey();
  const conflicts = [
    ...base,
    signed(
      phoneEntry(newId(), twice[0] as string, 1, shared.invite.body.key),
      a,
    ),
    signed(
      phoneEntry(newId(), twice[1] as string, 1, shared.invite.body.key),
      b,
    ),
    signed(phoneEntry(a.id, idThief), b),
  ];
  // 폰이 A의 초대 iOld로 들었고 B의 초대 iNew로 rev 2가 되었다. iOld가 쓰였다는 것이 남아야 한다.
  const iOld = inviteOf(a);
  const iNew = inviteOf(b);
  const moved = { id: newId(), key: phoneKey() };
  const reinvited = [
    ...base,
    signed(phoneEntry(moved.id, moved.key, 1, iOld.invite.body.key), a),
    signed(phoneEntry(moved.id, moved.key, 2, iNew.invite.body.key), a),
    signed(phoneEntry(moved.id, moved.key, 2, iNew.invite.body.key), b),
  ];
  // A가 R을 뺐고 R은 그 뒤 B와 D를 뺐다(효력 없음).
  const r = computer();
  const d = computer();
  const thief = [
    ...base,
    ...[r, d].flatMap((x) => [
      signed(computerEntry(x), a),
      signed(computerEntry(x), x),
    ]),
    signed(removeComputer(r), a),
    signed(removeComputer(d), r),
    signed(removeComputer(b), r),
  ];
  const scenarios = [
    {
      name: "옛 rev의 초대",
      statements: reinvited,
      roots: [root(b)],
      check(view: ReturnType<typeof rosterView>) {
        assert.ok(view.invites.some((u) => u.invite === iOld.invite.body.key));
      },
    },
    {
      name: "뺀 컴퓨터의 빼기",
      statements: thief,
      roots: [root(a)],
      check(view: ReturnType<typeof rosterView>) {
        assert.deepEqual(
          view.devices.map((x) => x.body.key).sort(),
          [a.key, b.key, d.key].sort(),
        );
      },
    },
    {
      name: "접기와 같은 rev",
      statements: folds,
      roots: [root(a)],
      check(view: ReturnType<typeof rosterView>) {
        const phone = view.devices.find((d) => d.body.key === key);
        assert.equal(phone?.body.id, onA);
        assert.equal(phone?.body.name, "renamed on B");
        assert.deepEqual(view.folded, [{ from: onB, to: onA }]);
        const revoked = view.devices.find((d) => d.body.key === otherKey);
        assert.equal(revoked?.body.terminal_input, false);
        assert.deepEqual(viewOf(folds, [root(b)]).devices, view.devices);
      },
    },
    {
      name: "혼자인 컴퓨터",
      statements: [signed(computerEntry(a), a)],
      roots: [root(a)],
      check(view: ReturnType<typeof rosterView>) {
        assert.ok(!rosterPending(view, a.key));
      },
    },
    {
      name: "dual boot의 B",
      statements: dualBoot,
      roots: [root(b)],
      check(view: ReturnType<typeof rosterView>) {
        assert.ok(view.keep.some((s) => !("by" in s)));
        assert.ok(rosterPending(view, b.key));
        assert.ok(!rosterPending(view, a.key));
      },
    },
    {
      name: "스스로 서명한 새 rev",
      statements: chain,
      roots: [root(a)],
      check(view: ReturnType<typeof rosterView>) {
        assert.equal(
          view.devices.find((d) => d.body.key === c.key)?.body.name,
          "renamed",
        );
        assert.equal(view.devices.length, 4);
      },
    },
    {
      name: "충돌은 둘 다 뺀다",
      statements: conflicts,
      roots: [root(a)],
      check(view: ReturnType<typeof rosterView>) {
        const keys = view.devices.map((d) => d.body.key);
        assert.ok(keys.includes(a.key));
        for (const k of [...twice, idThief])
          assert.ok(!keys.includes(k as string));
        assert.deepEqual(view.conflicts.map((x) => x.reason).sort(), [
          "id",
          "invite",
          "invite",
        ]);
      },
    },
  ];
  for (const s of scenarios) {
    const half = Math.floor(s.statements.length / 2);
    const orders = [
      [s.statements],
      [s.statements.slice(half), s.statements.slice(0, half)],
      [[...s.statements].reverse()],
      [
        s.statements.filter((_, i) => i % 2 === 0),
        s.statements.filter((_, i) => i % 2 === 1),
        s.statements,
      ],
    ];
    const merged = orders.map((lists) => mergeRoster(...lists));
    for (const m of merged) assert.deepEqual(m, merged[0], s.name);
    const views = orders.map((lists) => viewOf(lists.flat(), s.roots));
    for (const v of views) assert.deepEqual(v, views[0], s.name);
    const view = views[0] as ReturnType<typeof rosterView>;
    s.check(view);
    // keep만으로 다시 계산해도 같은 view다(저장하고 나른 뒤에도 명단이 그대로다).
    assert.deepEqual(viewOf(view.keep, s.roots), view, s.name);
  }
  // 무작위로 지은 명단(고정 seed): 항목, 접히는 id, 모양이 다른 항목, 초대 서명 statement, 컴퓨터와 폰의 빼기를 섞는다.
  // 어느 root로 보아도 순서를 뒤집어도, keep만으로 다시 계산해도 같은 view다.
  let state = 12345;
  const roll = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
  const pick = <T>(xs: T[]) => xs[Math.floor(roll() * xs.length)] as T;
  for (let round = 0; round < 25; round++) {
    const cs = [computer(), computer(), computer(), computer()];
    const phones = [0, 1, 2].map(() => ({
      ids: [newId(), newId()],
      key: phoneKey(),
    }));
    const invites = cs.map((c) => inviteOf(c));
    const statements: RosterStatement[] = cs
      .filter(() => roll() < 0.8)
      .map((c) => signed(computerEntry(c), c));
    for (let k = 0; k < 14; k++) {
      const by = pick(cs);
      const p = pick(phones);
      const rev = 1 + Math.floor(roll() * 3);
      const r = roll();
      if (r < 0.3) {
        statements.push(
          signed({ ...computerEntry(pick(cs), rev), name: `n${rev}` }, by),
        );
      } else if (r < 0.55) {
        const invite = roll() < 0.4 ? pick(invites).invite.body.key : null;
        statements.push(
          signed(
            {
              ...phoneEntry(pick(p.ids), p.key, rev, invite),
              terminal_input: roll() < 0.5,
            },
            by,
          ),
        );
      } else if (r < 0.62) {
        statements.push(
          signed(
            {
              ...phoneEntry(pick(p.ids), p.key, rev),
              kind: "computer",
              os: "linux",
              signing_key: root(by),
              machine: `mch_0${by.id.slice(5)}`,
            },
            by,
          ),
        );
      } else if (r < 0.72) {
        statements.push(
          invitedWith(pick(invites), phoneEntry(pick(p.ids), p.key, rev)),
        );
      } else if (r < 0.88) {
        statements.push(signed(removeComputer(pick(cs)), by));
      } else {
        statements.push(signed(removal(pick(p.ids), p.key), by));
      }
    }
    for (const roots of [...cs.map((c) => [root(c)]), cs.map(root)]) {
      const view = viewOf(statements, roots);
      assert.deepEqual(viewOf([...statements].reverse(), roots), view);
      assert.deepEqual(viewOf(view.keep, roots), view, `round ${round}`);
    }
  }
});

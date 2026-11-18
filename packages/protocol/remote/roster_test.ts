import assert from "node:assert/strict";
import { test } from "node:test";
import { seededRandom } from "../../base/mod.ts";
import { generateKeyPair, type KeyPair, remoteKeyText } from "./noise.ts";
import {
  checkInvited,
  generateSigningKey,
  mergeRoster,
  ROSTER_INVITE_LONG_MS,
  type RosterEntryBody,
  type RosterInvitedStatement,
  type RosterStatement,
  rosterPending,
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
  return rosterView(statements, roots).devices.map((d) => d.body.key);
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
  const view0 = rosterView(
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
  const view = rosterView(known, [root(a)]);
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
  const before = rosterView(
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
      const view = rosterView(row.statements, roots);
      const keys = view.devices.map((d) => d.body.key);
      for (const k of row.gone) assert.ok(!keys.includes(k), row.name);
      assert.ok(keys.includes(a.key) && keys.includes(b.key), row.name);
      // keep만으로 다시 계산해도 빼기가 남는다.
      const again = rosterView(view.keep, roots);
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
    const view = rosterView(all, roots);
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
  // 빠진 C가 효력 없는 빼기를 B에 걸어도 B가 혼자 하는 빼기는 효력이 있다.
  const x = computer();
  const blocked = [
    ...base,
    ...cJoined,
    signed(computerEntry(x), a),
    signed(removeComputer(c), a),
    signed(removeComputer(b), c),
    signed(removeComputer(x), b),
  ];
  const left = keysOf(blocked, [root(a)]);
  assert.deepEqual(
    [b.key, c.key, x.key].map((k) => left.includes(k)),
    [true, false, false],
  );
  // 서로 뺐으면 둘 다 빠진다(뺀 쪽은 다시 초대받는다).
  const mutual = [
    ...base,
    ...cJoined,
    signed(removeComputer(c), b),
    signed(removeComputer(b), c),
  ];
  const keys = keysOf(mutual, [root(a)]);
  assert.deepEqual(
    [keys.includes(a.key), keys.includes(b.key), keys.includes(c.key)],
    [true, false, false],
  );
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
  // 뺀 컴퓨터 R이 빠진 뒤 B를 뺐고(효력 없음), R과 D는 서로 뺐다(둘 다 빠진다).
  const r = computer();
  const d = computer();
  const thief = [
    ...base,
    ...[r, d].flatMap((x) => [
      signed(computerEntry(x), a),
      signed(computerEntry(x), x),
    ]),
    signed(removeComputer(r), d),
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
          [a.key, b.key].sort(),
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
        assert.deepEqual(rosterView(folds, [root(b)]).devices, view.devices);
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
    const views = orders.map((lists) => rosterView(lists.flat(), s.roots));
    for (const v of views) assert.deepEqual(v, views[0], s.name);
    const view = views[0] as ReturnType<typeof rosterView>;
    s.check(view);
    // keep만으로 다시 계산해도 같은 view다(저장하고 나른 뒤에도 명단이 그대로다).
    assert.deepEqual(rosterView(view.keep, s.roots), view, s.name);
  }
});

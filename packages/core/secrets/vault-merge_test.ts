import assert from "node:assert/strict";
import { test } from "node:test";

import type { VaultProfile } from "../../protocol/secrets/mod.ts";
import {
  mergeVaults,
  planMerge,
  type ValuedLogin,
  type VaultState,
} from "./vault-merge.ts";

const P1 = `bpf_${"1".repeat(26)}`;
const P2 = `bpf_${"2".repeat(26)}`;
const L1 = `lgn_${"1".repeat(26)}`;
const L2 = `lgn_${"2".repeat(26)}`;
const L3 = `lgn_${"3".repeat(26)}`;

const revs = (at: number) => ({
  label: at,
  origin: at,
  username: at,
  note: at,
  password: at,
  totp: at,
});
const login = (
  id: string,
  at: number,
  extra: Partial<ValuedLogin> = {},
): ValuedLogin => ({
  id,
  label: "Mail",
  origin: "https://mail.example",
  username: "me@example.com",
  note: "",
  revs: revs(at),
  password: `pw-${id}`,
  totp: null,
  ...extra,
});
const profile = (id: string, name: string, at: number): VaultProfile => ({
  id,
  name,
  color: "sage",
  revs: { name: at, color: at },
});
const state = (part: Partial<VaultState>): VaultState => ({
  profiles: [],
  logins: [],
  removed: [],
  ...part,
});
const sorted = (merged: VaultState) => ({
  profiles: [...merged.profiles].sort((a, b) => a.id.localeCompare(b.id)),
  logins: [...merged.logins].sort((a, b) => a.id.localeCompare(b.id)),
  removed: [...merged.removed].sort((a, b) => a.id.localeCompare(b.id)),
});
// 두 컴퓨터가 서로를 받아 합친 결과는 같아야 한다.
function both(a: VaultState, b: VaultState): VaultState {
  const ab = mergeVaults(a, b);
  assert.deepEqual(sorted(ab), sorted(mergeVaults(b, a)));
  // 같은 것을 다시 받아도 바뀌지 않는다.
  assert.deepEqual(sorted(mergeVaults(ab, b)), sorted(ab));
  assert.deepEqual(sorted(mergeVaults(ab, ab)), sorted(ab));
  return ab;
}

// 깨지면 나누기를 켠 첫 합치기에서 한쪽 컴퓨터의 login이나 profile이 사라진다.
test("처음 합치기는 합집합이고 같은 이름의 profile도 둘로 남는다", () => {
  const a = state({
    profiles: [profile(P1, "Work", 0)],
    logins: [login(L1, 0, { profile: P1 })],
  });
  const b = state({
    profiles: [profile(P2, "Work", 0)],
    logins: [login(L2, 0), login(L3, 0, { profile: P2 })],
  });
  const merged = both(a, b);
  assert.deepEqual(
    merged.profiles.map((p) => p.id),
    [P1, P2],
  );
  assert.deepEqual(
    merged.logins.map((l) => [l.id, l.password]),
    [
      [L1, `pw-${L1}`],
      [L2, `pw-${L2}`],
      [L3, `pw-${L3}`],
    ],
  );
});

// 깨지면 떨어져 있는 동안 두 컴퓨터가 한 login을 고친 것 가운데 하나가 말없이 사라진다(바꾼 password가 옛 것으로 돌아간다).
test("떨어져 고친 다른 칸은 둘 다 남고 같은 칸은 나중 것이 남는다", () => {
  const a = state({
    logins: [
      login(L1, 10, {
        password: "new-on-a",
        revs: { ...revs(10), password: 20 },
      }),
    ],
  });
  const b = state({
    logins: [
      login(L1, 10, {
        note: "edited on b",
        username: "b@example.com",
        revs: { ...revs(10), note: 25, username: 15 },
      }),
    ],
  });
  const a2 = state({
    logins: [
      login(L1, 10, {
        password: "new-on-a",
        username: "a@example.com",
        revs: { ...revs(10), password: 20, username: 30 },
      }),
    ],
  });
  const [merged] = both(a, b).logins;
  assert.equal(merged!.password, "new-on-a");
  assert.equal(merged!.note, "edited on b");
  assert.equal(both(a2, b).logins[0]!.username, "a@example.com");
});

// 깨지면 한 컴퓨터가 지우는 사이 다른 컴퓨터에서 고친 login이 말없이 사라진다.
test("지울 때 몰랐던 고침이 있으면 login이 되살아나고, 없으면 지운 것이 이긴다", () => {
  const base = login(L1, 10);
  const deleted = state({
    removed: [{ id: L1, at: 40, seen: { ...base.revs } }],
  });
  const edited = state({
    logins: [{ ...base, note: "later", revs: { ...base.revs, note: 30 } }],
  });
  const revived = both(deleted, edited);
  assert.deepEqual(
    revived.logins.map((l) => [l.id, l.note, l.password]),
    [[L1, "later", `pw-${L1}`]],
  );
  assert.deepEqual(revived.removed, []);

  const untouched = both(deleted, state({ logins: [base] }));
  assert.deepEqual(untouched.logins, []);
  assert.deepEqual(
    untouched.removed.map((r) => r.id),
    [L1],
  );
});

// 깨지면 지운 profile에 다른 컴퓨터가 새로 저장한 login이 보이지 않는 profile에 묶여 사라지거나 다른 cookie의 profile로 떨어진다.
test("profile을 지울 때 몰랐던 login이 있으면 profile이 되살아나고 지운 login은 지운 채다", () => {
  const work = profile(P1, "Work", 10);
  const known = login(L1, 10, { profile: P1 });
  const a = state({
    removed: [
      { id: L1, at: 50, seen: { ...known.revs } },
      { id: P1, at: 50, seen: { ...work.revs } },
    ],
  });
  const b = state({
    profiles: [work],
    logins: [known, login(L2, 45, { profile: P1 })],
  });
  const merged = both(a, b);
  assert.deepEqual(
    merged.profiles.map((p) => p.id),
    [P1],
  );
  assert.deepEqual(
    merged.logins.map((l) => l.id),
    [L2],
  );
  assert.deepEqual(
    merged.removed.map((r) => r.id),
    [L1],
  );
});

test("합치기가 지운 profile은 partition data를 지울 목록에 들고 되살아나면 빠진다", () => {
  const work = profile(P1, "Work", 10);
  const local = {
    format: 1 as const,
    profiles: [work],
    logins: [],
    removed: [],
    clear: [],
  };
  const remote = state({
    removed: [{ id: P1, at: 50, seen: { ...work.revs } }],
  });
  const plan = planMerge(local, () => ({ password: null, totp: null }), remote);
  assert.deepEqual(plan.vault.clear, [P1]);
  assert.deepEqual(plan.vault.profiles, []);
  const back = planMerge(
    { ...plan.vault, clear: [P1] },
    () => ({ password: null, totp: null }),
    state({
      profiles: [{ ...work, name: "Work 2", revs: { name: 60, color: 10 } }],
    }),
  );
  assert.deepEqual(back.vault.clear, []);
  assert.deepEqual(
    back.vault.profiles.map((p) => p.name),
    ["Work 2"],
  );
});

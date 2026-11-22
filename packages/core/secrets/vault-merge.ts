// 두 컴퓨터의 vault를 합친다. 순수 함수다: 값 쓰기와 file 쓰기는 부르는 쪽(vault-sync.ts)이 한다.
//
// 규칙:
// - 칸마다 stamp가 큰 쪽이 이긴다(같으면 값이 있는 쪽, 둘 다 있으면 값의 글자 순서가 큰 쪽). 그래서 떨어져 있는 동안 두 컴퓨터가 같은 login의 다른 칸을
//   고쳐도 둘 다 남고, 같은 칸을 고치면 나중에 친 값이 남는다. password·TOTP seed는 metadata와 같이 칸이다.
// - 지운 것의 흔적은 지울 때 본 칸 stamp(`seen`)를 든다. 어느 칸이든 그보다 새 사본이 있으면(지운 컴퓨터가 몰랐던 고침)
//   그 항목은 되살아나고 흔적이 빠진다. 그렇지 않으면 지운 것이 이긴다. 그래서 고친 login이 말없이 사라지지 않는다.
// - 지운 profile에 살아 있는 login이 있으면(지운 컴퓨터가 몰랐던 login) profile도 되살아난다: login이 다른 cookie의
//   profile로 떨어지지 않게 한다.
// - 처음 합칠 때는 흔적이 없고 id가 컴퓨터마다 달라 합집합이다. 같은 이름의 profile도 둘로 남는다.
import {
  LOGIN_META_FIELDS,
  LOGIN_VALUE_FIELDS,
  PROFILE_FIELDS,
  type VaultFile,
  type VaultLogin,
  type VaultProfile,
  type VaultRemoved,
} from "../../protocol/secrets/mod.ts";

export type LoginValues = { password: string | null; totp: string | null };
export type ValuedLogin = VaultLogin & LoginValues;
/** 한 컴퓨터의 vault와 그 login 값. `exchange`가 내는 모양이다. */
export type VaultState = {
  profiles: VaultProfile[];
  logins: ValuedLogin[];
  removed: VaultRemoved[];
};

const LOGIN_FIELDS_ALL = [...LOGIN_META_FIELDS, ...LOGIN_VALUE_FIELDS];

type Revs = Record<string, number>;
type Item = { id: string; revs: Revs } & Record<string, unknown>;

// 같은 stamp면 값이 있는 쪽이 이긴다: 값은 더 새 stamp로만 지워진다(못 읽은 값이 "없음"으로 와도 지우지 않는다). 둘 다
// 값이면 JSON 글자가 큰 쪽이다. 어느 컴퓨터에서 합쳐도 같은 쪽을 고른다.
function newer(a: Item, b: Item, field: string): boolean {
  const ra = a.revs[field] ?? -1;
  const rb = b.revs[field] ?? -1;
  if (ra !== rb) return ra > rb;
  const va = a[field] ?? null;
  const vb = b[field] ?? null;
  if (va === null || vb === null) return vb === null;
  return JSON.stringify(va) >= JSON.stringify(vb);
}

function mergeItem<T extends Item>(
  a: T | undefined,
  b: T | undefined,
  fields: readonly string[],
): T | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  const out: Record<string, unknown> = { ...a, revs: { ...a.revs } };
  for (const field of fields) {
    const win = newer(a, b, field) ? a : b;
    out[field] = win[field];
    (out.revs as Revs)[field] = win.revs[field]!;
  }
  return out as T;
}

function mergeRemoved(
  a: VaultRemoved | undefined,
  b: VaultRemoved | undefined,
): VaultRemoved | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  const seen: Revs = { ...a.seen };
  for (const [field, stamp] of Object.entries(b.seen)) {
    seen[field] = Math.max(seen[field] ?? -1, stamp);
  }
  return { id: a.id, at: Math.max(a.at, b.at), seen };
}

// 흔적이 본 것보다 새 칸이 있으면 살아 있다.
function outlives(item: Item, removed: VaultRemoved): boolean {
  return Object.entries(item.revs).some(
    ([field, stamp]) => stamp > (removed.seen[field] ?? -1),
  );
}

// 앞 목록의 순서를 두고 뒤에만 있는 id를 뒤에 붙인다.
function ids(
  a: readonly { id: string }[],
  b: readonly { id: string }[],
): string[] {
  return [...new Set([...a.map((x) => x.id), ...b.map((x) => x.id)])];
}

const byId = <T extends { id: string }>(list: readonly T[]) =>
  new Map(list.map((x) => [x.id, x]));

export function mergeVaults(local: VaultState, remote: VaultState): VaultState {
  const removedA = byId(local.removed);
  const removedB = byId(remote.removed);
  const removed = new Map<string, VaultRemoved>();
  for (const id of ids(local.removed, remote.removed)) {
    removed.set(id, mergeRemoved(removedA.get(id), removedB.get(id))!);
  }

  const loginsA = byId(local.logins);
  const loginsB = byId(remote.logins);
  const logins: ValuedLogin[] = [];
  for (const id of ids(local.logins, remote.logins)) {
    const item = mergeItem(
      loginsA.get(id) as (ValuedLogin & Item) | undefined,
      loginsB.get(id) as (ValuedLogin & Item) | undefined,
      LOGIN_FIELDS_ALL,
    )!;
    const gone = removed.get(id);
    if (gone !== undefined && !outlives(item, gone)) continue;
    removed.delete(id);
    logins.push(item);
  }

  const profilesA = byId(local.profiles);
  const profilesB = byId(remote.profiles);
  const used = new Set(logins.map((login) => login.profile));
  const profiles: VaultProfile[] = [];
  for (const id of ids(local.profiles, remote.profiles)) {
    const item = mergeItem(
      profilesA.get(id) as (VaultProfile & Item) | undefined,
      profilesB.get(id) as (VaultProfile & Item) | undefined,
      PROFILE_FIELDS,
    )!;
    const gone = removed.get(id);
    if (gone !== undefined && !outlives(item, gone) && !used.has(id)) {
      continue;
    }
    removed.delete(id);
    profiles.push(item);
  }

  return { profiles, logins, removed: [...removed.values()] };
}

/** 이 컴퓨터의 vault와 값으로 합칠 상태를 만든다. */
export function stateOf(
  vault: VaultFile,
  values: (id: string) => LoginValues,
): VaultState {
  return {
    profiles: vault.profiles,
    logins: vault.logins.map((login) => ({ ...login, ...values(login.id) })),
    removed: vault.removed,
  };
}

export type MergePlan = {
  vault: VaultFile;
  // 바뀐 값. null이면 그 이름을 지운다.
  values: { id: string; field: "password" | "totp"; value: string | null }[];
  // vault가 바뀌었는가(file을 다시 쓰고 알린다).
  changed: boolean;
};

/**
 * 이 컴퓨터의 vault·값과 다른 컴퓨터의 상태를 합친 결과와 해야 할 값 쓰기다. 합치기가 지운 profile은 `clear`(shell main이
 * partition data를 지운다)에 더하고, 되살아난 profile은 `clear`에서 뺀다. 기본 profile은 id가 없어 들지 않는다.
 */
export function planMerge(
  vault: VaultFile,
  values: (id: string) => LoginValues,
  remote: VaultState,
): MergePlan {
  const local = stateOf(vault, values);
  const merged = mergeVaults(local, remote);
  const before = byId(local.logins);
  const planned: MergePlan["values"] = [];
  for (const login of merged.logins) {
    const had = before.get(login.id);
    for (const field of LOGIN_VALUE_FIELDS) {
      const value = login[field];
      if ((had?.[field] ?? null) !== value) {
        planned.push({ id: login.id, field, value });
      }
    }
  }
  const profileIds = new Set(merged.profiles.map((profile) => profile.id));
  const clear = [
    ...vault.clear.filter((id) => !profileIds.has(id)),
    ...vault.profiles
      .map((profile) => profile.id)
      .filter((id) => !profileIds.has(id) && !vault.clear.includes(id)),
  ];
  const next: VaultFile = {
    format: 1,
    profiles: merged.profiles,
    logins: merged.logins.map(
      ({ password: _password, totp: _totp, ...login }) => login,
    ),
    removed: merged.removed,
    clear,
  };
  return {
    vault: next,
    values: planned,
    changed: JSON.stringify(next) !== JSON.stringify(vault),
  };
}

// 설치 묶음의 deno.lock이 저장소의 lock에서 새 의존성이나 다른 integrity를 들이지 않았는지 본다
// (platform/security#R5, install-and-update#R4). 묶음은 desktop 화면 build 전용 member를 빼고 lock을
// 다시 쓰므로 항목이 줄 수는 있지만 늘거나 바뀌면 안 된다.

type LockEntries = Record<string, unknown>;
type DenoLock = {
  specifiers?: LockEntries;
  jsr?: LockEntries;
  npm?: LockEntries;
  remote?: LockEntries;
};

export type LockCheck = { ok: true } | { ok: false; changed: string[] };

export function checkStagedLock(source: DenoLock, staged: DenoLock): LockCheck {
  const changed: string[] = [];
  for (const section of ["jsr", "npm", "remote"] as const) {
    const have = source[section] ?? {};
    for (const [key, value] of Object.entries(staged[section] ?? {})) {
      if (JSON.stringify(have[key]) !== JSON.stringify(value)) {
        changed.push(`${section}:${key}`);
      }
    }
  }
  // specifier가 가리키는 정확한 version도 저장소 lock과 같아야 한다.
  const specifiers = source.specifiers ?? {};
  for (const [key, value] of Object.entries(staged.specifiers ?? {})) {
    if (specifiers[key] !== undefined && specifiers[key] !== value) {
      changed.push(`specifiers:${key}`);
    }
  }
  return changed.length === 0 ? { ok: true } : { ok: false, changed };
}

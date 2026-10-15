// 정지 유지보수·restore·I/O worker spec이 같이 쓰는 위치. 이 file 기준 상대 경로다.
export function repoRoot(): string {
  return new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
}

export function denoDir(): string {
  // 설치 묶음은 DENO_DIR로 ~/.cache/lophn/deno를 준다.
  let configured: string | undefined;
  try {
    configured = Deno.env.get("DENO_DIR");
  } catch { /* env 권한이 없는 worker는 spec을 쓰지 않는다 */ }
  if (configured) return configured;
  const home = Deno.env.get("HOME");
  return home ? `${home}/.cache/deno` : "/tmp";
}

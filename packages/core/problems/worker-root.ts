// 등록 시점 env에서 data root를 좁힌다. 없으면 worker spec을 내지 않는다.
export function workerRoot(): string | undefined {
  const lophnHome = Deno.env.get("LOPHN_HOME");
  const home = Deno.env.get("HOME");
  const root = lophnHome && lophnHome.length > 0
    ? lophnHome
    : home
    ? `${home}/.lophn`
    : undefined;
  return root && root.startsWith("/") ? root : undefined;
}

// session의 agent가 쓰는 browser profile을 푼다. host-queue(`tab open --url`, `fill_login`)와 secrets(`logins/list`)가 같이 쓴다.
// 정의의 `browser_profile`이 지금 설정 `shell.browser_profiles`에 없으면(지운 profile) 기본 profile(null)로 떨어진다.
import type { Id } from "../../../../protocol/base/ids.ts";
import type { SettingsReader } from "../../../../protocol/config/mod.ts";
import { browserProfilesSetting } from "../../../config/shell-settings.ts";
import { loadSession } from "../../../lophn-agent/session/model.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { agentDirectory } from "./lophn-agent-team.ts";

export function agentBrowserProfile(
  ctx: { ledgerPath: string; settings: SettingsReader },
  session: string,
): Id<"bpf"> | null {
  const chosen = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
    const row = loadSession(lookup, session);
    return row === undefined
      ? null
      : (agentDirectory(lookup.sql).agent(row.agent)?.browserProfile ?? null);
  });
  if (!chosen.ok || chosen.value === null) return null;
  const known = (ctx.settings.get(browserProfilesSetting) ?? []).some(
    (profile) => profile.id === chosen.value,
  );
  return known ? (chosen.value as Id<"bpf">) : null;
}

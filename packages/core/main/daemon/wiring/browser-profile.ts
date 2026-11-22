// session의 agent가 쓰는 browser profile을 푼다. host-queue(`tab open --url`, `fill_login`), secrets(`logins/list`),
// input-request(login 저장 요청)가 같이 쓴다. 기본 profile(null)이 되는 것은 정의에 칸이 없거나, 적힌 profile이 지금 vault의
// profile 목록에 없을 때(사람이 지웠다)뿐이다. ledger, 정의, vault를 읽지 못하면 기본으로 떨어지지 않고 `unavailable`이다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { type BrowserVault, profilesOf } from "../../../secrets/mod.ts";
import { loadSession } from "../../../lophn-agent/session/model.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { agentDirectory } from "./lophn-agent-team.ts";

// 정의가 고른 profile이 지금 목록에 있으면 그 id, 없으면(지운 profile, 칸 없음) 기본 profile(null)이다. undefined는 정의를
// 읽지 못한 것이라 기본으로 떨어지지 않고 `unavailable`이다.
export function liveBrowserProfile(
  chosen: string | null | undefined,
  profiles: readonly { id: string }[],
): Result<Id<"bpf"> | null> {
  if (chosen === undefined) {
    return err({
      code: "unavailable",
      message:
        "Your agent definition could not be read, so its browser profile is unknown. Tell the person.",
    });
  }
  return ok(
    chosen !== null && profiles.some((profile) => profile.id === chosen)
      ? (chosen as Id<"bpf">)
      : null,
  );
}

export function agentBrowserProfile(
  ctx: { ledgerPath: string; browserVault: BrowserVault },
  session: string,
): Result<Id<"bpf"> | null> {
  const chosen = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
    const row = loadSession(lookup, session);
    return row === undefined
      ? undefined
      : agentDirectory(lookup.sql).agent(row.agent)?.browserProfile;
  });
  const vault = ctx.browserVault.read();
  if (!vault.ok) return vault;
  return liveBrowserProfile(
    chosen.ok ? chosen.value : undefined,
    profilesOf(vault.value),
  );
}

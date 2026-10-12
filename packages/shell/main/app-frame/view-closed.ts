// 폐기되거나 다른 앱으로 교체된 view를 앱 runtime에 알린다. shell은
// 앱 machine 연결이 없으므로 core의 `apps.view_closed`가 그 앱의 지금 live 프로세스에
// `control/view-closed`로 중계한다. 그 뒤 runtime은 그 view_session의 context 조회·주석을
// 받지 않는다. preview 프로세스는 live supervisor 밖이라 보내지 않는다.
import type { CoreCaller } from "./app-connection.ts";
import type { ClosedView } from "./registry.ts";

export function createViewClosedRelay(deps: {
  call: CoreCaller;
  log(line: string): void;
}): (view: ClosedView) => Promise<void> {
  return async (view) => {
    if (view.mode !== "live") return;
    const reply = await deps.call("memory", "apps", "view_closed", {
      app: view.app,
      view_session: view.view_session,
    }).catch(() => ({
      ok: false as const,
      error: { code: "unavailable", message: "core call failed" },
    }));
    // 닿지 못해도 view 폐기는 이미 끝났다. 조용히 삼키지 않고 무엇이 안 갔는지만 남긴다.
    if (!reply.ok) {
      deps.log(
        `view-closed not relayed ${view.view_session} app=${view.app} code=${reply.error.code}`,
      );
    }
  };
}

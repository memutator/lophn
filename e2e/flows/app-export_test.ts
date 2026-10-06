// flow backup-and-restore의 앱 export 단계(apps/data#R13, docs/flows/backup-and-restore.md 4).
// 실제 shell(headless)과 실제 core·documents worker·I/O worker·format runner를 임시
// LOPHN_HOME으로 띄운다. 앱 export 준비 본체(worker/export.ts)와 route 등록(apps.ts
// workerRoutes)은 apps#T28이 냈지만, export worker serving은 core 조립이 아직 안 붙였고
// shell main의 renderer allowlist(READING_WORKER_ROUTES)에 `worker:apps/export`도 아직 없다
// (apps#T28에서 shell#T43 이어보냄). 그래서 이 flow 단계는:
// - 1 등록: 앱 등록은 실제 core 사람 command 길(app.create)로 낸다. 등록 화면은
//   shell#T43 몫이다.
// - export 통로: renderer core 통로(`window.lophnCore`)로 그 앱을 내보내려 하면
//   allowlist가 막아 forbidden으로 닫히는 지금 상태를 본다. 존재를 새지 않는 답이다.
// - export 화면: apps 형제 화면에서 앱을 열고 운영 패널의 Data 탭이 export 단계에서
//   "아직 내보낼 수 없다"를 [Export] 단축 없이 한 문장으로 보이는 것을 본다.
// export 묶음 내용(blueprint·release 이력·bundle 사본·SDK byte·WAL 확정 내용이 담긴
// 확인된 DB 사본, secret 원값·credential 없음)은 실제 core 경로 테스트(apps/core
// app-export_test.ts, packages/apps/data export_test.ts)가 본다. 사람 데이터 root는
// 열지 않는다. Electron은 이 테스트가 띄운 process 그룹만 정리한다.
import { assertEquals, assertStringIncludes } from "@std/assert";

import { e2eEnabled } from "../harness.ts";
import { mustCall, openFlowShell, removeHome } from "../flow-support.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const SLUG = "export-flow";
const NAME = "Export flow app";
const DESCRIPTION = "App export flow fixture app";

Deno.test({
  name:
    "apps/data#R13 flow backup-and-restore: 앱 등록은 실제 사람 command로 열리고 export는 지금 화면·통로에서 막혀 있다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await t.step(
        "apps/data#R13: 1 앱 등록은 core 사람 command로 열린다",
        async () => {
          const created = await mustCall(flow, {
            kind: "command",
            resource: "apps",
            method: "create",
            body: {
              input: {
                id: APP,
                slug: SLUG,
                name: NAME,
                description: DESCRIPTION,
              },
              idempotency_key: "flow-app-export-1",
              compare: {},
              prepared: [],
            },
          });
          assertEquals((created as { slug: string }).slug, SLUG);
        },
      );

      await t.step(
        "apps/data#R13: export를 부르는 renderer 통로는 allowlist가 아직 열지 않아 forbidden이다",
        async () => {
          const reply = await flow.call({
            kind: "worker",
            resource: "apps",
            method: "export",
            body: { app: APP },
          });
          assertEquals(reply.ok, false);
          assertEquals(reply.error?.code, "forbidden");
        },
      );

      await t.step(
        "apps/data#R13: 4 앱 공간의 Data 탭은 export 단계에서 아직 내보낼 수 없다",
        async () => {
          // apps 형제 화면으로 간다.
          await flow.click("[data-screen='apps']");
          await flow.until(
            `document.querySelector("[data-current-screen]")?.getAttribute("data-current-screen") === "apps"`,
            "apps 형제 화면이 서지 않았다",
          );
          await flow.until(
            `document.querySelector("[data-app-row]") !== null`,
            "앱 줄이 서지 않았다",
          );
          // 그 앱을 연다.
          await flow.mouseClickText(
            "[data-app-row] [data-action='open']",
            "Open",
          );
          await flow.until(
            `document.querySelector("[data-space='app'][data-app='${APP}']") !== null`,
            "앱 공간이 서지 않았다",
          );
          // 운영 패널을 연다.
          await flow.click("[data-app-bar='app-details']");
          await flow.until(
            `document.querySelector("[data-ops-panel]") !== null && document.querySelector("[data-app-detail]") !== null`,
            "운영 패널이 서지 않았다",
          );
          // Data 탭을 누른다. Radix Tabs는 mousedown으로 고른다.
          await flow.mouseClickText("[role=tab]", "Data");
          // 탭 몸통은 첫 읽기 300ms 안에 비어 있다(Loading 지연). 문장이 서는 것을 기다린다.
          await flow.until(
            `document.querySelector("[data-tab-body='data'] [data-export-unavailable]") !== null`,
            "Data 탭이 서지 않았다",
          );
          const note = await flow.text(
            "[data-tab-body='data'] [data-export-unavailable]",
          );
          assertStringIncludes(
            note ?? "",
            "Exporting this app's data isn't available yet.",
          );
          // [Export] 단축은 아직 없다.
          assertEquals(await flow.count("[data-tab-body='data'] button"), 0);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
    }
  },
});

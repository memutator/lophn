// lophn-agent flow E2E: manage-provider-connection(docs/flows/manage-provider-connection.md).
// 실제 shell(headless)·core를 임시 LOPHN_HOME으로 띄우고 lophn 공간의 Settings › Providers를 연다.
// provider 하나에는 연결 하나다: 행에는 이름·로그인 방법·[Disconnect]만 있고 계정 목록·순서·끄기·연결
// 테스트는 없으며, Add a provider 목록에는 내장 로컬 항목이 없다.
// - 1: 연결된 provider 행은 이름·로그인 방법·[Disconnect]만 보이고 계정 펼치기나 테스트 단추가 없다.
// - 5: [Disconnect]는 확인 창을 거쳐야 provider를 지운다. 창 제출은 실제 사람 입력이라 이 시험은 창이
//      열렸다는 안내와 확인 창 없는 command가 거절되는 것까지 본다.
// - 6: Add a provider 목록에서 같은 provider를 다시 [+ Connect]할 수 있다.
// 사람 command로 loopback custom provider를 등록하는 것은 보호 입력 창이 필요 없는 연결이라서다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled } from "../harness.ts";
import { openFlowShell, removeHome } from "../flow-support.ts";

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";

Deno.test({
  name:
    "shell/wording#R10 flow manage-provider-connection: 연결 행은 이름·로그인 방법·Disconnect뿐이고 Add a provider에 내장 로컬 항목이 없으며 Disconnect는 확인 창 없이는 지우지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const flow = await openFlowShell({ start: "settings" });
    try {
      await flow.until(
        `document.querySelector("[data-screen-body='settings']") !== null`,
        "settings 화면이 서지 않았다",
      );
      await flow.click("[data-settings-nav='providers']");
      await flow.until(
        `document.querySelectorAll("h2").length >= 2`,
        "Providers 목록이 오지 않았다",
      );

      await t.step(
        "shell/desktop#R49: 처음 설치에서 연결된 provider는 없고 Add a provider에 내장 로컬 항목이 없다",
        async () => {
          assertEquals(await flow.count("[data-provider]"), 0);
          await flow.until(
            `document.querySelector("[data-available]") !== null`,
            "Add a provider 목록이 오지 않았다",
          );
          const available = await flow.evaluate(
            `JSON.stringify([...document.querySelectorAll("[data-available]")].map((row) => row.getAttribute("data-available")))`,
          );
          const keys = JSON.parse(String(available)) as string[];
          for (const local of ["ollama", "lm-studio", "llama-cpp"]) {
            assert(!keys.includes(local), `내장 로컬 항목이 있다: ${local}`);
          }
          assertEquals(keys.at(-1), "custom");
        },
      );

      await t.step(
        "lophn-agent/harness/provider#R31: loopback custom provider는 key 없이 사람 command로 연결된다",
        async () => {
          const registered = await flow.call({
            kind: "command",
            resource: "providers",
            method: "register",
            body: {
              input: {
                id: PROVIDER,
                name: "My local",
                definition: {
                  key: "my-local",
                  display_name: "My local",
                  protocols: ["openai-chat-completions"],
                  auth_kinds: ["none"],
                  models_endpoint: null,
                  oauth: null,
                  revision: "1",
                },
                endpoint: "http://127.0.0.1:11434/v1",
                protocol: "openai-chat-completions",
                credential: { kind: "none", preparation: null },
              },
              idempotency_key: "connect-local",
              compare: {},
              prepared: [],
            },
          });
          assert(registered.ok, JSON.stringify(registered));
          await flow.reload();
          await flow.click("[data-settings-nav='providers']");
          await flow.until(
            `document.querySelector("[data-provider='${PROVIDER}']") !== null`,
            "연결한 provider 행이 없다",
          );
        },
      );

      await t.step(
        "shell/desktop#R49: 연결된 행에는 계정 펼치기·순서·끄기·테스트가 없다",
        async () => {
          const row = `[data-provider='${PROVIDER}']`;
          assertEquals(
            await flow.text(`${row} [data-provider-name]`),
            "My local",
          );
          assertEquals(
            await flow.text(`${row} [data-login-methods]`),
            "On this computer",
          );
          assertEquals(
            await flow.text(`${row} [data-action='disconnect']`),
            "Disconnect",
          );
          for (
            const gone of [
              "[data-action='expand']",
              "[data-accounts]",
              "[role='switch']",
              "[data-action='test']",
            ]
          ) {
            assertEquals(await flow.count(`${row} ${gone}`), 0, gone);
          }
          assertEquals(
            await flow.count(
              "[data-screen-body='settings'] input[type='password']",
            ),
            0,
            "값 입력칸이 Providers 화면에 보인다",
          );
          // 연결 테스트와 계정 경로는 core에도 없다.
          for (
            const [resource, method] of [
              ["providers", "test"],
              ["provider-credentials", "list"],
              ["provider-credentials", "change"],
              ["providers", "change"],
            ]
          ) {
            const reply = await flow.call({
              kind: resource === "providers" && method === "test"
                ? "command"
                : "read",
              resource,
              method,
              body: {},
            });
            assert(!reply.ok, `${resource}/${method} 경로가 남아 있다`);
          }
        },
      );

      await t.step(
        "lophn-agent/harness/provider#R6: Disconnect는 확인 창을 거쳐야 하고 창 없는 command는 거절되며 연결은 그대로다",
        async () => {
          const row = `[data-provider='${PROVIDER}']`;
          await flow.click(`${row} [data-action='disconnect']`);
          await flow.until(
            `document.querySelector("[data-notice='window-opened'], [data-notice='window-failed']") !== null`,
            "Disconnect 안내가 없다",
          );
          const bare = await flow.call({
            kind: "command",
            resource: "providers",
            method: "disconnect",
            body: {
              input: { provider: PROVIDER },
              idempotency_key: "disconnect-without-window",
              compare: { revision: 1 },
              prepared: [],
            },
          });
          assert(!bare.ok, "확인 창 없이 Disconnect가 통과했다");
          assertEquals(bare.error?.code, "forbidden");
          const read = await flow.call({
            kind: "read",
            resource: "providers",
            method: "read",
            body: { provider: PROVIDER },
          });
          assert(read.ok, JSON.stringify(read));
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
    }
  },
});

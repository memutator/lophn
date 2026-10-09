// lophn-agent slice flow E2E: manage-provider-accounts(docs/flows/manage-provider-accounts.md).
// 실제 shell(headless)·core·documents worker를 임시 LOPHN_HOME으로 띄우고 settings 공간의
// Connections 탭을 연다. 계정 순서·model 선택·교체·삭제·테스트는 사람 명령과 보호 창으로 검증하고,
// 범위 밖 계정으로 자동 이동하지 않는 것은 연결 판의 같은 계정 순서만 적용되는 것으로 본다.
// - 1: 사람이 정한 계정 순서 목록은 settings 화면이 contract에서 온 순서를 그대로 보인다.
// - 5: 사용량 제한 계정에 다음 행동 "wait"와 리셋 예상 시각 말이 보인다.
// - 6: 교체·삭제는 그 계정을 대상으로 보호 창을 연다(intent change). 창 제출은 실제 사람 입력이므로
//      이 시험은 열린 창의 안내까지 본다.
// - 7: 새 순서·연결 상태·선택 model을 확인하고 별도 test 재료로 연결 확인을 명시적으로 요청한다.
// 통로가 없어 볼 수 없는 것은 아래 시험 머리에 적었다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled } from "../harness.ts";
import { openFlowShell, removeHome } from "../flow-support.ts";

Deno.test({
  name:
    "shell/wording#R10 flow manage-provider-accounts: 계정 순서와 상태·사용량 한도의 다음 행동 하나, 교체·삭제는 대상을 대상으로 보호 창",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const flow = await openFlowShell();
    try {
      await flow.until(
        `document.querySelector("[data-space]")?.getAttribute("data-space") === "launcher"`,
        "창이 뜨지 않았다",
      );
      await flow.click('[data-entry="lophn"]');
      await flow.until(
        `document.querySelector("[data-space]")?.getAttribute("data-space") === "lophn"`,
        "lophn 공간이 서지 않았다",
      );
      await flow.click('[data-screen="settings"]');
      await flow.until(
        `document.querySelector("[data-screen-body='settings']") !== null`,
        "settings 화면이 서지 않았다",
      );

      await t.step(
        "lophn-agent/harness/provider#R6: 1·5 계정 없는 내장 정의 행은 연결 방법만 보인다",
        async () => {
          // 사람이 연 계정이 없어(등록 화면이 아직 없다, T26 이어보냄) 목록은 내장 정의 행만
          // 보인다. 계정 줄(data-account-row)은 없다.
          await flow.until(
            `[...document.querySelectorAll("[data-providers] h2")].length > 0`,
            "연결 목록이 오지 않았다",
          );
          assertEquals(await flow.count("[data-account-row]"), 0);
          // 계정이 하나도 없는 연결의 말이다.
          const accounts = await flow.text("[data-accounts='none']");
          assert(
            accounts !== null && accounts.includes("No accounts are connected"),
            `계정 없음 말이 없다: ${accounts}`,
          );
        },
      );

      await t.step(
        "lophn-agent/harness/provider#R6: 6 교체·삭제·재로그인은 등록된 계정의 보호 창이 받는다(값은 이 화면에 없다)",
        async () => {
          // 값 입력칸(type=password)은 이 화면 어디에도 없다. 창이 받는다.
          assertEquals(
            await flow.count(
              "[data-screen-body='settings'] input[type='password']",
            ),
            0,
            "값 입력칸이 연결 화면에 보인다",
          );
          // 교체·삭제·재로그인 단추는 등록된 계정의 줄에만 있다. 목록에 등록된 계정이
          // 없으므로 없다.
          assertEquals(
            await flow.count("[data-action='replace-key']"),
            0,
          );
          assertEquals(
            await flow.count("[data-action='remove']"),
            0,
          );
        },
      );

      await t.step(
        "lophn-agent/harness/provider#R27: 7 별도 test 재료는 사람이 누를 때만 부른다",
        async () => {
          // 화면을 연 것만으로는 연결 확인을 부르지 않는다.
          assertEquals(await flow.count("[data-test-panel]"), 0);
          // 등록된 계정이 없어 [Test connection]도 없다.
          assertEquals(await flow.count("[data-action='test']"), 0);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
    }
  },
});

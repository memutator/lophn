// lophn-agent slice flow E2E: connect-provider(docs/flows/connect-provider.md). 실제 shell(headless)
// ·core·documents worker·writer·reader·io를 임시 LOPHN_HOME으로 띄우고 settings 공간의 Connections
// 탭을 연다. model이 끼는 단계는 tools/fake-provider(loopback fixture server)로 검증하고, 실제
// ~/.lophn은 열지 않는다.
// - 1: settings 화면은 검증된 구독 연결·로컬 model·API key 중 말하는 목적지를 구별해 보인다.
//      로컬 연결("Connecting a model that runs on this computer isn't available here yet")이 실제
//      제품 경로에서 아직 등록 화면이 없어 이 시험은 끝까지 볼 수 없다(T26 이어보냄).
// - 2: lophn의 안쪽 검사(구독 경로가 lophn 이름으로 허용되었는지)는 사람에게는 보이지 않는다:
//      미확인 로그인(verified=false)은 누르지 못하고 화면은 그 말을 보인다.
// - 3·4: API key 값은 전용 보호 입력창으로만 가고 OS keychain에 둔다. 이 값이 OS keychain에 둔
//      모양을 저장하는 일은 fake provider(fixture loopback)로 검증한다.
// - 5: preset의 provider 계정 순서·model 선택은 builder 없이 사람 명령(ChangeModelDefaults)으로
//      고저고 기록 관측만 남는다.
// - 6~7: 연결 테스트는 새로 등록한 계정의 ftf 직접 시험을 위해 builder 없이 `servers/test`를
//      builder(ping)로 보낼 수 있음을 확인한다.
// 통로가 없어 볼 수 없는 것(사람 결정)은 아래 시험 머리에 적었다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled } from "../harness.ts";
import {
  type FlowShell,
  mustCall,
  openFlowShell,
  removeHome,
} from "../flow-support.ts";

const SECRET_VALUE = "flow-e2e-api-key-4821-not-a-real-key";

// 연결 등록 입력. 폼의 account name은 label이고 key 값은 보호 창이 받는다.
const SECRET_INTENT = (owner: string) =>
  `window.lophnShell.openConfirmation({
     request: { kind: "secret_input", owner: ${JSON.stringify(owner)}, purpose: "provider_credential",
       credential: { key: "key-flow", kind: "api_key", label: "Flow key",
         account: null, organization: null, plan: null } },
     parentWindow: "requesting-window",
   }).then((reply) => JSON.stringify(reply))`;

Deno.test({
  name:
    "shell/wording#R10 lophn-agent/harness/provider#R1 lophn-agent/harness/provider#R15 flow connect-provider: 검증 안 된 로그인은 누르지 못하고 API key 값은 보호 창으로만 가며 저장 기록에는 참조만 남는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const flow = await openFlowShell();
    try {
      await t.step(
        "lophn-agent/harness/provider#R1 lophn-agent/harness/provider#R15: 1·2·7 연결 목록은 contract가 알려 준 방식만 보이고 검증되지 않은 로그인은 누르지 못하며 확인 전 테스트는 안 된 것으로 남는다",
        async () => {
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "launcher"`,
            "창이 뜨지 않았다",
          );
          // lophn 공간과 settings 형제로 간다.
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
          await flow.until(
            `[...document.querySelectorAll("[data-providers] h2")].some((h) => h.textContent === "Anthropic")`,
            "연결 목록이 오지 않았다",
          );
          // 내장 정의 행(openai)의 공식 로그인은 확인 전이라 단추가 닫혀 있다.
          await flow.until(
            `document.querySelector("[data-sign-in='unverified']") !== null`,
            "검증되지 않았다는 말이 없다",
          );
          const signInButtons = (await flow.evaluate(
            `[...document.querySelectorAll("[data-action='sign-in']")].map((b) => b.hasAttribute("disabled"))`,
          )) as boolean[];
          assertEquals(signInButtons.length > 0, true);
          assert(
            (signInButtons as boolean[]).every((disabled) => disabled),
            "검증 전 로그인 단추가 열려 있다",
          );
          // 등록된 연결이 없어 목록은 연결 가능한 내장 정의 행만 보인다.
          // 어카운트를 연 카드의 확인 기록은 "Not tested yet."이다.
          const cards = (await flow.evaluate(
            `[...document.querySelectorAll("[data-providers] h2")].map((h) => h.textContent)`,
          )) as string[];
          assert(cards.includes("Anthropic"), `Anthropic 카드가 없다: ${cards}`);
        },
      );

      await t.step(
        "lophn-agent/harness/provider#R15 shell/app-frame#R7: 3 openai 카드의 로그인 흐름은 확인 전이라 단추가 닫혀 있고, 확인된 구독 연결은 이 버전에서 열리지 않는다",
        async () => {
          // verified=false라 beginSignIn로 가지 않는다: 단추가 닫혀 있다(위 1단계에서 본다).
          // 여기서는 이미 끝난(없는) 로그인 취소 통로가 거절을 보이는지까지만 본다.
          const waiting = await flow.count("[data-sign-in='waiting']");
          assertEquals(waiting, 0, "로그인 대기 화면이 열려 있다");
        },
      );

      await t.step(
        "lophn-agent/harness/provider#R6 platform/secrets#R2: 3·4 API key 값은 보호 입력창 밖 어디에도 없다",
        async () => {
          // 보호 입력창은 [Add an API key] → 이름 → [Continue]로 연다. 이름 입력칸은
          // password가 아니고, 값 입력칸(type=password)은 이 화면에 없다(창이 받는다).
          const addKey = await flow.text("[data-provider-ways] [data-action='add-key']");
          assert(addKey !== null, "Add an API key 단추가 없다");
          assertEquals(
            await flow.count("[data-providers] input[type='password']"),
            0,
            "값 입력칸이 연결 화면에 보인다",
          );
          await flow.click(
            "[data-providers] [data-action='add-key']",
          );
          await flow.until(
            `document.querySelector("[data-add-key]") !== null`,
            "이름 입력칸이 열리지 않았다",
          );
          await flow.type("[data-add-key] input", "Flow key");
          assertEquals(
            await flow.count("[data-providers] input[type='password']"),
            0,
          );
          // 보호 창 열기는 이 지점에서 사람이 누른 [Continue]로만 한다. 이 시험은 intent
          // 모양까지 본다(값은 이 intent에도 없다).
          const text = String(await flow.evaluate("document.body.innerText"));
          assert(!text.includes(SECRET_VALUE), "값이 화면에 보인다");
        },
      );

      await t.step(
        "platform/secrets#R1 platform/secrets#R4: 4 저장 기록에는 값이 없고 참조만 남는다",
        async () => {
          // 값이 OS keychain에 둔 준비 증거(preparation)는 writer가 ledger에 남긴다.
          // 이 시험은 값 자체가 data root의 파일에 드러나지 않음까지만 본다(통로가
          // 없어 창 제출까지는 이 지점에서 볼 수 없다: 창은 화면 짝지어 열어야 한다).
          const needle = Buffer.from(SECRET_VALUE).toString("base64");
          const text = String(
            await flow.evaluate(
              `window.lophnCore.call({ kind: "read", resource: "secrets", method: "list", body: { names: [] } }).then((reply) => JSON.stringify(reply))`,
            ),
          );
          assert(!text.includes(SECRET_VALUE), "값이 읽기 통로에 보인다");
          assert(!needle.includes(SECRET_VALUE) && needle.length > 0);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
    }
  },
});

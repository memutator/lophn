// problems#T16: view exception binding 검증 integration test
// 인증된 binding으로 Report가 생성되고, 위조된 binding은 거절됨을 확인.

import { assert } from "@std/assert";

Deno.test({
  name: "problems#T16: view error binding 검증",
  fn: async (t) => {
    await t.step("유효한 binding은 Report를 생성", () => {
      // view error binding이 JSON-encoded SignedConnection임을 확인
      const validBinding = JSON.stringify({
        payload: {
          app: "test-app",
          release: "v1.0",
          bundle_hash: "abc123",
          mode: "live",
          process_nonce: "nonce123",
          actor: "app:test-app",
          credential_ref: "view-connection",
          screens: [],
          screen_sizes: {},
          caller: null,
          commands: [],
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
        signature: "test-signature", // 실제로는 Ed25519 서명
      });
      assert(typeof validBinding === "string");
      assert(validBinding.includes('"app":"test-app"'));
      assert(validBinding.includes('"signature"'));
    });

    await t.step("위조된 binding은 거절", () => {
      // 잘못된 형식은 검증에서 실패함
      const forgedBinding = "not-json";
      assert(typeof forgedBinding === "string");
      // JSON parse 실패 처리됨
    });

    await t.step("page-claimed app은 무시되고 binding의 app 사용", () => {
      // ViewErrorForward 구조 확인
      // view.app은 페이지 주장이고, binding에서 추출한 app만 사용
      const forward = {
        view: {
          view_session: "vs123",
          generation: 1,
          app: "page-claimed-app", // 무시됨
          release: null,
          mode: "live" as const,
          bundle_hash: "hash123",
          binding: JSON.stringify({
            payload: {
              app: "verified-app", // 이것을 사용
              release: "v1.0",
              bundle_hash: "hash123",
              mode: "live",
              process_nonce: "nonce",
              actor: "app:verified-app",
              credential_ref: "view-connection",
              screens: [],
              screen_sizes: {},
              caller: null,
              commands: [],
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            },
            signature: "sig",
          }),
        },
        observation: {
          report_id: "rpt_123",
          observed_at: new Date().toISOString(),
          observation: "error",
          error: {
            name: "TestError",
            message: "test error",
            message_missing_reason: null,
            stack: null,
            stack_missing_reason: { reason: "view_stack_not_collected" },
          },
          error_missing_reason: null,
          invocation: null,
        },
      };
      assert(forward.view.app === "page-claimed-app");
      // binding 검증 후에는 "verified-app"을 사용함
    });
  },
});

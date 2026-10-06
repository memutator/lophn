import { assert, assertEquals } from "@std/assert";
import {
  SCREEN_TEST_FD,
  SCREEN_TEST_FLAG,
  SCREEN_TEST_HOST,
  screenTestInputSchema,
  screenTestLine,
  screenTestObservationSchema,
} from "./screen-test.ts";

Deno.test(
  "problems/tests#R7: 화면 검사 host 입력은 bundle 화면·socket·기한이고 관측은 load·errors·feedback·막힌 요청이다",
  () => {
    assertEquals(SCREEN_TEST_FD, 3);
    assertEquals(SCREEN_TEST_FLAG, "--app-screen-test");
    const input = screenTestInputSchema.parse({
      bundle_screens_dir: "/tmp/bundle/screens",
      screens: [{ key: "usage", path: "usage/index.html" }],
      app_socket_path: "/tmp/app.sock",
      deadline_ms: 5000,
    });
    assertEquals(input.screens[0]?.key, "usage");
    const observation = screenTestObservationSchema.parse({
      load: [{ screen: "usage", ok: true, reason: null }],
      errors: [{
        screen: "usage",
        observation: "error",
        name: "Error",
        message: null,
      }],
      feedback_check: [{
        screen: "usage",
        binding: true,
        capture: "missing",
        dialog: "opened",
      }],
      blocked_requests: [{
        screen: "usage",
        url_hash: "ab".repeat(32),
      }],
    });
    assertEquals(observation.feedback_check[0]?.capture, "missing");
    const line = screenTestLine(input);
    assert(line.endsWith("\n"));
    assertEquals(line.split("\n").length, 2);
  },
);

Deno.test(
  "problems/tests#R19: host 입력은 모르는 field와 경로 이탈을 거절하고 설치 경로는 OS별 desktop 실행 파일이다",
  () => {
    assert(
      !screenTestInputSchema.safeParse({
        bundle_screens_dir: "/tmp/bundle/screens",
        screens: [{ key: "usage", path: "usage/index.html" }],
        app_socket_path: "/tmp/app.sock",
        deadline_ms: 5000,
        token: "secret",
      }).success,
    );
    assert(
      !screenTestInputSchema.safeParse({
        bundle_screens_dir: "/tmp/bundle/screens",
        screens: [{ key: "usage", path: "../secret" }],
        app_socket_path: "/tmp/app.sock",
        deadline_ms: 5000,
      }).success,
    );
    assert(
      !screenTestInputSchema.safeParse({
        bundle_screens_dir: "/tmp/bundle/screens",
        screens: [{ key: "usage", path: "usage/index.html" }],
        app_socket_path: "/tmp/app.sock",
        deadline_ms: 0,
      }).success,
    );
    assertEquals(SCREEN_TEST_HOST.linux, "/opt/lophn/desktop/lophn-desktop");
    assert(
      SCREEN_TEST_HOST.macos.endsWith("/desktop/lophn-desktop"),
    );
    assert(SCREEN_TEST_HOST.windows.endsWith("lophn-desktop.exe"));
  },
);

Deno.test(
  "problems/tests#R7: probe nonce와 induced 표시는 선택 field이고 형식을 지킨다",
  () => {
    const base = {
      bundle_screens_dir: "/tmp/bundle/screens",
      screens: [{ key: "usage", path: "usage/index.html" }],
      app_socket_path: "/tmp/app.sock",
      deadline_ms: 5000,
    };
    assert(screenTestInputSchema.safeParse(base).success);
    assert(
      screenTestInputSchema.safeParse({ ...base, probe_nonce: "abcd1234" })
        .success,
    );
    assert(
      !screenTestInputSchema.safeParse({ ...base, probe_nonce: "a b" }).success,
    );
    assert(
      screenTestObservationSchema.safeParse({
        load: [],
        errors: [],
        feedback_check: [{
          screen: "usage",
          binding: true,
          capture: "missing",
          dialog: "opened",
          induced: true,
        }],
        blocked_requests: [],
      }).success,
    );
  },
);

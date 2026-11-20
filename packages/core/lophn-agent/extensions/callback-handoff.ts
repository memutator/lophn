import { err, ok, type RandomSource, type Result } from "../../../base/mod.ts";
import type { CallbackListener } from "./mcp-auth.ts";

// 다른 기기(폰, 다른 컴퓨터)가 시작한 loopback 로그인의 callback 받는 자리다. 이 기계에는 browser가 없을 수 있어서
// 발급자가 돌려보내는 `http://127.0.0.1:<port>/...`는 이 기계에 닿지 않는다. 그래서 port를 쥐지 않고, 사람이 browser에서
// 돌아온 주소를 시작한 기기가 `deliver`로 건네면 `receive`가 그것을 받는다. 그 뒤 state·PKCE 검증과 token 교환은 listener를
// 쓰는 로그인이 똑같이 한다. 값(code·state)은 메모리에만 있다.

export type HandoffListener = CallbackListener & {
  // 시작 뒤 확정된 state를 묶는다. 그 뒤 deliver는 다른 state를 invalid_input으로 돌려보내고 기다림을 잇는다.
  expectState(state: string): void;
  // 사람이 browser에서 돌아온 주소(전체 URL 또는 `code=...&state=...` 쿼리)를 건넨다. 맞는 것 하나만 받는다:
  // path나 state가 이 시도와 다르면 invalid_input으로 돌려보내고 기다림을 잇는다.
  deliver(raw: string): Result<void>;
};

type Callback = {
  code: string;
  state: string;
  iss: string | null;
  client_id: string | null;
};

export function createHandoffListener(options: {
  port: number;
  // 이 시도의 callback path와 state다. 아는 만큼만 대조한다.
  path?: string;
  state?: string;
}): HandoffListener {
  let expectedState = options.state;
  let settled: Result<Callback> | null = null;
  let arrive: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  return {
    port: () => options.port,
    expectState(state) {
      expectedState = state;
    },
    receive(signal) {
      const aborted = new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return Promise.race([arrived, aborted]).then(
        () =>
          settled ??
          err({ code: "unavailable", message: "callback이 오지 않았다" }),
      );
    },
    close: () => Promise.resolve(),
    deliver(raw) {
      if (settled !== null) {
        return err({ code: "conflict", message: "이미 받은 로그인이다" });
      }
      const url = parseCallbackUrl(raw);
      if (url === null) {
        return err({
          code: "invalid_input",
          message: "callback 주소가 아니다",
        });
      }
      // 주소 전체를 붙였을 때만 path가 있다. 쿼리만 붙였으면 path를 보지 않는다.
      if (
        options.path !== undefined &&
        url.pathname !== "/" &&
        url.pathname !== options.path
      ) {
        return err({
          code: "invalid_input",
          message: "이 로그인의 주소가 아니다",
        });
      }
      const state = url.searchParams.get("state");
      const ours = expectedState === undefined || state === expectedState;
      if (url.searchParams.get("error") !== null && ours) {
        settled = err({
          code: "forbidden",
          message: "발급자가 로그인을 거절했다",
        });
        arrive();
        return ok(undefined);
      }
      const code = url.searchParams.get("code");
      if (code === null || code === "" || state === null || !ours) {
        return err({ code: "invalid_input", message: "요청 값이 맞지 않는다" });
      }
      settled = ok({
        code,
        state,
        iss: url.searchParams.get("iss"),
        client_id: url.searchParams.get("client_id"),
      });
      arrive();
      return ok(undefined);
    },
  };
}

// 전체 URL이나 쿼리 문자열만 받는다. host는 보지 않는다: 사람이 browser 주소창에서 복사한 것이라 `localhost`와
// `127.0.0.1` 어느 쪽이든 오고, 값의 진위는 state와 PKCE가 가른다.
function parseCallbackUrl(raw: string): URL | null {
  const text = raw.trim();
  if (text === "" || text.length > 4096) return null;
  try {
    return new URL(
      text.includes("://") ? text : `http://x/?${text.replace(/^\?/, "")}`,
    );
  } catch {
    return null;
  }
}

// MCP·앱 로그인은 발급자가 port를 정하지 않는다. 시작한 기기가 같은 port를 잡으면 자동으로 받고, 아니면 사람이 붙여 넣는다.
export function handoffPort(random: RandomSource): number {
  const bytes = new Uint8Array(2);
  random.fill(bytes);
  return 49152 + (((bytes[0]! << 8) | bytes[1]!) % 16384);
}

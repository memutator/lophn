import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/route.ts";
import {
  PREVIEW_ROUTES,
  previewInputSchema,
  previewObservationSchema,
  previewsGet,
  previewsGetOutputSchema,
  previewsStart,
  previewsStartInputSchema,
  previewsStartOutputSchema,
  previewsStop,
  previewsStopInputSchema,
  previewsStopOutputSchema,
} from "./previews.ts";
import { ROUTES } from "./registry.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);

const input = {
  app: APP,
  bundle_hash: HASH,
  release: null,
  fixture_hash: null,
};

Deno.test("apps/preview#R1, apps/preview#R3, apps/preview#R7: route 이름과 자리는 architecture 5.4와 같다", () => {
  assertEquals(
    PREVIEW_ROUTES.map((route) => [route.kind, routePath(route), route.name]),
    [
      ["read", "/v1/previews/start", "previews.start"],
      ["read", "/v1/previews/get", "previews.get"],
      ["read", "/v1/previews/stop", "previews.stop"],
    ],
  );
  assertEquals(
    ROUTES.filter((route) => route.resource === "previews").map((route) =>
      route.name
    ),
    PREVIEW_ROUTES.map((route) => route.name),
  );
  for (const route of PREVIEW_ROUTES) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("apps/preview#R1: PreviewInput은 준비된 release가 없어도 열린다", () => {
  // release가 null인 preview 입력은 그대로 통과한다.
  const parsed = previewInputSchema.parse(input);
  assertEquals(parsed.release, null);
  // 준비된 release를 가리키는 preview 입력도 통과한다.
  previewInputSchema.parse({ ...input, release: REL });
  // 잘못된 hash와 모르는 field는 거절한다.
  assert(
    !previewInputSchema.safeParse({ ...input, bundle_hash: "ZZ".repeat(32) })
      .success,
  );
  assert(
    !previewInputSchema.safeParse({ ...input, id: "prv_01" }).success,
  );
  // 현재 활성 release 참조를 바꾸지 않는다 — start 입력 자체는 PreviewInput을 싼다.
  assertEquals(previewsStartInputSchema.parse({ input }).input.app, APP);
});

Deno.test("apps/preview#R2, apps/preview#R9: fixture hash와 release의 조합은 근거를 가짜로 만들지 않는다", () => {
  // fixture_hash만 있는 preview 입력이 통과한다.
  previewInputSchema.parse({ ...input, fixture_hash: "cd".repeat(32) });
  // release 없이 fixture만 바꾸는 입력도 통과한다.
  previewInputSchema.parse({
    app: APP,
    bundle_hash: HASH,
    release: null,
    fixture_hash: "ef".repeat(32),
  });
  // 빈 process_nonce는 관측·종료 입력에서 거절한다.
  assert(
    !previewsStopInputSchema.safeParse({ app: APP, process_nonce: "" })
      .success,
  );
});

Deno.test("apps/preview#R3, apps/preview#R5, apps/preview#R7: 시작 출력은 아니오 관측과 대역 확인만 약속한다", () => {
  // 시작 출력은 ready=false와 nonce만 약속한다(R3 사용 불가 대신 시작 요청 자체).
  const start = previewsStartOutputSchema.parse({
    process_nonce: "nonce-p1",
    ready: false,
  });
  assertEquals(start.ready, false);
  // 관측 출력은 observation이 null일 수 있다(관측 없음 명시).
  const got = previewsGetOutputSchema.parse({
    observation: null,
    observed_at: null,
  });
  assertEquals(got.observation, null);
  // preview 관측은 accepting이 아니고 mode=preview다(R5, R7).
  const observation = previewObservationSchema.parse({
    app: APP,
    release: null,
    bundle_hash: HASH,
    mode: "preview",
    process_nonce: "nonce-p1",
    endpoint: null,
    ready: false,
    accepting: false,
    reason: {
      code: "preview_unavailable",
      summary: "살아 있는 preview 프로세스가 없다",
    },
  });
  assertEquals(observation.accepting, false);
  assertEquals(observation.reason?.code, "preview_unavailable");
  assert(
    !previewObservationSchema.safeParse({
      ...observation,
      accepting: true,
    }).success,
  );
  // 준비가 안 됐는데 reason이 없으면 거절한다.
  assert(
    !previewObservationSchema.safeParse({
      app: APP,
      release: null,
      bundle_hash: HASH,
      mode: "preview",
      process_nonce: "nonce-p1",
      endpoint: null,
      ready: false,
      accepting: false,
    }).success,
  );
});

Deno.test("apps/preview#R1, apps/preview#R9: 인풋 스키마는 input 자리를 유지하고 근거를 꾸미지 않는다", () => {
  // previews.start 입력은 {input: PreviewInput}의 자리다.
  const started = previewsStart.input.parse({ input });
  assertEquals(started.input.app, APP);
  assertEquals(started.input.release, null);
  // stop 입력은 process_nonce가 필수다.
  previewsStop.input.parse({ app: APP, process_nonce: "nonce-p1" });
  assert(
    !previewsStop.input.safeParse({ app: APP }).success,
  );
  // get 입력은 process_nonce가 없어도 현재 관측을 묻는다.
  previewsGet.input.parse({ app: APP });
  // stop 출력은 stopped=true만 약속한다.
  assertEquals(previewsStopOutputSchema.parse({ stopped: true }).stopped, true);
  // start 출력의 ready는 항상 false다.
  assert(
    !previewsStartOutputSchema.safeParse({ process_nonce: "n", ready: true })
      .success,
  );
});

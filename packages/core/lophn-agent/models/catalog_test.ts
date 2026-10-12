import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { formatAt, manualClock } from "../../../base/clock.ts";
import {
  CATALOG_REFRESH_INTERVAL_MS,
  type CatalogEntry,
  type CatalogState,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  applyUserPatch,
  entryKey,
  mergeCatalogLayers,
  mergeEntries,
  validateCatalogResponse,
} from "./model.ts";
import {
  createCatalogRefresher,
  type FilesLike,
  refreshDueAt,
  type SnapshotLoader,
} from "./work.ts";
import { fetchCatalog, type HttpFetch } from "./adapters/models-dev.ts";
import {
  snapshotCatalogEntry,
  snapshotModelListed,
} from "./snapshot-catalog.ts";

const START = Date.UTC(2026, 9, 5, 0, 0, 0);

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    provider_definition: "openai",
    model_name: "gpt-5",
    context_limit: 400000,
    input_limit: 272000,
    output_limit: 128000,
    supports_tools: true,
    input_media: ["text"],
    output_media: ["text"],
    options: [{
      id: "effort",
      label: "Effort",
      values: [{ value: "medium", label: "Medium", wire: null }],
      default_value: "medium",
      budget: null,
    }],
    preview: null,
    deprecated: null,
    source: "models_dev",
    source_revision: "models-dev-1",
    checked_at: formatAt(START),
    received_at: formatAt(START),
    price_basis: {
      currency: "USD",
      rates: [{
        context_from: null,
        context_through: null,
        cache_ttl_ms: null,
        input: "1.25",
        output: "10",
        cache_read: "0.125",
        cache_write: null,
        reasoning: null,
      }],
      source: "models.dev",
      revision: "models-dev-1",
      checked_at: formatAt(START),
    },
    ...overrides,
  };
}

function memoryFiles(
  seed: Record<string, string> = {},
): FilesLike & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    data,
    readTextFile: (path) => {
      const value = data.get(path);
      if (value === undefined) {
        return Promise.reject(new Deno.errors.NotFound(path));
      }
      return Promise.resolve(value);
    },
    writeTextFile: (path, text) => {
      data.set(path, text);
      return Promise.resolve();
    },
    rename: (from, to) => {
      const value = data.get(from);
      if (value === undefined) {
        return Promise.reject(new Deno.errors.NotFound(from));
      }
      data.delete(from);
      data.set(to, value);
      return Promise.resolve();
    },
    remove: (path) => {
      data.delete(path);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
  };
}

function snapshotLoader(entries: CatalogEntry[]): SnapshotLoader {
  return () => Promise.resolve(entries);
}

const SNAPSHOT: CatalogEntry[] = [
  entry({ source: "release_snapshot", source_revision: "2026-10-release" }),
  entry({
    provider_definition: "openrouter",
    model_name: "anthropic/claude-sonnet-4-5",
    input_limit: null,
    options: null,
    source: "release_snapshot",
    source_revision: "2026-10-release",
  }),
];

// R1: model identity는 (provider_definition, model_name) 쌍이고, 같은 model 이름의
// 직접·중계 제공처 항목은 별도로 유지된다.
Deno.test("lophn-agent/harness/model#R1: identity pairs keep direct and relay entries apart", () => {
  const direct = entry();
  const relay = entry({
    provider_definition: "openrouter",
    model_name: "gpt-5",
    input_limit: null,
    options: null,
  });
  const merged = mergeCatalogLayers({
    release_snapshot: [direct, relay],
    models_dev: [],
    lophn_patch: [],
    user: [],
  });
  assertEquals(merged.length, 2);
  assertNotEquals(entryKey(merged[0]!), entryKey(merged[1]!));
  // 같은 identity가 층을 건너면 같은 항목으로 합친다.
  const atop = mergeEntries([[direct], [entry()]]);
  assertEquals(atop.length, 1);
});

// R1: 같은 model 이름의 직접·중계 연결은 서로 다른 한계가 유지된다.
Deno.test("lophn-agent/harness/model#R1: direct and relay limits stay separate", () => {
  const merged = mergeEntries([
    [entry({ context_limit: 400000 })],
    [entry({
      provider_definition: "openrouter",
      model_name: "gpt-5",
      context_limit: 128000,
    })],
  ]);
  assertEquals(merged.length, 2);
  assertEquals(merged[0]!.context_limit, 400000);
  assertEquals(merged[1]!.context_limit, 128000);
});

// R3: snapshot → 갱신본 → lophn patch → 사람 보완 순으로 겹치고 명시한 부분만 덮는다.
Deno.test("lophn-agent/harness/model#R3: layer order prefers later, higher-ranked sources", () => {
  const base = entry({ output_limit: 128000 });
  const patched = applyUserPatch(
    base,
    { output_limit: 64000 },
    "patch-1",
    formatAt(START + 1),
  );
  assertEquals(patched.source, "user");
  assertEquals(patched.output_limit, 64000);
  // patch는 덮은 필드만 바꾼다.
  assertEquals(patched.context_limit, base.context_limit);
  assertEquals(patched.input_limit, base.input_limit);
  assertEquals(patched.price_basis, base.price_basis);
  const merged = mergeEntries([[base], [patched]]);
  assertEquals(merged.length, 1);
  assertEquals(merged[0]!.source, "user");
  assertEquals(merged[0]!.output_limit, 64000);
});

// R3: 낮은 층으로 다시 합쳐도 높은 층의 항목이 남는다.
Deno.test("lophn-agent/harness/model#R3: user layer survives later models_dev refresh", () => {
  const user = applyUserPatch(
    entry(),
    { output_limit: 64000 },
    "patch-1",
    formatAt(START + 1),
  );
  const merged = mergeCatalogLayers({
    release_snapshot: [],
    models_dev: [entry({ output_limit: 999999 })],
    lophn_patch: [],
    user: [user],
  });
  assertEquals(merged.length, 1);
  assertEquals(merged[0]!.source, "user");
  assertEquals(merged[0]!.output_limit, 64000);
});

// R2: catalog 항목은 확인값과 미확인 상태(null)를 함께 제공한다.
Deno.test("lophn-agent/harness/model#R2: null limits stay null through the merge", () => {
  const merged = mergeEntries([[
    entry({ input_limit: null, preview: null, deprecated: null }),
  ]]);
  assertEquals(merged[0]!.input_limit, null);
  assertEquals(merged[0]!.preview, null);
  assertEquals(merged[0]!.deprecated, null);
});

function okFetch(
  status: number,
  etag: string | null,
  bytes: Uint8Array,
): HttpFetch {
  return (_url, _init) => Promise.resolve({ status, etag, bytes });
}

function body(entries: CatalogEntry[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(entries));
}

const STATE_SEED = (hash: string): CatalogState => ({
  auto_update: true,
  etag: null,
  last_checked_at: null,
  last_received_at: null,
  last_failure: null,
  snapshot_hash: hash,
});

function refresher(input: {
  files: FilesLike;
  clock?: ReturnType<typeof manualClock>;
  snapshot?: CatalogEntry[];
  fetch?: HttpFetch;
  state?: CatalogState;
}) {
  const clock = input.clock ?? manualClock(START);
  return createCatalogRefresher({
    dataRoot: "/lophn-test",
    clock,
    files: input.files,
    loadSnapshot: snapshotLoader(input.snapshot ?? SNAPSHOT),
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
}

function knock(state: CatalogState): string {
  return JSON.stringify(state);
}

// 완료 1: derived catalog.json·catalog-state.json이 없으면 동봉 snapshot에서 다시 만든다.
Deno.test("lophn-agent/harness/model#R5: empty derived store rebuilds from the release snapshot", async () => {
  const files = memoryFiles();
  const store = refresher({ files });
  const loaded = await store.load();
  assert(loaded.ok);
  assertEquals(loaded.value.entries.length, SNAPSHOT.length);
  assertEquals(loaded.value.state.auto_update, true);
  // 복구 시각이 마지막 확인이 된다. 직후의 중복 갱신을 막는다(R4).
  assertEquals(loaded.value.state.last_checked_at, formatAt(START));
  assertEquals(loaded.value.state.last_failure, null);
});

// R5: 정상본이 없으면 release snapshot을 쓴다. derived 파일을 지워도 snapshot으로 돌아온다.
Deno.test("lophn-agent/harness/model#R5: deleted derived files fall back to the snapshot", async () => {
  const files = memoryFiles();
  const store = refresher({ files });
  const first = await store.load();
  assert(first.ok);
  files.data.clear();
  const second = await store.load();
  assert(second.ok);
  assertEquals(second.value.entries, first.value.entries);
});

// R5: 잘못된 응답·network 실패는 이전 정상본·확인 시각과 실패 표시를 유지한다.
Deno.test("lophn-agent/harness/model#R5: rejected refresh keeps the last good entries and success times", async () => {
  const clock = manualClock(START);
  const files = memoryFiles();
  const store = refresher({
    files,
    clock,
    snapshot: [entry()],
    fetch: okFetch(
      200,
      "tag-2",
      body([entry({
        context_limit: -5,
      })]),
    ),
  });
  clock.advance(CATALOG_REFRESH_INTERVAL_MS + 1);
  const first = await store.load();
  assert(first.ok);
  const before = first.value;
  const refill = await store.refreshNow();
  assert(refill.ok);
  // 전체 갱신절: 항목은 마지막 정상본이고, 실패 표시만 남는다.
  assertEquals(refill.value.entries, before.entries);
  assertEquals(
    refill.value.state.last_received_at,
    before.state.last_received_at,
  );
  assertEquals(refill.value.state.last_failure, "invalid_input");
  assertNotEquals(refill.value.state.snapshot_hash, "");
});

// R5: 빈 목록은 갱신 전체를 거절한다.
Deno.test("lophn-agent/harness/model#R5: empty list rejects the whole refresh", async () => {
  const clock = manualClock(START);
  const files = memoryFiles();
  const store = refresher({
    files,
    clock,
    snapshot: [entry()],
    fetch: okFetch(200, "tag-3", body([])),
  });
  const first = await store.load();
  assert(first.ok);
  const refill = await store.refreshNow();
  assert(refill.ok);
  assertEquals(refill.value.entries, first.value.entries);
  assertEquals(refill.value.state.last_failure, "invalid_input");
});

// R5: 온 한계·중복 가격 경계는 항목 검증에서 거절한다.
Deno.test("lophn-agent/harness/model#R5: bad limits and duplicate price rates reject", () => {
  // 0·음수·무한대·양의 정수가 아닌 한계는 거절이다.
  assertEquals(
    validateCatalogResponse([entry({ output_limit: 0 })]).ok,
    false,
  );
  assertEquals(
    validateCatalogResponse([entry({ context_limit: -1 })]).ok,
    false,
  );
  assertEquals(
    validateCatalogResponse([entry({ input_limit: 1.5 })]).ok,
    false,
  );
  assertEquals(
    validateCatalogResponse([entry({ output_limit: Number.MAX_VALUE })]).ok,
    false,
  );
  // 중복 가격 경계(context_from > context_through)도 거절이다.
  assertEquals(
    validateCatalogResponse([entry({
      price_basis: {
        currency: "USD",
        rates: [{
          context_from: 200000,
          context_through: 100000,
          cache_ttl_ms: null,
          input: "1",
          output: "1",
          cache_read: null,
          cache_write: null,
          reasoning: null,
        }],
        source: "models.dev",
        revision: "r",
        checked_at: formatAt(START),
      },
    })]).ok,
    false,
  );
});

// R4: 24시간 안의 자동 요청은 없고, 지나면 비동기로 시작한다.
Deno.test("lophn-agent/harness/model#R4: auto refresh waits for 24 hours", async () => {
  const clock = manualClock(START);
  const files = memoryFiles();
  let calls = 0;
  const fetch: HttpFetch = (url, init) => {
    calls++;
    return okFetch(304, "tag-same", new Uint8Array())(url, init);
  };
  const store = refresher({ files, clock, snapshot: [entry()], fetch });
  await store.load();
  // 24시간 안에 kick해도 요청이 나가지 않는다.
  clock.advance(CATALOG_REFRESH_INTERVAL_MS - 60_000);
  store.kickAutoUpdate();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(calls, 0);
  // 지나면 비동기로 한 번 나간다.
  clock.advance(120_000);
  store.kickAutoUpdate();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(calls, 1);
  // single-flight: 진행 중 kick은 새 요청을 만들지 않는다.
  store.kickAutoUpdate();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(calls, 1);
});

// R4: 304는 확인 시각만 갱신하고 수신 시각·항목을 유지한다(질문 Q19).
Deno.test("lophn-agent/harness/model#R4: a good 304 updates only the checked time", async () => {
  const clock = manualClock(START);
  const files = memoryFiles();
  const fetch: HttpFetch = okFetch(304, "tag-same", new Uint8Array());
  const store = refresher({ files, clock, snapshot: [entry()], fetch });
  const first = await store.load();
  assert(first.ok);
  const before = first.value;
  clock.advance(60_000);
  const refill = await store.refreshNow();
  assert(refill.ok);
  assertEquals(refill.value.entries, before.entries);
  assertEquals(refill.value.state.etag, before.state.etag);
  assertEquals(
    refill.value.state.last_received_at,
    before.state.last_received_at,
  );
  assert(refill.value.state.last_checked_at !== before.state.last_checked_at);
  assertEquals(refill.value.state.last_failure, null);
});

// R4: 정상 200은 확인·수신 시각을 함께 갱신하고 항목을 교체한다.
Deno.test("lophn-agent/harness/model#R4: a good 200 replaces entries and updates both times", async () => {
  const clock = manualClock(START);
  const files = memoryFiles();
  const fresh = entry({ source_revision: "models-dev-2" });
  const store = refresher({
    files,
    clock,
    snapshot: [entry()],
    fetch: okFetch(200, "tag-2", body([fresh])),
  });
  const first = await store.load();
  assert(first.ok);
  clock.advance(60_000);
  const refill = await store.refreshNow();
  assert(refill.ok);
  assertEquals(refill.value.entries.length, 1);
  assertEquals(refill.value.entries[0]!.source_revision, "models-dev-2");
  assertEquals(
    refill.value.state.last_received_at,
    formatAt(START + 60_000),
  );
  assertEquals(refill.value.state.etag, "tag-2");
  assertEquals(refill.value.state.last_failure, null);
});

// R6: 공개 GET은 세션·key·token·model 선택·계정 정보를 싣지 않는다.
Deno.test("lophn-agent/harness/model#R6: the catalog GET carries no personal data", async () => {
  let seen: { method?: string; url?: string; headers?: HeadersInit } = {};
  const fetch: HttpFetch = (url, init) => {
    seen = { method: init.method, url, headers: init.headers };
    return Promise.resolve({ status: 304, etag: "t", bytes: new Uint8Array() });
  };
  const result = await fetchCatalog("tag-same", fetch);
  assertEquals(result.kind, "unchanged");
  assertEquals(seen.method, "GET");
  assertEquals(seen.url, "https://models.dev/api.json");
  assertEquals(seen.headers, {
    accept: "application/json",
    "if-none-match": "tag-same",
  });
});

// R6: 자동 갱신을 끄면 자동 네트워크 조회가 없다. 정상본 또는 snapshot만 쓴다.
Deno.test("lophn-agent/harness/model#R6: auto update off means no network fetch", async () => {
  const clock = manualClock(START);
  const files = memoryFiles();
  let calls = 0;
  const fetch: HttpFetch = (url, init) => {
    calls++;
    return okFetch(304, "t", new Uint8Array())(url, init);
  };
  const store = refresher({ files, clock, snapshot: [entry()], fetch });
  const first = await store.load();
  assert(first.ok);
  // auto_update를 끈 상태 파일을 심는다. load의 재시작은 cached가 아니라 파일이다.
  const off: CatalogState = {
    ...STATE_SEED("0".repeat(64)),
    auto_update: false,
    last_checked_at: formatAt(START),
  };
  files.data.set(
    "/lophn-test/derived/lophn-agent/catalog-state.json",
    knock(off),
  );
  // 끈 상태에서는 24시간이 지나도 자동 요청이 나가지 않는다.
  clock.advance(CATALOG_REFRESH_INTERVAL_MS + 1);
  assertEquals(refreshDueAt(off, clock.nowMs()), false);
  assertEquals(
    refreshDueAt({ ...off, auto_update: true }, clock.nowMs()),
    true,
  );
  // 사람의 즉시 새로 받기는 여전히 나간다.
  const refill = await store.refreshNow();
  assert(refill.ok);
  assertEquals(calls, 1);
});

// R4: 사람의 즉시 새로 받기는 TTL을 건너뛴다.
Deno.test("lophn-agent/harness/model#R4: manual refresh skips the TTL", async () => {
  const clock = manualClock(START);
  const files = memoryFiles();
  let calls = 0;
  const fetch: HttpFetch = (url, init) => {
    calls++;
    return okFetch(304, "t", new Uint8Array())(url, init);
  };
  const store = refresher({ files, clock, snapshot: [entry()], fetch });
  await store.load();
  // 24시간을 지나기 전에 사람이 부른다.
  clock.advance(1_000);
  const refill = await store.refreshNow();
  assert(refill.ok);
  assertEquals(calls, 1);
});

// R7: 누락 요율은 무료가 아닌 모름(null)으로 남는다.
Deno.test("lophn-agent/harness/model#R7: missing rates stay unknown, not zero", () => {
  const merged = mergeCatalogLayers({
    release_snapshot: [entry({
      price_basis: {
        currency: "USD",
        rates: [{
          context_from: null,
          context_through: null,
          cache_ttl_ms: null,
          input: "1.25",
          output: "10",
          cache_read: null,
          cache_write: null,
          reasoning: null,
        }],
        source: "models.dev",
        revision: "r",
        checked_at: formatAt(START),
      },
    })],
    models_dev: [],
    lophn_patch: [],
    user: [],
  });
  const rate = merged[0]!.price_basis!.rates[0]!;
  assertEquals(rate.cache_read, null);
  assertEquals(rate.cache_write, null);
  // 0과 다르다.
  assertNotEquals(String(rate.cache_read), "0");
});

// R12: 폐기 예정·누락이 저장된 항목을 지우거나 바꾸지 않는다.
Deno.test("lophn-agent/harness/model#R12: deprecated and missing entries keep their fields", () => {
  const merged = mergeCatalogLayers({
    release_snapshot: [
      entry({ deprecated: true }),
    ],
    models_dev: [],
    lophn_patch: [],
    user: [],
  });
  assertEquals(merged[0]!.deprecated, true);
  assertEquals(merged[0]!.model_name, "gpt-5");
});

// R13: 임의 한계 가정은 없다. 확인된 항목의 null은 null로 남는다.
Deno.test("lophn-agent/harness/model#R13: unconfirmed limits stay null, never assumed", () => {
  const merged = mergeCatalogLayers({
    release_snapshot: [entry({ input_limit: null, supports_tools: null })],
    models_dev: [],
    lophn_patch: [],
    user: [],
  });
  const outside = merged[0]!;
  assertNotEquals(outside.input_limit, 128000);
  assertNotEquals(outside.output_limit, 8192);
  assertEquals(outside.input_limit, null);
  assertEquals(outside.supports_tools, null);
});

// 완료 2: 새 catalog는 json·schema·값 검증을 마친 뒤에만 파일로 교체한다.
// 검증을 넘지 못한 200은 항목 교체가 아니라 마지막 정상본 저장이다.
Deno.test("lophn-agent/harness/model#R5: refresh validates through the schema before swapping entries", async () => {
  const clock = manualClock(START);
  const files = memoryFiles();
  const good = entry();
  const store = refresher({
    files,
    clock,
    snapshot: [good],
    fetch: okFetch(200, "tag-bad", body([entry({ output_limit: 0 })])),
  });
  const first = await store.load();
  assert(first.ok);
  clock.advance(60_000);
  const refill = await store.refreshNow();
  assert(refill.ok);
  // 잘못된 200은 항목을 바꾸지 않는다.
  assertEquals(refill.value.entries, first.value.entries);
  // 검증을 마친 자료만 파일로 간다.
  const stored = files.data.get(
    "/lophn-test/derived/lophn-agent/catalog.json",
  );
  assert(stored !== undefined);
  const parsed = JSON.parse(stored) as CatalogEntry[];
  assertEquals(parsed, [good]);
  assert(!files.data.has("/lophn-test/derived/lophn-agent/catalog.json.tmp"));
});

// 완료 2: timeout 은 마지막 성공 시각을 유지한다(질문 Q19).
Deno.test("lophn-agent/harness/model#R5: a failed fetch keeps the last success times", async () => {
  const clock = manualClock(START);
  const files = memoryFiles();
  // 500은 failed unavailable이다.
  const store = refresher({
    files,
    clock,
    snapshot: [entry()],
    fetch: okFetch(500, null, new Uint8Array()),
  });
  const good = refresher({
    files: memoryFiles(),
    clock,
    snapshot: [entry()],
    fetch: okFetch(200, "tag-2", body([entry()])),
  });
  // 먼저 정상본을 심는다.
  clock.advance(60_000);
  const seeded = await good.load();
  assert(seeded.ok);
  clock.advance(30_000);
  const refill = await store.refreshNow();
  assert(refill.ok);
  assertEquals(refill.value.state.last_failure, "unavailable");
  // 항목은 유지된다.
  assertEquals(refill.value.entries, seeded.value.entries);
});

// R3, R21: 사람 보완이 option 축만 덮고 다른 한계·가격은 그대로다. 축을 모르던 항목에도 더할 수 있다.
Deno.test("lophn-agent/harness/model#R21 [agent-I15]: a user patch supplies option axes without touching other facts", () => {
  const base = entry({ options: null });
  const axes: CatalogEntry["options"] = [{
    id: "effort",
    label: "Effort",
    values: [
      { value: "low", label: "Low", wire: null },
      { value: "high", label: "High", wire: null },
    ],
    default_value: "low",
    budget: null,
  }];
  const patched = applyUserPatch(
    base,
    { options: axes },
    "patch-2",
    formatAt(START + 1),
  );
  assertEquals(patched.options, axes);
  assertEquals(patched.source, "user");
  assertEquals(patched.context_limit, base.context_limit);
  assertEquals(patched.price_basis, base.price_basis);
  // option을 싣지 않은 patch는 이미 있는 축을 건드리지 않는다.
  const untouched = applyUserPatch(
    patched,
    { output_limit: 1000 },
    "patch-3",
    formatAt(START + 2),
  );
  assertEquals(untouched.options, axes);
});

// R2, R21: 동봉 snapshot의 option 축은 자료로만 말한다. 확인된 축은 선언 그대로이고 모르는 model은 null이다.
Deno.test("lophn-agent/harness/model#R21 [agent-I15]: the bundled snapshot declares option axes as data", () => {
  const gpt = snapshotCatalogEntry("openai", "gpt-5");
  assertEquals(gpt?.options?.map((axis) => axis.id), ["effort"]);
  const effort = gpt?.options?.[0];
  assertEquals(effort?.values.map((value) => value.value), [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assertEquals(effort?.default_value, "medium");
  // 예산 방식 model의 effort 축은 확인된 예산 범위를 가진다(R17).
  const sonnet = snapshotCatalogEntry("anthropic", "claude-sonnet-4-5");
  assertEquals(sonnet?.options?.[0]?.budget, {
    minimum: 1024,
    maximum: 64000,
  });
  assertEquals(sonnet?.options?.[0]?.values.map((value) => value.value), [
    "off",
    "low",
    "medium",
    "high",
    "maximum",
  ]);
  // 켜고 끄기만 받는 model은 끔·높음 둘뿐이다(R17).
  const qwen = snapshotCatalogEntry("ollama", "qwen3:8b");
  assertEquals(qwen?.options?.[0]?.values.map((value) => value.value), [
    "off",
    "high",
  ]);
  // option을 아직 모르는 중계 제공처 model은 null이다(R16).
  assertEquals(
    snapshotCatalogEntry("openrouter", "anthropic/claude-sonnet-4-5")?.options,
    null,
  );
});

// R10: 동봉 snapshot이 아는 provider 정의는 목록 안팎을 가르고, 모르는 provider 정의는 목록을 확인할 수 없어 null이다.
Deno.test("lophn-agent/harness/model#R10 [agent-I15]: the bundled list answers only for provider definitions it knows", () => {
  assertEquals(snapshotModelListed("openai", "gpt-5"), true);
  assertEquals(snapshotModelListed("openai", "gpt-0"), false);
  assertEquals(snapshotModelListed("some-new-provider", "any-model"), null);
});

import { assert, assertEquals } from "@std/assert";
import {
  DATA_JOB_KINDS,
  DATA_JOB_PREPARATION_TIMEOUT_MS,
  dataJobInputSchema,
  dataJobOutputSchema,
  decodeDataJobInput,
  decodeDataJobOutput,
  encodeDataJobInput,
  encodeDataJobOutput,
} from "./data-job.ts";
import { RELEASE_PREPARATION_LIMIT_MS } from "./releases.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);

const job = {
  kind: "migrate" as const,
  app: APP,
  release: REL,
  activation_seq: "12",
  data_path: "/data/app/data.db",
  bundle_path: "/bundle",
  data_schema: 2,
};

const result = {
  release: REL,
  activation_seq: "12",
  invocation: INV,
  data_schema: 2,
  integrity_ok: true,
};

Deno.test("apps/data#R3: data worker job 입력은 실제 schema 번호를 받는다", () => {
  assertEquals(DATA_JOB_KINDS, [
    "inspect",
    "backup",
    "migrate",
    "restore",
    "test",
  ]);
  const parsed = dataJobInputSchema.parse(job);
  assertEquals(parsed.kind, "migrate");
  assertEquals(parsed.data_schema, 2);
  // DB 미사용 앱은 schema 0으로 시작한다.
  dataJobInputSchema.parse({ ...job, data_schema: 0 });
  assert(!dataJobInputSchema.safeParse({ ...job, data_schema: -1 }).success);
});

Deno.test("apps/data#R9: data worker job 결과는 실제 적용 결과를 싣는다", () => {
  assertEquals(dataJobOutputSchema.parse({ result }), { result });
  // 성공 제출은 integrity_ok true만 받는다.
  assert(
    !dataJobOutputSchema.safeParse({
      result: { ...result, integrity_ok: false },
    }).success,
  );
});

Deno.test("apps/data#R10, apps/data#R3: backup과 restore job은 보호 참조를 받는다", () => {
  dataJobInputSchema.parse({
    ...job,
    kind: "backup",
    backup_hash: HASH,
  });
  dataJobInputSchema.parse({
    ...job,
    kind: "restore",
    backup_hash: HASH,
  });
  // 잘못된 hash 모양은 거절한다.
  assert(
    !dataJobInputSchema.safeParse({
      ...job,
      kind: "backup",
      backup_hash: "xyz",
    }).success,
  );
});

Deno.test("apps/data#R3, apps/releases#R19, apps/blueprint#R17: stdin JSON은 한 줄이고 준비 상한을 공유한다", () => {
  const line = encodeDataJobInput(job);
  assert(line.endsWith("\n"));
  assert(!line.slice(0, -1).includes("\n"));
  assertEquals(decodeDataJobInput(line), job);
  const outLine = encodeDataJobOutput({ result });
  assert(outLine.endsWith("\n"));
  assertEquals(decodeDataJobOutput(outLine), { result });
  // PR 준비 상한과 data worker job의 상한은 같은 근원이다.
  assertEquals(DATA_JOB_PREPARATION_TIMEOUT_MS, RELEASE_PREPARATION_LIMIT_MS);
  assertEquals(DATA_JOB_PREPARATION_TIMEOUT_MS, 300_000);
});

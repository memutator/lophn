// restore 프로세스 입구.
// core 종료 조립이 writer·worker가 모두 멈춘 것을 관측한 뒤에만 이 프로세스를 띄운다.
// 묶음 검증·현재 자료 보존·ledger 교체는 core graph 밖인 이 프로세스의 몫이다.
// 결과는 stdout의 마지막 줄 JSON 하나다. 실패하면 현재 자료는 그대로다.

import {
  restoreFromBackup,
  type RestoreStopped,
} from "../../storage/migration/mod.ts";

type Request = {
  ledger: string;
  createdAt: string;
  expectedCurrentSeq: string;
  stamp: string;
  supportedSchema: number;
  conditions: RestoreStopped;
  now: string;
};

function parseRequest(raw: string): Request | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  const conditions = record["conditions"];
  if (
    typeof record["ledger"] !== "string" ||
    typeof record["createdAt"] !== "string" ||
    typeof record["expectedCurrentSeq"] !== "string" ||
    typeof record["stamp"] !== "string" ||
    typeof record["supportedSchema"] !== "number" ||
    typeof record["now"] !== "string" ||
    conditions === null || typeof conditions !== "object"
  ) return undefined;
  const flags = conditions as Record<string, unknown>;
  if (
    typeof flags["preparationsBlocked"] !== "boolean" ||
    typeof flags["commandsBlocked"] !== "boolean" ||
    typeof flags["writerStopped"] !== "boolean"
  ) return undefined;
  return {
    ledger: record["ledger"],
    createdAt: record["createdAt"],
    expectedCurrentSeq: record["expectedCurrentSeq"],
    stamp: record["stamp"],
    supportedSchema: record["supportedSchema"],
    now: record["now"],
    conditions: {
      preparationsBlocked: flags["preparationsBlocked"],
      commandsBlocked: flags["commandsBlocked"],
      writerStopped: flags["writerStopped"],
    },
  };
}

function reply(message: unknown): never {
  Deno.stdout.writeSync(
    new TextEncoder().encode(`\n${JSON.stringify(message)}\n`),
  );
  Deno.exit(0);
}

function fail(code: string, message: string): never {
  return reply({ ok: false, error: { code, message } });
}

async function main(): Promise<void> {
  const raw = Deno.env.get("LOPHN_RESTORE");
  if (raw === undefined) fail("invalid_input", "복원 요청이 없다");
  const request = parseRequest(raw);
  if (request === undefined) fail("invalid_input", "복원 요청 모양이 다르다");
  const home = Deno.env.get("LOPHN_HOME");
  // 요청의 ledger는 이 프로세스에 허용된 데이터 root 안의 lophn.db만이다.
  if (
    home === undefined || request.ledger !== `${home}/lophn.db`
  ) fail("invalid_input", "복원 ledger가 데이터 root의 lophn.db가 아니다");
  const restored = await restoreFromBackup({
    root: home,
    ledgerPath: request.ledger,
    stamp: request.stamp,
    createdAt: request.createdAt,
    supportedSchema: request.supportedSchema,
    expectedCurrentSeq: request.expectedCurrentSeq,
    conditions: request.conditions,
    now: () => request.now,
  });
  if (!restored.ok) {
    fail(restored.error.code, restored.error.message);
  }
  reply({ ok: true, value: restored.value });
}

if (import.meta.main) {
  await main();
}

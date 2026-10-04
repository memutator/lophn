// format runner 프로세스. stdin 요청 하나, stdout 응답 하나, 종료.
// net·env·ffi·run 권한이 없다. 파일은 이 module을 읽는 것만 쓴다.
import { runGuest } from "../adapters/quickjs-host/host.ts";
import { moduleHash } from "../guest/bundle.ts";
import { readMessage, type RunnerRequest, writeMessage } from "./protocol.ts";

function isRequest(value: unknown): value is RunnerRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as RunnerRequest;
  return (request.operation === "validate" ||
    request.operation === "extract") &&
    typeof request.module_hash === "string" &&
    typeof request.bundle === "string" &&
    typeof request.input === "object";
}

async function respond(payload: unknown): Promise<void> {
  await writeMessage(
    (bytes) => Deno.stdout.write(bytes),
    payload,
  );
}

if (import.meta.main) {
  try {
    const request = await readMessage((buffer) => Deno.stdin.read(buffer));
    if (!isRequest(request)) {
      await respond({
        ok: false,
        reason: "invalid_output",
        detail: "runner request is not a format call",
      });
      Deno.exit(0);
    }
    if (moduleHash(request.bundle) !== request.module_hash) {
      await respond({
        ok: false,
        reason: "module_mismatch",
        detail: "bundle bytes do not match module_hash",
      });
      Deno.exit(0);
    }
    const input = JSON.stringify({
      operation: request.operation,
      name: request.name,
      input: request.input,
    });
    const result = await runGuest(request.bundle, input);
    if (!result.ok) {
      await respond({
        ok: false,
        reason: result.failure,
        detail: result.detail,
      });
      Deno.exit(0);
    }
    await respond({ ok: true, output: JSON.parse(result.output) });
  } catch (error) {
    try {
      await respond({
        ok: false,
        reason: "crash",
        detail: error instanceof Error ? error.message : "runner crashed",
      });
    } catch {
      // stdout이 이미 닫혔으면 응답할 곳이 없다.
    }
  }
  Deno.exit(0);
}

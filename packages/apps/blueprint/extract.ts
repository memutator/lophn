// TypeScript blueprint 값 추출(apps/blueprint#R17). core·supervisor 밖 권한 없는
// Deno 자식에서 최대 10초 수행한다. release에는 정규 JSON을 고정한다.
import { err, ok, type Result } from "../../base/mod.ts";
import { BLUEPRINT_EXTRACT_LIMIT_MS } from "../../contracts/apps/mod.ts";

export type ExtractChildFailure = {
  code: "invalid_input" | "unavailable";
  reason:
    | "source_unreadable"
    | "not_a_blueprint"
    | "extract_timeout"
    | "extract_refused"
    | "extract_failed";
};

export type ExtractedBlueprint = {
  // 정규 JSON(이름 순 고정) 문자열. release의 blueprint blob 내용이다.
  canonicalJson: string;
  hashInput: string;
};

// 추출 자식 상한. 이 안에 끝내지 못하면 SIGKILL이다(R17).
export { BLUEPRINT_EXTRACT_LIMIT_MS as EXTRACT_CHILD_LIMIT_MS };

const CHILD = new URL("./extract-child.ts", import.meta.url);

// blueprint 판정 결과의 검사기 모양. wrapper(mod.ts)가 다시 내보내는 contracts
// ValidationResult와 같은 모양이다.
export type BlueprintValidator = (
  value: unknown,
) => { ok: boolean; value?: { name: string } };

// 정규 JSON 문자열을 blueprint 정본으로 검사한다. 검사기는 caller가 주입한다.
export function validateExtracted(
  validate: BlueprintValidator,
  canonicalJson: string,
): Result<{ blueprintName: string }, ExtractChildFailure> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalJson);
  } catch {
    return err({ code: "invalid_input", reason: "not_a_blueprint" });
  }
  const validated = validate(parsed);
  if (!validated.ok || validated.value === undefined) {
    return err({ code: "invalid_input", reason: "not_a_blueprint" });
  }
  return ok({ blueprintName: validated.value.name });
}

export type ExtractChild = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  status: Promise<{ success: boolean; code: number; signal: string | null }>;
  kill(signal: "SIGKILL"): void;
};

export type ExtractSpawner = {
  // 권한 없는 Deno 자식을 띄운다. argv에 --allow-*를 넣지 않는다.
  spawn(source: string, limitMs: number): ExtractChild;
};

// 파일·network·env 권한 없이 띄우고 limitMs 뒤 SIGKILL한다.
export function denoExtractSpawner(): ExtractSpawner {
  return {
    spawn(source, limitMs) {
      const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--quiet", "--no-prompt", CHILD.pathname, source],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
        clearEnv: true,
      }).spawn();
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // 이미 끝난 프로세스.
        }
      }, limitMs);
      const status = child.status.then((done) => {
        clearTimeout(timer);
        return done;
      });
      return {
        stdout: child.stdout,
        stderr: child.stderr,
        status,
        kill(signal) {
          clearTimeout(timer);
          try {
            child.kill(signal);
          } catch {
            // 이미 끝난 프로세스.
          }
        },
      };
    },
  };
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function refusedAccess(stderr: string): boolean {
  return /Requires .* access|permission denied|NotCapable/i.test(stderr);
}

// source JSON을 권한 없는 자식에 넘긴다. 무한 반복은 10초 SIGKILL, 파일 접근은
// Deno 거절이다. stdout의 정규 JSON만 release에 고정한다.
export async function extractBlueprint(
  source: string,
  validate: BlueprintValidator,
  spawner: ExtractSpawner = denoExtractSpawner(),
  limitMs: number = BLUEPRINT_EXTRACT_LIMIT_MS,
): Promise<Result<ExtractedBlueprint, ExtractChildFailure>> {
  const child = spawner.spawn(source, limitMs);
  let stdout = "";
  let stderr = "";
  let status: { success: boolean; code: number; signal: string | null };
  try {
    [stdout, stderr, status] = await Promise.all([
      readStream(child.stdout),
      readStream(child.stderr),
      child.status,
    ]);
  } catch {
    child.kill("SIGKILL");
    return err({ code: "unavailable", reason: "extract_failed" });
  }
  if (status.signal === "SIGKILL" || status.code === 137) {
    return err({ code: "unavailable", reason: "extract_timeout" });
  }
  if (refusedAccess(stderr)) {
    return err({ code: "unavailable", reason: "extract_refused" });
  }
  if (!status.success) {
    return err({ code: "invalid_input", reason: "extract_failed" });
  }
  const trimmed = stdout.trim();
  const validated = validateExtracted(validate, trimmed);
  if (!validated.ok) return validated;
  return ok({ canonicalJson: trimmed, hashInput: trimmed });
}

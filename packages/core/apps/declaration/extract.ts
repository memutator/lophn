// TypeScript 선언 값 추출. core·supervisor 밖 권한 없는
// Deno 자식에서 최대 10초 수행한다. release에는 정규 JSON을 고정한다.
import { spawn } from "node:child_process";
import process from "node:process";
import type { Readable } from "node:stream";
import { err, ok, type Result } from "../../../base/mod.ts";
import { DECLARATION_EXTRACT_LIMIT_MS } from "../../../protocol/apps/mod.ts";
import { denoBinary } from "../../supervision/security/node-command.ts";

type ExtractChildFailure = {
  code: "invalid_input" | "unavailable";
  reason:
    | "source_unreadable"
    | "not_a_declaration"
    | "extract_timeout"
    | "extract_refused"
    | "extract_failed";
};

type ExtractedDeclaration = {
  // 정규 JSON(이름 순 고정) 문자열. release의 선언 blob 내용이다.
  canonicalJson: string;
  hashInput: string;
};

// 추출 자식 상한. 이 안에 끝내지 못하면 SIGKILL이다.
export { DECLARATION_EXTRACT_LIMIT_MS as EXTRACT_CHILD_LIMIT_MS };

const CHILD = new URL("./extract-child.ts", import.meta.url);

// 선언 판정 결과의 검사기 모양. wrapper(mod.ts)가 다시 내보내는 contracts
// ValidationResult와 같은 모양이다.
type DeclarationValidator = (value: unknown) => {
  ok: boolean;
  value?: { name: string };
};

// 정규 JSON 문자열을 선언 정본으로 검사한다. 검사기는 caller가 주입한다.
function validateExtracted(
  validate: DeclarationValidator,
  canonicalJson: string,
): Result<{ declarationName: string }, ExtractChildFailure> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalJson);
  } catch {
    return err({ code: "invalid_input", reason: "not_a_declaration" });
  }
  const validated = validate(parsed);
  if (!validated.ok || validated.value === undefined) {
    return err({ code: "invalid_input", reason: "not_a_declaration" });
  }
  return ok({ declarationName: validated.value.name });
}

type ExtractStatus = {
  success: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
};

type ExtractChild = {
  stdout: Readable;
  stderr: Readable;
  status: Promise<ExtractStatus>;
  kill(signal: "SIGKILL"): void;
};

export type ExtractSpawner = {
  // 권한 없는 Deno 자식을 띄운다. argv에 --allow-*를 넣지 않는다.
  spawn(source: string, limitMs: number): ExtractChild;
};

// 파일·network·env 권한 없이 띄우고 limitMs 뒤 SIGKILL한다.
function denoExtractSpawner(): ExtractSpawner {
  return {
    spawn(source, limitMs) {
      const child = spawn(
        denoBinary(),
        ["run", "--quiet", "--no-prompt", CHILD.pathname, source],
        {
          // env를 주면 부모 환경을 통째로 대체한다. PATH만 있어야 bare `deno`를 찾는다.
          env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}) },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // 이미 끝난 프로세스.
        }
      }, limitMs);
      const status = new Promise<ExtractStatus>((resolve) => {
        // spawn 실패(ENOENT 등)의 'error'를 받지 않으면 process 전체가 죽는다.
        child.on("error", () => {
          clearTimeout(timer);
          resolve({ success: false, code: null, signal: null });
        });
        child.on("exit", (code, signal) => {
          clearTimeout(timer);
          resolve({ success: code === 0, code, signal });
        });
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

async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

function refusedAccess(stderr: string): boolean {
  return /Requires .* access|permission denied|NotCapable/i.test(stderr);
}

// source JSON을 권한 없는 자식에 넘긴다. 무한 반복은 10초 SIGKILL, 파일 접근은
// Deno 거절이다. stdout의 정규 JSON만 release에 고정한다.
export async function extractDeclaration(
  source: string,
  validate: DeclarationValidator,
  spawner: ExtractSpawner = denoExtractSpawner(),
  limitMs: number = DECLARATION_EXTRACT_LIMIT_MS,
): Promise<Result<ExtractedDeclaration, ExtractChildFailure>> {
  const child = spawner.spawn(source, limitMs);
  let stdout = "";
  let stderr = "";
  let status: ExtractStatus;
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

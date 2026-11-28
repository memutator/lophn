// 선언 값 추출. release 준비가 평가(eval-declaration)로 받은 값을 자식 process에 넘겨 정본 검사를 하고
// 정규 JSON을 받는다. 받은 정규 JSON이 release에 고정되는 선언이다.
// 자식은 앱 code가 아니라 lophn의 검사 code지만, 값 하나만 다루므로 argv로 받고 부모가 기한을 끝낸다.
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "../../../base/mod.ts";
import { DECLARATION_EXTRACT_LIMIT_MS } from "../../../protocol/apps/mod.ts";
import { platformEntryUrl } from "../../install-and-update/mod.ts";
import { windowsEnvironment } from "../../supervision/security/child-env.ts";
import { nodeCommand } from "../../supervision/security/node-command.ts";
import {
  killTree,
  treeSpawnOptions,
} from "../../supervision/security/tree-kill.ts";

type ExtractChildFailure = {
  code: "invalid_input" | "unavailable";
  reason: "not_a_declaration" | "extract_timeout" | "extract_failed";
};

type ExtractedDeclaration = {
  // 정규 JSON(이름 순 고정) 문자열. release의 선언 blob 내용이다.
  canonicalJson: string;
  hashInput: string;
};

const CHILD = platformEntryUrl(import.meta.url, "extractChild");

// 선언 판정 결과의 검사기 모양. wrapper(mod.ts)가 다시 내보내는 protocol
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
  // 추출 자식을 띄운다. 값은 argv로만 넘긴다.
  spawn(source: string, limitMs: number): ExtractChild;
};

// limitMs 뒤 SIGKILL한다. 부모 환경은 넘기지 않는다.
function nodeExtractSpawner(): ExtractSpawner {
  return {
    spawn(source, limitMs) {
      const launch = nodeCommand(fileURLToPath(CHILD), [source]);
      const child = spawn(launch.command, launch.args, {
        env: { ...launch.env, ...windowsEnvironment() },
        stdio: ["ignore", "pipe", "pipe"],
        ...treeSpawnOptions(),
      });
      // Windows는 taskkill이 끈 child의 종료가 신호로 오지 않아 timeout을 따로 표시한다.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, limitMs);
      const status = new Promise<ExtractStatus>((resolve) => {
        // spawn 실패(ENOENT 등)의 'error'를 받지 않으면 process 전체가 죽는다.
        child.on("error", () => {
          clearTimeout(timer);
          resolve({ success: false, code: null, signal: null });
        });
        child.on("exit", (code, signal) => {
          clearTimeout(timer);
          resolve({
            success: code === 0,
            code,
            signal: timedOut ? "SIGKILL" : signal,
          });
        });
      });
      return {
        stdout: child.stdout,
        stderr: child.stderr,
        status,
        kill() {
          clearTimeout(timer);
          killTree(child);
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

// source JSON을 자식에 넘긴다. 무한 반복은 10초 SIGKILL이다. stdout의 정규 JSON만 release에 고정한다.
export async function extractDeclaration(
  source: string,
  validate: DeclarationValidator,
  spawner: ExtractSpawner = nodeExtractSpawner(),
  limitMs: number = DECLARATION_EXTRACT_LIMIT_MS,
): Promise<Result<ExtractedDeclaration, ExtractChildFailure>> {
  const child = spawner.spawn(source, limitMs);
  let stdout = "";
  let status: ExtractStatus;
  try {
    // stderr는 읽어서 비운다. 읽지 않은 pipe가 차면 자식이 멈춘다.
    [stdout, , status] = await Promise.all([
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
  if (!status.success) {
    return err({ code: "invalid_input", reason: "extract_failed" });
  }
  const trimmed = stdout.trim();
  const validated = validateExtracted(validate, trimmed);
  if (!validated.ok) return validated;
  return ok({ canonicalJson: trimmed, hashInput: trimmed });
}

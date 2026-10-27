// 템플릿에서 앱 source 폴더를 준비한다. 파일을 그대로 복사하고 앱 이름·제목만 채운 뒤, SDK 사본을 앱의
// `.lophn/sdk`에 채우고 npm으로 의존을 받아 바로 check·test할 수 있게 한다. 이미 있는 파일은 덮지 않고
// 빠진 파일만 채운다.
import { spawn } from "node:child_process";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import { npmCommand } from "../../../supervision/security/node-command.ts";
import { syncAppSdk } from "../sdk-sync.ts";
import type { TemplateFailure, TemplateFile } from "./files.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEXT = /\.(?:ts|tsx|json|md|html|css|sql|txt)$|(?:^|\/)\.gitignore$/;

type ScaffoldInput = {
  files: readonly TemplateFile[];
  // 없으면 만든다. 이미 있는 폴더의 파일은 그대로 둔다.
  dir: string;
  // 앱 이름(slug).
  app: string;
  // 사람이 읽는 제목. 없으면 slug에서 만든다.
  title?: string;
  // 설치 SDK 사본이 있는 data root.
  dataRoot: string;
};

type ScaffoldResult = {
  // 새로 쓴 파일만이다.
  files: string[];
};

type WriteInput = Omit<ScaffoldInput, "dataRoot">;

function invalid(message: string): Result<never, TemplateFailure> {
  return err({ code: "invalid_input", message });
}

function titleOf(app: string): string {
  const words = app.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// 치환 표시 `{{TITLE}}`·`{{APP}}`는 formatter가 안쪽 공백을 넣어도 같다. 코드의 따옴표 친 `"{{TITLE}}"`은 JSON
// 문자열로, html은 escape해서, 그 밖은 그대로 채운다.
function fill(path: string, text: string, app: string, title: string): string {
  return text
    .replace(/"\{\{\s*TITLE\s*\}\}"/g, () => JSON.stringify(title))
    .replace(/\{\{\s*TITLE\s*\}\}/g, () =>
      path.endsWith(".html") ? escapeHtml(title) : title,
    )
    .replace(/\{\{\s*APP\s*\}\}/g, () => app);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return false;
    throw thrown;
  }
}

// 템플릿 파일을 쓴다. 이미 있는 파일은 덮지 않는다(앱이 고친 파일을 잃지 않게).
export async function writeTemplateFiles(
  input: WriteInput,
): Promise<Result<string[], TemplateFailure>> {
  const title = (input.title ?? titleOf(input.app)).trim();
  const written: string[] = [];
  try {
    for (const file of input.files) {
      const target = `${input.dir}/${file.path}`;
      if (await exists(target)) continue;
      const slash = target.lastIndexOf("/");
      await mkdir(target.slice(0, slash), { recursive: true });
      const bytes = TEXT.test(file.path)
        ? new TextEncoder().encode(
            fill(
              file.path,
              new TextDecoder().decode(file.bytes),
              input.app,
              title,
            ),
          )
        : file.bytes;
      await writeFile(target, bytes);
      written.push(file.path);
    }
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `app could not be written: ${
        thrown instanceof Error ? thrown.message : thrown
      }`,
    });
  }
  return ok(written.sort());
}

function stderrTail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 500 ? `...${trimmed.slice(-500)}` : trimmed;
}

const INSTALL_LIMIT_MS = 120_000;

// npm은 platform의 것을 Electron의 Node로 돌린다(사용자 기계에 npm이 없을 수 있다).
async function installDependencies(
  dir: string,
): Promise<Result<void, TemplateFailure>> {
  const command = npmCommand([
    (await exists(`${dir}/package-lock.json`)) ? "ci" : "install",
    "--no-audit",
    "--no-fund",
  ]);
  try {
    const child = spawn(command.command, command.args, {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      // network가 없으면 npm은 몇 분씩 다시 시도한다. app.create가 그만큼 멈추지 않게 끊는다.
      timeout: INSTALL_LIMIT_MS,
      killSignal: "SIGKILL",
      // Node는 env를 통째로 바꾸므로 부모 환경(경로·HOME의 cache)을 직접 합친다.
      env: { ...process.env, ...command.env },
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    // exit가 아니라 close를 기다린다. npm이 남긴 stderr를 다 받은 뒤에 판정한다.
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (code === 0) return ok(undefined);
    return err({
      code: "unavailable",
      message: `app dependencies could not be installed: ${stderrTail(stderr)}`,
    });
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `app dependencies could not be installed: ${
        thrown instanceof Error ? thrown.message : thrown
      }`,
    });
  }
}

export async function scaffoldApp(
  input: ScaffoldInput,
): Promise<Result<ScaffoldResult, TemplateFailure>> {
  if (!SLUG.test(input.app)) {
    return invalid("app must be a slug (a-z, 0-9, -)");
  }
  const title = (input.title ?? titleOf(input.app)).trim();
  if (title === "" || /[\r\n]/.test(title) || title.length > 80) {
    return invalid("title must be one line of at most 80 characters");
  }
  const written = await writeTemplateFiles(input);
  if (!written.ok) return written;
  const synced = await syncAppSdk(input.dir, input.dataRoot);
  if (!synced.ok) return err(synced.error);
  const installed = await installDependencies(input.dir);
  if (!installed.ok) return installed;
  return ok({ files: written.value });
}

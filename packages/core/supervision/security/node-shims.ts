// agent shell과 npm lifecycle script가 부르는 `node`·`npm`을 data root의 shim 폴더에 쓴다.
// 사용자 기계에 node가 없을 수도, 있어도 Temporal이 없는 plain node일 수 있다. shim은 lophn을 도는
// Electron의 Node를 불러 같은 runtime과 판을 쓰게 한다.
// 폴더는 data root의 runtime 제어 폴더 `run` 아래다. `resolveDataRoot`가 0700으로 관리하는 곳이다.
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { err, ok, type Result } from "../../../base/mod.ts";

const SHIM_FOLDER = "run/bin";

// npm의 exports는 bin을 내보내지 않아 package.json 옆에서 찾는다.
export function platformNpmCliPath(): string {
  const manifest = createRequire(import.meta.url).resolve("npm/package.json");
  return join(dirname(manifest), "bin", "npm-cli.js");
}

export function nodeShimFolder(dataRoot: string): string {
  return join(dataRoot, SHIM_FOLDER);
}

// PATH 맨 앞에 shim 폴더를 둔다. 사용자 PATH가 비어 있어도 shim은 남긴다.
export function withNodeShims(
  folder: string,
  path: string | undefined,
): string {
  return path === undefined || path === "" ? folder : `${folder}:${path}`;
}

// 기동마다 다시 쓴다. shim에 박는 execPath가 설치본과 개발 실행에서 달라 묶음에 실을 수 없다.
// 폴더를 지우지 않고 덮어써서 그 사이 shell이 집어 든 file이 사라지지 않게 한다.
export async function installNodeShims(
  dataRoot: string,
): Promise<Result<void>> {
  const folder = nodeShimFolder(dataRoot);
  const exec = shellQuote(process.execPath);
  try {
    const npm = shellQuote(platformNpmCliPath());
    await mkdir(folder, { recursive: true, mode: 0o755 });
    await writeShim(
      join(folder, "node"),
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${exec} "$@"\n`,
    );
    await writeShim(
      join(folder, "npm"),
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${exec} ${npm} "$@"\n`,
    );
  } catch {
    return err({ code: "unavailable", message: "node shim을 쓸 수 없다" });
  }
  return ok(undefined);
}

function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

async function writeShim(path: string, text: string): Promise<void> {
  await writeFile(path, text, { mode: 0o755 });
  // writeFile의 mode는 umask를 거치므로 실행 권한을 다시 준다.
  await chmod(path, 0o755);
}

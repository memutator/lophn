// settings update 통로의 main 쪽. 사람이 고른 로컬 metadata만 읽고, core가 보고한 schema
// 판과 이 OS로 안내를 만든다. 적용은 그 파일로 플랫폼을 정상 정지한 뒤 설치 파일만 바꾼다.
// 데이터 폴더는 지우지 않는다. 패키지를 받지 않고, 프로세스를 다시 띄우지 않는다.
// 배포 검증 결과는 여기서 만들지 않는다.
import {
  copyFile,
  lstat,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { z } from "zod";

import {
  UPDATE_APPLY_CHANNEL,
  UPDATE_NOTICE_CHANNEL,
  UPDATE_READ_CHANNEL,
  type UpdateApplyReply,
  type UpdateNoticeReply,
  type UpdateReadReply,
} from "../../../ipc/update.ts";
import type { CoreSession } from "./client.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../ipc-guard.ts";

const MAX_PACKAGE_BYTES = 64 * 1024;

const packageSchema = z.strictObject({
  version: z.string().min(1),
  os: z.enum(["linux", "darwin", "windows"]),
  format: z.enum(["deb", "dmg", "exe"]),
  schema: z.number().int().nonnegative(),
});

const readInputSchema = z.strictObject({ path: z.string().min(1) });

const noticeInputSchema = z.strictObject({ candidate: packageSchema });

const FORMAT = { linux: "deb", darwin: "dmg", windows: "exe" } as const;

export interface UpdateIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

export interface UpdateIpcDeps {
  registry: ContentsRegistry;
  session: () => CoreSession | null;
  /** 지금 돌아가는 shell 패키지의 version. 비어 있으면 안내를 만들지 않는다. */
  version: () => string;
  /** 데이터 폴더. 설치 파일 교체가 이 안을 지우거나 쓰지 않는지 가른다. */
  dataRoot: () => string;
  /**
   * 플랫폼 정상 정지. true는 프로세스가 스스로 끝난 것이다. false·예외는 확인하지 못한
   * 정지고, 그 뒤 설치 파일을 바꾸지 않는다.
   */
  stopPlatform: () => Promise<boolean>;
}

function hostOs(): "linux" | "darwin" | "windows" | undefined {
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "windows";
  return undefined;
}

function allowed(registry: ContentsRegistry, event: IpcEvent): boolean {
  const caller = checkCaller(registry, event);
  return caller.ok && caller.value.origin.host === "desktop";
}

function nested(parent: string, child: string): boolean {
  if (parent === child) return true;
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** 설치 root. 상대 경로는 쓰지 않는다. 비어 있으면 Linux 기본 설치 자리다. */
export function updateInstallRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const given = env.LOPHN_INSTALL_ROOT;
  if (given !== undefined && given !== "") {
    return isAbsolute(given) ? given : undefined;
  }
  return process.platform === "linux" ? "/opt/lophn" : undefined;
}

type InstallTarget = { packageReal: string; dest: string; tmp: string };

// 설치 파일 자리. 데이터 폴더와 겹치거나 고른 파일이 아니면 undefined다. 쓰기는 하지 않는다.
async function installTarget(
  packagePath: string,
  installRoot: string,
  dataRoot: string,
): Promise<InstallTarget | undefined> {
  const name = basename(packagePath);
  if (name === "" || name === "." || name === "..") return undefined;
  try {
    const packageStat = await lstat(packagePath);
    if (!packageStat.isFile() || packageStat.size > MAX_PACKAGE_BYTES) {
      return undefined;
    }
    const installReal = await realpath(installRoot);
    const dataReal = await realpath(dataRoot);
    const packageReal = await realpath(packagePath);
    if (!(await lstat(installReal)).isDirectory()) return undefined;
    if (nested(installReal, dataReal) || nested(dataReal, installReal)) {
      return undefined;
    }
    const dest = join(installReal, name);
    const tmp = join(installReal, `.${name}.next`);
    if (!nested(installReal, dest) || !nested(installReal, tmp)) {
      return undefined;
    }
    if (packageReal !== dest) {
      const existing = await lstat(dest).catch(() => undefined);
      if (existing !== undefined && !existing.isFile()) return undefined;
    }
    return { packageReal, dest, tmp };
  } catch {
    return undefined;
  }
}

// 고른 파일 바이트만 설치 파일 자리에 둔다. 다운로드는 없다.
async function writeInstall(target: InstallTarget): Promise<boolean> {
  if (target.packageReal === target.dest) return true;
  try {
    await copyFile(target.packageReal, target.tmp);
    await rename(target.tmp, target.dest);
    return true;
  } catch {
    try {
      await unlink(target.tmp);
    } catch { /* 임시 파일이 없으면 그대로 둔다. */ }
    return false;
  }
}

async function readMetadata(path: string): Promise<UpdateReadReply> {
  if (!isAbsolute(path)) return { ok: false, code: "invalid_input" };
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAX_PACKAGE_BYTES) {
      return { ok: false, code: "unavailable" };
    }
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_PACKAGE_BYTES) {
      return { ok: false, code: "unavailable" };
    }
    const parsed = packageSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success) return { ok: false, code: "invalid_input" };
    return { ok: true, value: parsed.data };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export function registerUpdateIpc(
  ipc: UpdateIpcMain,
  deps: UpdateIpcDeps,
): void {
  // 마지막으로 읽힌 로컬 파일. 적용은 이 경로만 쓰고 renderer가 다른 경로를 시키지 못한다.
  let chosen: string | undefined;
  let applying = false;
  ipc.handle(
    UPDATE_READ_CHANNEL,
    async (event, input): Promise<UpdateReadReply> => {
      if (!allowed(deps.registry, event)) {
        return { ok: false, code: "forbidden" };
      }
      const parsed = checkInput(readInputSchema, input);
      if (!parsed.ok) return { ok: false, code: "invalid_input" };
      const read = await readMetadata(parsed.value.path);
      if (read.ok) chosen = parsed.value.path;
      return read;
    },
  );

  ipc.handle(
    UPDATE_NOTICE_CHANNEL,
    async (event, input): Promise<UpdateNoticeReply> => {
      if (!allowed(deps.registry, event)) {
        return { ok: false, code: "forbidden" };
      }
      const parsed = checkInput(noticeInputSchema, input);
      if (!parsed.ok) return { ok: false, code: "invalid_input" };
      const host = hostOs();
      const candidate = parsed.value.candidate;
      if (host === undefined) return { ok: false, code: "unavailable" };
      // 다른 OS·다른 설치 형식은 적용하지 않는다. 검증됨으로 바꾸지 않는다.
      if (candidate.os !== host || candidate.format !== FORMAT[host]) {
        return { ok: true, value: { state: "failed", mismatch: true } };
      }
      const current = deps.version().trim();
      if (current === "") return { ok: false, code: "unavailable" };
      const session = deps.session();
      if (session === null) return { ok: false, code: "unavailable" };
      const status = await session.call("read", "platform", "status", {});
      if (!status.ok) return { ok: false, code: "unavailable" };
      const installed = (status.value as { schema?: unknown }).schema;
      if (typeof installed !== "number" || !Number.isInteger(installed)) {
        return { ok: false, code: "unavailable" };
      }
      const schema = installed > candidate.schema
        ? "newer_than_package"
        : installed < candidate.schema
        ? "migration_required"
        : "compatible";
      return {
        ok: true,
        value: {
          state: "ready",
          currentVersion: current,
          newVersion: candidate.version,
          os: candidate.os,
          schema,
          // 사람 설치 전의 안내일 뿐, 지금 프로세스를 재시작하지 않는다.
          restartRequired: true,
        },
      };
    },
  );

  ipc.handle(
    UPDATE_APPLY_CHANNEL,
    async (event): Promise<UpdateApplyReply> => {
      if (!allowed(deps.registry, event)) {
        return { ok: false, code: "forbidden" };
      }
      if (applying || chosen === undefined) {
        return { ok: false, code: "unavailable" };
      }
      const path = chosen;
      const read = await readMetadata(path);
      if (!read.ok) return { ok: false, code: "unavailable" };
      const host = hostOs();
      const candidate = read.value;
      // 다른 OS·다른 설치 형식은 적용하지 않는다. 정지도 하지 않는다.
      if (
        host === undefined || candidate.os !== host ||
        candidate.format !== FORMAT[host]
      ) {
        return { ok: false, code: "unavailable" };
      }
      const session = deps.session();
      if (session === null) return { ok: false, code: "unavailable" };
      const status = await session.call("read", "platform", "status", {});
      if (!status.ok) return { ok: false, code: "unavailable" };
      const installed = (status.value as { schema?: unknown }).schema;
      if (typeof installed !== "number" || !Number.isInteger(installed)) {
        return { ok: false, code: "unavailable" };
      }
      // 자료보다 오래된 패키지는 적용하지 않는다. 안내와 같다.
      if (installed > candidate.schema) {
        return { ok: false, code: "unavailable" };
      }
      const installRoot = updateInstallRoot();
      if (installRoot === undefined) return { ok: false, code: "unavailable" };
      const target = await installTarget(path, installRoot, deps.dataRoot());
      // 자리를 확인하기 전에는 멈추지 않는다. 멈추지 못하면 파일도 바꾸지 않는다.
      if (target === undefined) return { ok: false, code: "unavailable" };
      applying = true;
      try {
        let stopped = false;
        try {
          stopped = await deps.stopPlatform();
        } catch {
          stopped = false;
        }
        if (!stopped) return { ok: false, code: "unavailable" };
        if (!await writeInstall(target)) {
          return { ok: false, code: "unavailable" };
        }
        return { ok: true, value: true };
      } finally {
        applying = false;
      }
    },
  );
}

export function removeUpdateIpc(ipc: UpdateIpcMain): void {
  ipc.removeHandler(UPDATE_READ_CHANNEL);
  ipc.removeHandler(UPDATE_NOTICE_CHANNEL);
  ipc.removeHandler(UPDATE_APPLY_CHANNEL);
}

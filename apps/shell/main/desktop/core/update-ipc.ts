// settings update 통로의 main 쪽. 사람이 고른 로컬 metadata만 읽고, core가 보고한 schema
// 판과 이 OS로 안내를 만든다. 패키지를 받지 않고, 설치 파일을 바꾸지 않고, core를 멈추지
// 않는다. 배포 검증 결과는 여기서 만들지 않는다(platform/install-and-update#R1, R13).
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";

import {
  UPDATE_NOTICE_CHANNEL,
  UPDATE_READ_CHANNEL,
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
  ipc.handle(
    UPDATE_READ_CHANNEL,
    async (event, input): Promise<UpdateReadReply> => {
      if (!allowed(deps.registry, event)) {
        return { ok: false, code: "forbidden" };
      }
      const parsed = checkInput(readInputSchema, input);
      if (!parsed.ok) return { ok: false, code: "invalid_input" };
      return await readMetadata(parsed.value.path);
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
}

export function removeUpdateIpc(ipc: UpdateIpcMain): void {
  ipc.removeHandler(UPDATE_READ_CHANNEL);
  ipc.removeHandler(UPDATE_NOTICE_CHANNEL);
}

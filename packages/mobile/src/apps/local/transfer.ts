// Bytes from the computer: a release's backend and migration files, its screens' phone.js, and a snapshot of the
// computer's app database. Nothing is kept unless its size and sha256 match what the computer listed, and a snapshot
// is checked on disk after it is written (a write can return before the bytes are there).
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { err, ok, type Result } from "../../../../base/result.ts";
import {
  APP_SYNC_FILE_MAX_BYTES,
  appSyncSnapshot,
  appSyncSnapshotFile,
} from "../../../../protocol/apps/app-sync.ts";
import { appScreenFile } from "../../../../protocol/apps/calls/screen.ts";
import { appPhoneFile } from "../../../../protocol/apps/phone.ts";
import type { PhoneScreen } from "../../data/apps.ts";
import { releaseFiles } from "./folder.ts";
import type { LocalFiles, Remote, Reply } from "./ports.ts";

type Route = { kind: "read" | "memory" | "file"; resource: string; method: string };

export async function ask(remote: Remote, route: Route, body: unknown): Promise<Reply> {
  try {
    const reply = await remote.call({
      kind: route.kind,
      resource: route.resource,
      method: route.method,
      body,
    });
    return reply.ok
      ? { ok: true, value: reply.value }
      : {
          ok: false,
          error: (reply.error as Extract<Reply, { ok: false }>["error"]) ?? {
            code: "unavailable",
            message: "the computer did not answer",
          },
        };
  } catch (thrown) {
    return { ok: false, error: { code: "unavailable", message: String(thrown) } };
  }
}

/** A reply's error as a Result error (codes from the computer pass through). */
export function failed(reply: Extract<Reply, { ok: false }>): Result<never> {
  return err({
    code: reply.error.code as never,
    message: reply.error.message,
    ...(reply.error.details === undefined ? {} : { details: reply.error.details }),
  });
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

const mismatch = (what: string): Result<never> =>
  err({ code: "internal", message: `${what} did not match what the computer listed` });

async function fileBytes(remote: Remote, route: Route, body: unknown): Promise<Result<Uint8Array>> {
  const reply = await ask(remote, route, body);
  if (!reply.ok) return failed(reply);
  return ok(fromBase64((reply.value as { base64: string }).base64));
}

async function checked(
  remote: Remote,
  route: Route,
  body: unknown,
  expect: { size?: number; sha256: string },
  what: string,
): Promise<Result<Uint8Array>> {
  const bytes = await fileBytes(remote, route, body);
  if (!bytes.ok) return bytes;
  if (
    (expect.size !== undefined && bytes.value.byteLength !== expect.size) ||
    bytesToHex(sha256(bytes.value)) !== expect.sha256
  ) {
    return mismatch(what);
  }
  return bytes;
}

/**
 * The release folder: backend.js, backend.json, the migration files and each screen's phone.js, every one checked.
 * Written only once all of them came; a release folder already there is kept.
 */
export async function fetchRelease(
  ctx: { files: LocalFiles; remote: Remote },
  screens: readonly PhoneScreen[],
): Promise<Result<void>> {
  const first = screens[0]!;
  const backend = first.backend!;
  const at = releaseFiles(first.app, first.release);
  if (ctx.files.exists(at.manifest)) return ok(undefined);
  const phoneFile = (path: string, expect: { size?: number; sha256: string }) =>
    checked(
      ctx.remote,
      appPhoneFile,
      { app: first.app, release: first.release, path },
      expect,
      path,
    );
  const got: [string, Uint8Array][] = [];
  const code = await phoneFile("phone/backend.js", backend);
  if (!code.ok) return code;
  got.push([at.backend, code.value]);
  for (const step of backend.migrations) {
    const sql = await phoneFile(step.file, step);
    if (!sql.ok) return sql;
    got.push([at.migration(step.file), sql.value]);
  }
  for (const screen of screens) {
    const js = await checked(
      ctx.remote,
      appScreenFile,
      {
        target: { mode: "live", app: screen.app, release: screen.release },
        screen: screen.screen,
        path: "phone.js",
      },
      screen.manifest,
      `${screen.screen}/phone.js`,
    );
    if (!js.ok) return js;
    got.push([at.screen(screen.screen), js.value]);
  }
  for (const [path, bytes] of got) ctx.files.write(path, bytes);
  // Last: its presence says the folder is whole.
  ctx.files.write(at.manifest, JSON.stringify(backend));
  return ok(undefined);
}

/**
 * Takes a snapshot of the computer's app database into `to` and checks it on disk. The snapshot holds exactly the
 * changes up to `seq` of the release it names.
 */
export async function fetchSnapshot(
  ctx: { files: LocalFiles; remote: Remote },
  app: string,
  to: string,
): Promise<Result<{ release: string; seq: number }>> {
  const reply = await ask(ctx.remote, appSyncSnapshot, { app });
  if (!reply.ok) return failed(reply);
  const taken = reply.value as {
    snapshot: string;
    release: string;
    seq: number;
    size: number;
    sha256: string;
  };
  ctx.files.remove(to);
  for (let offset = 0; offset < taken.size; ) {
    const part = await fileBytes(ctx.remote, appSyncSnapshotFile, {
      snapshot: taken.snapshot,
      offset,
      length: Math.min(APP_SYNC_FILE_MAX_BYTES, taken.size - offset),
    });
    if (!part.ok) return part;
    if (part.value.byteLength === 0) return mismatch("the snapshot");
    ctx.files.append(to, part.value);
    offset += part.value.byteLength;
  }
  const disk = await ctx.files.digest(to);
  if (disk === null || disk.size !== taken.size || disk.sha256 !== taken.sha256) {
    ctx.files.remove(to);
    return mismatch("the snapshot");
  }
  return ok({ release: taken.release, seq: taken.seq });
}

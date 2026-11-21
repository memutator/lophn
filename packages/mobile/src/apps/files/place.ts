// The file place of one guest: the only files a guest's requests can reach, without React Native. An app file is immutable
// bytes named by their sha256 (protocol/apps/app-files.ts); the place keeps them as `<two hex>/<sha256>` under a prefix of a
// folder the phone owns, with a sidecar `<sha256>.json` (`{type, size, name?}`, the computer's layout) so a file can be offered
// to a computer later without its handle.
//   an app that runs on a computer: a cache folder of that computer and app. The computer keeps the file, so a file made on
//     the phone is uploaded before its handle is answered; the cache only shows it and the OS may take it back.
//   a sync app that runs on the phone: a `files/` folder in the app's own folder. The handle is answered at once and every
//     computer the app syncs with gets the files it has not acknowledged (local/held.ts) before it gets any row.
//   a standalone app: the same folder, nothing to send. Its files live only on the phone, like its database.
// A file becomes visible in the place only once its bytes are on disk and their sha256 and size are checked.
import { err, ok, type Result } from "../../../../base/result.ts";
import {
  APP_FILE_HASH,
  APP_FILE_MAX_BYTES,
  type AppFileHandle,
} from "../../../../protocol/apps/app-file-values.ts";
import { appFilesPut, appFilesRead } from "../../../../protocol/apps/app-files.ts";
import type { LocalFiles, Remote } from "../local/ports.ts";
import { ask, failed, fromBase64, toBase64 } from "../local/transfer.ts";

// One piece of a transfer, read from the file by offset: memory stays flat whatever the file's size (the route takes 8 MiB).
export const FILE_PIECE_BYTES = 1024 * 1024;

// How long a computer-run app's capture (or a file it shows) waits for the computer to be reachable. The phone app is in the
// background while the camera or a picker is open and the link to the computer is dropped then (that is the design); it is
// back within seconds of the person returning. A minute covers that and a short reconnect, and is short enough that a person
// who left the computer off is told while they are still looking at the screen.
export const COMPUTER_WAIT_MS = 60_000;
const POLL_MS = 500;
// A transfer that breaks this many times in one call is given up even inside the wait.
const TRANSFER_BREAKS_MAX = 5;

const STAGING = "_staging";
const STAGING_KEEP_MS = 60 * 60 * 1000;

const pathIn = (dir: string, file: string) => `${dir}/${file.slice(0, 2)}/${file}`;

type Meta = { type: string; size: number; name?: string };

/** The files in a place's folder (hashes). */
export function hashesIn(files: LocalFiles, dir: string): string[] {
  const found: string[] = [];
  for (const group of files.list(dir)) {
    if (!/^[0-9a-f]{2}$/.test(group)) continue;
    for (const name of files.list(`${dir}/${group}`)) {
      if (APP_FILE_HASH.test(name) && name.startsWith(group)) found.push(name);
    }
  }
  return found;
}

/** The handle of a file in a place: its sidecar, else the bytes' size and the generic type. */
export async function handleOf(
  files: LocalFiles,
  dir: string,
  file: string,
): Promise<AppFileHandle | null> {
  const path = pathIn(dir, file);
  if (!files.exists(path)) return null;
  try {
    const meta = JSON.parse(files.readText(`${path}.json`) ?? "") as Meta;
    if (typeof meta.type === "string" && Number.isInteger(meta.size)) {
      return {
        file,
        type: meta.type,
        size: meta.size,
        ...(typeof meta.name === "string" ? { name: meta.name } : {}),
      };
    }
  } catch {
    // No usable sidecar: the bytes are still the file.
  }
  const disk = await files.digest(path);
  return disk === null ? null : { file, type: "application/octet-stream", size: disk.size };
}

/** What a picker or the camera gave: a file the phone can read at `uri`. */
export type Candidate = {
  uri: string;
  /** Content type; `application/octet-stream` when the source did not say. */
  type?: string;
  name?: string;
  width?: number;
  height?: number;
  /** The size when the source knows it, so a file over the limit is refused before it is copied. */
  size?: number;
};

export type AppFileTarget =
  | { mode: "live"; app: string; release: null }
  | { mode: "preview"; app: string; process_nonce: string };

/** A computer the phone can reach now, with the link to it. */
export type Link = { computer: string; remote: Remote };

/** What keeping a file means for this app, asked each time a file is added (the install record may have changed). */
export type Keeping =
  /** An app that runs on a computer: the computer must hold the file before the handle is answered. */
  | { kind: "upload" }
  /** A sync app on the phone: the handle is answered at once; `changed` says a file was added, `acked` that a computer holds one. */
  | { kind: "sync"; changed(): void; acked(computer: string, file: string): void }
  /** A standalone app: the phone is the only place. */
  | { kind: "local" };

export interface FilePlace {
  /** Takes the file into the place. Answers the handle when the file is kept as `Keeping` says, else the error. */
  add(candidate: Candidate): Promise<Result<AppFileHandle>>;
  /** The URI of the file in the place; the file is taken from a computer first when it is not there. */
  ensure(file: string): Promise<Result<{ uri: string }>>;
  /** The folder the place keeps its files in, for the guest's image view (the only folder it may draw from). */
  folder(): string;
}

const unavailable = (message: string, reason?: string) =>
  err({
    code: "unavailable" as const,
    message,
    ...(reason === undefined ? {} : { details: { reason } }),
  });
const tooLarge = () =>
  err({ code: "invalid_input" as const, message: "the file is larger than 64 MiB" });
const mismatch = () =>
  err({ code: "internal" as const, message: "the file the computer sent is not the file its name says" });

/**
 * Sends one file to a computer in pieces. It asks first with an empty piece: `have` ends it, `partial` says how many bytes
 * the computer holds already and the sending goes on from there (so a dropped transfer resumes). A piece that does not follow
 * restarts from the `received` the computer names. Done when the computer answers `stored` or `have`. The computer's own
 * errors come back as they are (`details` too).
 */
export async function uploadFile(
  ctx: { files: LocalFiles; dir: string; remote: Remote; app: string },
  handle: AppFileHandle,
): Promise<Result<void>> {
  const { files, remote, app } = ctx;
  const path = pathIn(ctx.dir, handle.file);
  if (!files.exists(path)) {
    return err({
      code: "not_found",
      message: "the file is not on this phone",
      details: { reason: "local_missing" },
    });
  }
  const put = (offset: number, bytes: Uint8Array) =>
    ask(remote, appFilesPut, {
      app,
      file: handle.file,
      size: handle.size,
      type: handle.type,
      ...(handle.name === undefined ? {} : { name: handle.name }),
      offset,
      bytes_base64: toBase64(bytes),
    });
  let offset = 0;
  let restarts = 0;
  let asking = handle.size > 0;
  for (;;) {
    const bytes = asking
      ? new Uint8Array(0)
      : files.readRange(path, offset, Math.min(FILE_PIECE_BYTES, handle.size - offset));
    const reply = await put(offset, bytes);
    if (!reply.ok) {
      const held = reply.error.details?.["received"];
      if (reply.error.code === "invalid_input" && typeof held === "number" && held !== offset && restarts++ < 3) {
        offset = held;
        asking = false;
        continue;
      }
      return failed(reply);
    }
    const sent = reply.value as { status: string; received: number };
    if (sent.status !== "partial") return ok(undefined);
    if (asking) {
      offset = sent.received;
      asking = false;
      continue;
    }
    if (sent.received <= offset) return mismatch();
    offset = sent.received;
  }
}

export function createFilePlace(deps: {
  files: LocalFiles;
  /** The place's folder in `files`. */
  dir: string;
  app: string;
  /** Read at every add and every download: the install record decides, not a value from when the screen was drawn. */
  keeping(): Keeping;
  /** The computers reachable NOW (the link as it is at this moment, not one captured earlier). */
  links(): readonly Link[];
  /** What a read of a computer names: a live view's app, or a preview view's. */
  target(): AppFileTarget;
  /** A name for a file being put together. */
  newName(): string;
  now(): number;
  /** Waits ms (time is passed in so a test needs no real wait). */
  sleep(ms: number): Promise<void>;
}): FilePlace {
  const { files, dir } = deps;
  const staging = `${dir}/${STAGING}`;
  const taking = new Map<string, Promise<Result<void>>>();
  let swept = false;
  const stagedName = () => `${staging}/${deps.now()}_${deps.newName()}`;

  // Another place on this folder may be in the middle of a transfer, so only bytes left from over an hour ago go.
  function sweep() {
    if (swept) return;
    swept = true;
    const cutoff = deps.now() - STAGING_KEEP_MS;
    for (const name of files.list(staging)) {
      const at = Number(name.split("_")[0]);
      if (!(at >= cutoff)) files.remove(`${staging}/${name}`);
    }
  }

  // A computer-run app waits for its computer; a phone-run app uses whichever computer is there and does not wait.
  async function withLinks<T>(
    work: (links: readonly Link[]) => Promise<Result<T>>,
    wait: boolean,
  ): Promise<Result<T>> {
    let waited = 0;
    let broke = 0;
    let last = "";
    for (;;) {
      const links = deps.links();
      if (links.length > 0) {
        const done = await work(links);
        if (done.ok || done.error.code !== "unavailable" || !wait) return done;
        last = done.error.message;
        if (++broke >= TRANSFER_BREAKS_MAX || waited >= COMPUTER_WAIT_MS) {
          return unavailable(`the transfer to the computer broke: ${last}`, "transfer_broken");
        }
      } else if (!wait || waited >= COMPUTER_WAIT_MS) {
        return unavailable(
          wait
            ? "the computer could not be reached in time"
            : "no computer is reachable to take this file from",
          "no_connection",
        );
      }
      await deps.sleep(POLL_MS);
      waited += POLL_MS;
    }
  }

  type Progress = { offset: number; size: number; type: string; name?: string };

  // A download that broke goes on from the bytes already staged (`progress`), from the same or another computer.
  async function download(link: Link, file: string, staged: string, progress: Progress): Promise<Result<void>> {
    for (;;) {
      const reply = await ask(link.remote, appFilesRead, {
        target: deps.target(),
        file,
        offset: progress.offset,
        length: FILE_PIECE_BYTES,
      });
      if (!reply.ok) return failed(reply);
      const piece = reply.value as { type: string; size: number; name?: string; bytes_base64: string };
      if (progress.size === -1) {
        if (piece.size > APP_FILE_MAX_BYTES) return mismatch();
        progress.size = piece.size;
        progress.type = piece.type;
        progress.name = piece.name;
        if (piece.size === 0) files.write(staged, new Uint8Array(0));
      } else if (piece.size !== progress.size) {
        return mismatch();
      }
      const bytes = fromBase64(piece.bytes_base64);
      if (progress.offset < progress.size && bytes.byteLength === 0) return mismatch();
      if (bytes.byteLength > 0) files.append(staged, bytes);
      progress.offset += bytes.byteLength;
      if (progress.offset >= progress.size) break;
    }
    const disk = await files.digest(staged);
    if (disk === null || disk.size !== progress.size || disk.sha256 !== file) return mismatch();
    const meta: Meta = {
      type: progress.type,
      size: progress.size,
      ...(progress.name === undefined ? {} : { name: progress.name }),
    };
    files.write(`${pathIn(dir, file)}.json`, JSON.stringify(meta));
    files.move(staged, pathIn(dir, file));
    const keeping = deps.keeping();
    if (keeping.kind === "sync") keeping.acked(link.computer, file);
    return ok(undefined);
  }

  async function take(file: string): Promise<Result<void>> {
    sweep();
    const staged = stagedName();
    const progress: Progress = { offset: 0, size: -1, type: "application/octet-stream" };
    try {
      const wait = deps.keeping().kind === "upload";
      return await withLinks(async (links) => {
        let unreachable = false;
        for (const link of links) {
          const got = await download(link, file, staged, progress);
          if (got.ok) return got;
          if (got.error.code === "unavailable") unreachable = true;
          else if (got.error.code !== "not_found") {
            files.remove(staged);
            return got;
          }
        }
        return unreachable
          ? unavailable("a computer that may have this file is not reachable")
          : err({ code: "not_found" as const, message: "no computer has this file" });
      }, wait);
    } finally {
      files.remove(staged);
    }
  }

  async function keep(handle: AppFileHandle): Promise<Result<void>> {
    const keeping = deps.keeping();
    if (keeping.kind === "sync") keeping.changed();
    if (keeping.kind !== "upload") return ok(undefined);
    const sent = await withLinks(
      async (links) => {
        const link = links[0]!;
        return uploadFile({ files, dir, remote: link.remote, app: deps.app }, handle);
      },
      true,
    );
    if (sent.ok || sent.error.code === "unavailable") return sent;
    // The computer answered and said no; its words stay in the text.
    return unavailable(`the computer refused the file: ${sent.error.message}`, "refused");
  }

  return {
    folder: () => files.absolute(dir),
    async ensure(file) {
      if (!APP_FILE_HASH.test(file)) {
        return err({ code: "invalid_input", message: "a file is named by its sha256" });
      }
      const path = pathIn(dir, file);
      if (!files.exists(path)) {
        const running = taking.get(file) ?? take(file);
        taking.set(file, running);
        const done = await running.finally(() => taking.delete(file));
        if (!done.ok) return done;
      }
      return ok({ uri: files.uri(path) });
    },
    async add(candidate) {
      if (candidate.size !== undefined && candidate.size > APP_FILE_MAX_BYTES) return tooLarge();
      sweep();
      const staged = stagedName();
      let path: string | null = null;
      let fresh = false;
      try {
        try {
          await files.copyIn(candidate.uri, staged);
        } catch {
          return unavailable("the file could not be read");
        }
        const disk = await files.digest(staged);
        if (disk === null) return unavailable("the file could not be read");
        if (disk.size > APP_FILE_MAX_BYTES) return tooLarge();
        path = pathIn(dir, disk.sha256);
        fresh = !files.exists(path);
        const type =
          candidate.type !== undefined && candidate.type.length > 0 && candidate.type.length <= 127
            ? candidate.type
            : "application/octet-stream";
        const positive = (value: number | undefined) =>
          value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
        const width = positive(candidate.width);
        const height = positive(candidate.height);
        const name = candidate.name?.slice(0, 255);
        const handle: AppFileHandle = {
          file: disk.sha256,
          type,
          size: disk.size,
          ...(name === undefined || name === "" ? {} : { name }),
          ...(width === undefined || height === undefined ? {} : { width, height }),
        };
        if (fresh) {
          // The sidecar first: a file is never in the place without it.
          const meta: Meta = { type, size: disk.size, ...(handle.name === undefined ? {} : { name: handle.name }) };
          files.write(`${path}.json`, JSON.stringify(meta));
          files.move(staged, path);
        }
        const kept = await keep(handle);
        if (!kept.ok) {
          // The screen gets no handle, so nothing may keep the bytes (a computer-run app could not save the file anyway).
          if (fresh) {
            files.remove(path);
            files.remove(`${path}.json`);
          }
          return kept;
        }
        return ok(handle);
      } finally {
        files.remove(staged);
      }
    },
  };
}

/** A file name for the share sheet: no path characters, never `.` or `..`, and at most 255 bytes of UTF-8 with the extension kept. */
export function shareName(name: string | undefined): string {
  const clean = (name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim()
    .replace(/^\.+$/, "");
  if (clean === "") return "file";
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  if (bytes(clean) <= 255) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : "";
  const base = [...(ext === "" ? clean : clean.slice(0, dot))];
  while (base.length > 0 && bytes(base.join("") + ext) > 255) base.pop();
  return (base.join("") || "file") + ext;
}

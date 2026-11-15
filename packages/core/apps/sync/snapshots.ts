// 폰이 처음(과 release가 바뀔 때, '다시 snapshot' 줄에 닿을 때) 받는 컴퓨터 앱 DB의 사본. core가 그 앱의 write 줄을
// 쥔 채 log의 마지막 seq를 읽고 앱 process가 `VACUUM INTO`로 사본을 쓰므로 사본은 정확히 그 seq까지를 담는다.
// core는 DB를 열지 않고 bytes만 준다. 사본은 core 소유의 임시 file(`<앱 폴더>/sync-snapshots/<id>.sqlite`)이고
// 크기·sha256·만료는 메모리에만 있다. 만료되거나 끝까지 읽힌 file은 지우고, core가 다시 뜨면 남은 것을 모두 지운다.
import { mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type Clock,
  err,
  formatAt,
  type IdSource,
  ok,
  type Result,
} from "../../../base/mod.ts";
import type { appSyncSnapshot } from "../../../protocol/apps/app-sync.ts";
import { appFolder } from "../../../protocol/apps/app-storage.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { z } from "zod";
import type { AppProcessLink } from "../ports.ts";
import type { SyncLog } from "./log.ts";
import { activeOf, deviceOf, notDevice } from "./service.ts";

type SnapshotOutput = z.output<typeof appSyncSnapshot.output>;

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_DIR = "sync-snapshots";

type Held = {
  app: string;
  device: string;
  path: string;
  size: number;
  expiresMs: number;
};

export type SnapshotsDeps = {
  dataRoot: string;
  log: Pick<SyncLog, "head">;
  // 접수가 열리기를 기다린 뒤 그 앱의 write 줄을 쥔 채 돈다(calls의 `phone.exclusive`). 줄이 정리되면 null.
  exclusive<T>(app: Id<"app">, work: () => Promise<T>): Promise<T | null>;
  link: Pick<AppProcessLink, "snapshot">;
  activeRelease(app: Id<"app">): Result<Id<"rel"> | null>;
  isSync(app: string, release: string): boolean;
  clock: Clock;
  ids: IdSource;
  // 만료 timer. core가 끝날 때 기다리지 않는다.
  later?(fn: () => void, ms: number): void;
};

function notFound(): Result<never> {
  return err({ code: "not_found", message: "snapshot not found" });
}

export function createSnapshots(deps: SnapshotsDeps) {
  const held = new Map<string, Held>();
  const later =
    deps.later ??
    ((fn: () => void, ms: number) => {
      setTimeout(fn, ms).unref();
    });

  async function drop(id: string): Promise<void> {
    const one = held.get(id);
    held.delete(id);
    if (one !== undefined) await rm(one.path, { force: true });
  }

  async function sweep(): Promise<void> {
    const now = deps.clock.nowMs();
    for (const [id, one] of [...held]) {
      if (one.expiresMs <= now) await drop(id);
    }
  }

  return {
    async take(
      principal: string,
      input: { app: string },
    ): Promise<Result<SnapshotOutput>> {
      const device = deviceOf(principal);
      if (device === null) return notDevice();
      await sweep();
      const app = input.app as Id<"app">;
      const known = activeOf(deps, app);
      if (!known.ok) return known;
      if (!deps.isSync(app, known.value)) return notFound();
      const id = deps.ids.newId("snp");
      const dir = join(appFolder(deps.dataRoot, app), SNAPSHOT_DIR);
      await mkdir(dir, { recursive: true });
      const path = join(dir, `${id}.sqlite`);
      const taken = await deps.exclusive(app, async () => {
        // 접수를 기다리는 동안 activation이 release를 바꿨을 수 있다.
        const active = activeOf(deps, app);
        if (!active.ok) return active;
        if (!deps.isSync(app, active.value)) return notFound();
        const seq = deps.log.head(app);
        const written = await deps.link.snapshot(app, { path });
        if (!written.ok) return written;
        if (written.value.status === "not_sync") return notFound();
        return ok({ release: active.value, seq, ...written.value });
      });
      if (taken === null || !taken.ok) {
        await rm(path, { force: true });
        return (
          taken ?? err({ code: "unavailable", message: "the app stopped" })
        );
      }
      const expiresMs = deps.clock.nowMs() + SNAPSHOT_TTL_MS;
      held.set(id, { app, device, path, size: taken.value.size, expiresMs });
      later(() => void drop(id), SNAPSHOT_TTL_MS);
      return ok({
        snapshot: id,
        release: taken.value.release,
        seq: taken.value.seq,
        size: taken.value.size,
        sha256: taken.value.sha256,
        expires_at: formatAt(expiresMs),
      });
    },

    // 사본의 한 구간. 부른 기기의 것만 읽는다(다른 자격에는 없는 것과 같다).
    async read(
      principal: string,
      input: { snapshot: string; offset: number; length: number },
    ): Promise<Result<Uint8Array>> {
      await sweep();
      const one = held.get(input.snapshot);
      if (one === undefined || one.device !== deviceOf(principal)) {
        return notFound();
      }
      if (input.offset > one.size) {
        return err({
          code: "invalid_input",
          message: "offset is past the end",
        });
      }
      const length = Math.min(input.length, one.size - input.offset);
      const bytes = new Uint8Array(length);
      // 앱을 지우면 file이 앱 폴더와 같이 사라진다.
      const file = await open(one.path, "r").catch(() => null);
      if (file === null) {
        held.delete(input.snapshot);
        return notFound();
      }
      try {
        let read = 0;
        while (read < length) {
          const { bytesRead } = await file.read(
            bytes,
            read,
            length - read,
            input.offset + read,
          );
          if (bytesRead === 0) break;
          read += bytesRead;
        }
      } finally {
        await file.close();
      }
      if (input.offset + length >= one.size) await drop(input.snapshot);
      return ok(bytes);
    },

    /** core가 뜰 때. 앞선 core가 남긴 사본을 지운다. */
    async clean(): Promise<void> {
      const apps = await readdir(join(deps.dataRoot, "apps")).catch(
        () => [] as string[],
      );
      for (const app of apps) {
        await rm(join(deps.dataRoot, "apps", app, SNAPSHOT_DIR), {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

export type Snapshots = ReturnType<typeof createSnapshots>;

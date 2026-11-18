// 사람의 폴더(`folder.shared`)는 `computers` 폴더의 거울이다.
// - 내보내기 뒤: 자기 하위 폴더에서 자기 manifest 사슬이 싣는 file을 그 폴더의 같은 path로 복사하고(manifest는 마지막에),
//   사슬에 없는 자기 file을 지운다. 쓰기는 그 폴더에 대한 writer라 자기 하위 폴더 밖은 쓰지 않는다.
// - 읽기 scan 때: 그 폴더의 다른 기계 manifest를 받는 자리에 넘기고, 받는 자리가 바라는 file이 거기 있으면 넘긴다. 서명과
//   크기·hash는 받는 자리가 보므로 그 폴더를 믿지 않는다. 읽기(import)는 이 폴더를 바로 읽지 않는다.
import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ok, type RandomSource, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  expectedFiles,
  MANIFEST_MAX_BYTES,
  manifestPath,
} from "../../protocol/remote/carry.ts";
import { machineDir } from "../../protocol/folder/layout.ts";
import { createFolderReader, createFolderWriter } from "./fs.ts";
import { createShaCache, parseManifestText, type Replica } from "./replica.ts";

const decoder = new TextDecoder();

export type Mirror = {
  /** 자기 하위 폴더를 사람의 폴더에 맞춘다. */
  copyOut(shared: string): Promise<Result<void>>;
  /** 사람의 폴더에 있는 다른 기계의 manifest와 file을 받는 자리에 넘긴다. */
  takeIn(shared: string): Promise<void>;
};

// 한 기계의 take-in이 도는 횟수의 상한. 사슬은 manifest, 앱 목록, release.json·source json, 그 아래 file의 네 층이다.
const TAKE_IN_PASSES_MAX = 8;

export function createMirror(deps: {
  me(): Id<"mch">;
  /** 명단 view에 그 기계의 하나뿐인 컴퓨터 항목이 있다. */
  known(machine: Id<"mch">): boolean;
  /** `computers` 폴더 경로. */
  computers: string;
  replica: Replica;
  random: RandomSource;
}): Mirror {
  const shas = createShaCache();
  return {
    async copyOut(shared) {
      const me = deps.me();
      const from = (path: string) => join(deps.computers, ...path.split("/"));
      let text: string;
      try {
        text = readFileSync(from(manifestPath(me)), "utf8");
      } catch {
        return ok(undefined);
      }
      const body = parseManifestText(text);
      if (body === null || body.machine !== me) return ok(undefined);
      const files = expectedFiles(body, (path) => {
        try {
          return readFileSync(from(path));
        } catch {
          return null;
        }
      });
      const writer = createFolderWriter({
        root: shared,
        machine: me,
        random: deps.random,
      });
      const to = (path: string) => join(shared, ...path.split("/"));
      for (const [path, want] of files) {
        if (await shas.matches(to(path), want)) continue;
        // 아직 자기 폴더에 없는 file(쓰는 중인 run)은 다음 번에 복사한다.
        if (!(await shas.matches(from(path), want))) continue;
        const done = await writer.writeStream(
          path,
          createReadStream(from(path)),
        );
        if (!done.ok) return done;
      }
      const manifest = new TextEncoder().encode(text);
      let mirrored: string | null = null;
      try {
        mirrored = readFileSync(to(manifestPath(me)), "utf8");
      } catch {
        // 아직 없다.
      }
      if (mirrored !== text) {
        const done = await writer.writeFile(manifestPath(me), manifest);
        if (!done.ok) return done;
      }
      // 사슬에 없는 자기 file(compaction, 지운 release, 옛 event)을 지운다.
      const base = to(machineDir(me));
      let entries;
      try {
        entries = readdirSync(base, { recursive: true, withFileTypes: true });
      } catch {
        return ok(undefined);
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const path = [
          machineDir(me),
          ...join(entry.parentPath, entry.name)
            .slice(base.length + 1)
            .split(/[\\/]/),
        ].join("/");
        if (path === manifestPath(me) || files.has(path)) continue;
        const done = await writer.remove(path);
        if (!done.ok) return done;
      }
      return ok(undefined);
    },

    async takeIn(shared) {
      const reader = createFolderReader(shared);
      const machines = await reader.listMachines();
      if (!machines.ok) return;
      for (const machine of machines.value) {
        // 명단의 컴퓨터가 아닌 하위 폴더는 열지 않는다: 그 폴더는 누구나 쓸 수 있어 지어낸 기계마다 8 MiB를 읽게 된다.
        if (machine === deps.me() || !deps.known(machine)) continue;
        const read = await reader.read(
          manifestPath(machine),
          MANIFEST_MAX_BYTES,
        );
        if (read.ok) {
          await deps.replica.offerManifest(
            decoder.decode(read.value),
            "folder",
          );
        }
        // 받은 목록 file이 그 아래 file을 새로 바라게 하므로 더 받을 것이 없을 때까지 돈다. 이번에 이미 받은 path를 또
        // 받으면 멈춘다(대소문자만 다른 두 path가 같은 file인 OS에서 서로 덮으며 끝없이 돈다).
        const accepted = new Set<string>();
        for (
          let pass = 0, again = true;
          again && pass < TAKE_IN_PASSES_MAX;
          pass++
        ) {
          again = false;
          for (const want of await deps.replica.wantedOf(machine)) {
            const head = await reader.readHead(want.path, 0);
            if (!head.ok || head.value.size !== want.size) continue;
            const done = await deps.replica.receive({
              machine,
              path: want.path,
              size: want.size,
              sha256: want.sha256,
              via: "folder",
              // 받는 자리가 읽기 시작할 때만 연다(받지 않으면 열린 채 남지 않는다).
              chunks: (async function* () {
                const stream = await reader.readStream(want.path, 0);
                if (stream.ok) yield* stream.value.chunks;
              })(),
            });
            if (!done.ok || done.value !== "accepted") continue;
            if (accepted.has(want.path)) {
              again = false;
              break;
            }
            accepted.add(want.path);
            again = true;
          }
        }
      }
    },
  };
}

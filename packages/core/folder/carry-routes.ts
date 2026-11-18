// route `carry/manifests|wants|file|put`의 handler. 모두 받는 자리(`replica.ts`)에 넘긴다. `carry/put`만 폰이 조각으로
// 넘기는 file을 staging의 (machine, path) file에 offset대로 이어 쓰고, 다 차면 받는 자리에 넘긴다. 첫 조각에서 받는 자리에
// 맞는 entry가 없으면 아무것도 쓰지 않고 `rejected`다. 끝나지 않은 staging은 `CARRY_STAGING_KEEP_MS` 뒤 지운다.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { type Clock, err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  CARRY_WANTS_MAX,
  type CarryPutStatus,
  carryFile,
  carryManifests,
  carryPut,
  carryWants,
  MANIFEST_MAX_BYTES,
  manifestPathMachine,
} from "../../protocol/folder/carry.ts";
import { CARRY_STAGING_KEEP_MS } from "../../protocol/folder/limits.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  bytesFileStream,
  type FileStreamHandler,
  type MemoryHandler,
  type ReadHandler,
} from "../server/mod.ts";
import type { Replica } from "./replica.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

type PutInput = {
  machine: Id<"mch">;
  path: string;
  size: number;
  sha256: string;
  offset: number;
  bytes: string;
};

export function carryRoutes(deps: {
  me(): Id<"mch">;
  /** 명단 view에 그 기계의 하나뿐인 컴퓨터 항목이 있다(그 manifest만 staging에 받는다). */
  known(machine: Id<"mch">): boolean;
  replica: Replica;
  clock: Clock;
}): {
  reads: [string, ReadHandler][];
  memory: [string, MemoryHandler][];
  fileStreams: [string, FileStreamHandler][];
} {
  const { replica } = deps;
  const staging = replica.stagingDir;
  // 한 (넘기는 기기, machine, path)의 조각은 하나씩 잇는다. 같은 조각을 다시 보낸 것(timeout 뒤 재시도)이 겹쳐 이어
  // 쓰이면 맞는 bytes가 깨져 rejected가 되고, 폰은 rejected인 사본을 지운다.
  const lanes = new Map<string, Promise<unknown>>();
  function oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (lanes.get(key) ?? Promise.resolve()).then(work);
    const settled = next.catch(() => undefined);
    lanes.set(key, settled);
    void settled.then(() => {
      if (lanes.get(key) === settled) lanes.delete(key);
    });
    return next;
  }

  async function sweep(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(staging);
    } catch {
      return;
    }
    const cutoff = deps.clock.nowMs() - CARRY_STAGING_KEEP_MS;
    for (const name of names) {
      if (!name.startsWith("put-")) continue;
      const path = join(staging, name);
      try {
        if ((await stat(path)).mtimeMs < cutoff)
          await rm(path, { force: true });
      } catch {
        // 사이에 끝났다.
      }
    }
  }

  function put(
    principal: string,
    input: PutInput,
  ): Promise<Result<CarryPutStatus>> {
    const key = createHash("sha256")
      .update(`${principal}\n${input.machine}\n${input.path}`)
      .digest("hex");
    return oneAtATime(key, () => putChunk(join(staging, `put-${key}`), input));
  }

  async function putChunk(
    file: string,
    input: PutInput,
  ): Promise<Result<CarryPutStatus>> {
    const { machine, path } = input;
    const bytes = Buffer.from(input.bytes, "base64");
    const isManifest = manifestPathMachine(path) === machine;
    await sweep();
    if (input.offset === 0) {
      if (isManifest) {
        // 명단의 컴퓨터 것만 받는다: 지어낸 기계 id마다 8 MiB씩 staging을 채우지 못한다.
        if (
          input.size > MANIFEST_MAX_BYTES ||
          (machine !== deps.me() && !deps.known(machine))
        ) {
          await rm(file, { force: true });
          return ok("rejected");
        }
      } else {
        // 자기 file은 내보내기만 쓴다.
        if (machine === deps.me()) {
          return ok((await replica.holds(machine, path)) ? "have" : "rejected");
        }
        const want = replica.expected(machine, path);
        if (
          want === null ||
          want.size !== input.size ||
          want.sha256 !== input.sha256
        ) {
          await rm(file, { force: true });
          return ok("rejected");
        }
        if (await replica.holds(machine, path)) {
          await rm(file, { force: true });
          return ok("have");
        }
      }
      await mkdir(staging, { recursive: true, mode: 0o700 });
      // 앞서 받다 만 것은 버리고 처음부터다.
      await writeFile(file, bytes, { mode: 0o600, flag: "w" });
    } else {
      let held: number;
      try {
        held = (await stat(file)).size;
      } catch {
        held = 0;
      }
      if (held !== input.offset) {
        return err({
          code: "invalid_input",
          message: `offset ${input.offset} does not continue the ${held} bytes received; start again at offset 0`,
        });
      }
      await appendFile(file, bytes);
    }
    const total = input.offset + bytes.byteLength;
    if (total > input.size) {
      await rm(file, { force: true });
      return ok("rejected");
    }
    if (total < input.size) return ok("partial");
    try {
      if (isManifest) {
        const text = await readFile(file);
        const sha = createHash("sha256").update(text).digest("hex");
        let named: unknown;
        try {
          named = (
            JSON.parse(text.toString("utf8")) as {
              body?: { machine?: unknown };
            }
          ).body?.machine;
        } catch {
          named = null;
        }
        if (
          text.byteLength !== input.size ||
          sha !== input.sha256 ||
          named !== machine
        ) {
          return ok("rejected");
        }
        return await replica.offerManifest(text.toString("utf8"), "phone");
      }
      return await replica.receive({
        machine,
        path,
        size: input.size,
        sha256: input.sha256,
        via: "phone",
        chunks: createReadStream(file),
      });
    } finally {
      await rm(file, { force: true });
    }
  }

  return {
    reads: [
      [
        key(carryManifests),
        async () => {
          const listed = await replica.manifests();
          if (!listed.ok) return listed;
          return ok({
            manifests: listed.value.map(
              ({ machine, revision, size, sha256 }) => ({
                machine,
                revision,
                size,
                sha256,
              }),
            ),
          });
        },
      ],
      [
        key(carryWants),
        async (_auth: AuthenticatedContext, input: unknown) => {
          const { limit, after } = input as {
            limit?: number;
            after?: { machine: Id<"mch">; path: string };
          };
          const files = await replica.wants(limit ?? CARRY_WANTS_MAX, after);
          return files.ok ? ok({ files: files.value }) : files;
        },
      ],
    ],
    memory: [
      [
        key(carryPut),
        async (auth: AuthenticatedContext, input: unknown) => {
          const done = await put(auth.principal, input as PutInput);
          return done.ok ? ok({ status: done.value }) : done;
        },
      ],
    ],
    fileStreams: [
      [
        key(carryFile),
        async (_auth: AuthenticatedContext, input: unknown) => {
          const { machine, path, offset, length } = input as {
            machine: Id<"mch">;
            path: string;
            offset: number;
            length: number;
          };
          const read = await replica.read(machine, path, offset, length);
          return read.ok
            ? ok(bytesFileStream(read.value, "application/octet-stream"))
            : read;
        },
      ],
    ],
  };
}

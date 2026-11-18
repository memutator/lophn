import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  CARRY_CHUNK_MAX_BYTES,
  CARRY_WANTS_MAX,
} from "../../protocol/folder/carry.ts";
import type { FolderReplica } from "../folder/ports.ts";
import { carryFrom, type PeerCall } from "./carry.ts";

const machine = "mch_01jx0000000000000000000000" as Id<"mch">;
const zeros = "0".repeat(64);

// 상대: `carry/manifests`는 빈 목록이고 `carry/file`은 든 file의 구간을 base64로 준다. 없는 file은 not_found다.
function peer(held: Map<string, Uint8Array>): PeerCall {
  return (resource, method, body) => {
    if (resource === "carry" && method === "manifests") {
      return Promise.resolve(ok({ manifests: [] }));
    }
    const { path, offset, length } = body as {
      path: string;
      offset: number;
      length: number;
    };
    const bytes = held.get(path);
    if (bytes === undefined) {
      return Promise.resolve(err({ code: "not_found", message: "not held" }));
    }
    const slice = bytes.subarray(offset, offset + length);
    return Promise.resolve(
      ok({
        content_type: "application/octet-stream",
        base64: Buffer.from(slice).toString("base64"),
      }),
    );
  };
}

// 받는 자리: 바라는 file은 (machine, path) 순서로 `after` 뒤부터 준다. 받은 file은 조각을 이어 붙여 둔다.
function replica(wanted: { path: string; size: number }[]) {
  const received: { path: string; bytes: Buffer }[] = [];
  const sorted = [...wanted].sort((a, b) => (a.path < b.path ? -1 : 1));
  const port: FolderReplica = {
    manifests: () => Promise.resolve(ok([])),
    offerManifest: () => Promise.resolve(ok("rejected")),
    wants: (limit, after) =>
      Promise.resolve(
        ok(
          sorted
            .filter((each) => after === undefined || each.path > after.path)
            .slice(0, limit)
            .map((each) => ({ machine, sha256: zeros, ...each })),
        ),
      ),
    holds: () => Promise.resolve(false),
    read: () => Promise.resolve(err({ code: "not_found", message: "" })),
    async receive(input) {
      const parts: Uint8Array[] = [];
      for await (const chunk of input.chunks) parts.push(chunk);
      received.push({ path: input.path, bytes: Buffer.concat(parts) });
      return ok("accepted");
    },
  };
  return { port, received };
}

const at = (n: number) =>
  `machines/${machine}/apps/app_01jx0000000000000000000000/data/${String(n).padStart(12, "0")}.changes`;

test("조각 여럿인 file은 offset 순서로 receive 하나에 가고 상대가 갖지 않은 file은 건너뛴다", async () => {
  const big = new Uint8Array(CARRY_CHUNK_MAX_BYTES + 5);
  for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 251;
  const { port, received } = replica([
    { path: at(1), size: big.length },
    { path: at(2), size: 3 },
  ]);
  const done = await carryFrom(peer(new Map([[at(1), big]])), port);
  assert.deepEqual(done, ok({ more: true }));
  assert.equal(received.length, 1);
  assert.equal(received[0]!.path, at(1));
  assert.ok(Buffer.from(big).equals(received[0]!.bytes));
});

test("상대가 갖지 않은 file로 찬 page가 다음 page를 막지 않는다", async () => {
  const absent = Array.from({ length: CARRY_WANTS_MAX }, (_, i) => ({
    path: at(i + 1),
    size: 1,
  }));
  const last = at(CARRY_WANTS_MAX + 1);
  const { port, received } = replica([...absent, { path: last, size: 2 }]);
  const done = await carryFrom(
    peer(new Map([[last, new Uint8Array([1, 2])]])),
    port,
  );
  assert.deepEqual(done, ok({ more: true }));
  assert.deepEqual(
    received.map((each) => [each.path, [...each.bytes]]),
    [[last, [1, 2]]],
  );
});

// 명단 file `machines/<자기 id>/roster.json`: 이 컴퓨터가 든 명단 statement를 `computers` 폴더에 두어 manifest가 싣는다.
// 주소(reach)는 싣지 않는다(폴더는 명단 밖의 누구나 쓸 수 있다). statement가 같으면 다시 쓰지 않는다.
import {
  canonicalize,
  type Clock,
  ok,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  ROSTER_FILE_MAX_BYTES,
  rosterFilePath,
  rosterFileSchema,
} from "../../../protocol/folder/carry.ts";
import {
  decodeRecord,
  encodeRecord,
} from "../../../protocol/folder/records.ts";
import type { RosterStatement } from "../../../protocol/remote/roster.ts";
import { createFolderReader, createFolderWriter } from "../fs.ts";

/** 썼으면 true. statement가 없거나(remote가 꺼져 있다) 같으면 쓰지 않는다. */
export async function writeRosterFile(input: {
  root: string;
  me: Id<"mch">;
  statements: readonly RosterStatement[] | null;
  clock: Clock;
  random: RandomSource;
}): Promise<Result<boolean>> {
  const { me, statements } = input;
  if (statements === null) return ok(false);
  const path = rosterFilePath(me);
  const read = await createFolderReader(input.root).read(
    path,
    ROSTER_FILE_MAX_BYTES,
  );
  const held = read.ok
    ? decodeRecord(rosterFileSchema, read.value, ROSTER_FILE_MAX_BYTES)
    : null;
  if (
    held?.ok &&
    canonicalize(held.value.statements) === canonicalize(statements)
  ) {
    return ok(false);
  }
  const bytes = encodeRecord(rosterFileSchema, {
    format: 1,
    machine: me,
    written_at: input.clock.now(),
    statements: [...statements],
  });
  if (bytes.byteLength > ROSTER_FILE_MAX_BYTES) return ok(false);
  const written = await createFolderWriter({
    root: input.root,
    machine: me,
    random: input.random,
  }).writeFile(path, bytes);
  return written.ok ? ok(true) : written;
}

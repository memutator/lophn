// 다른 컴퓨터의 명단 file `machines/<mch>/roster.json`을 읽어 statement만 명단에 넘긴다. `computers` 폴더(받는 자리가 둔
// 것)와 사람의 폴더(manifest 없이도: 아직 믿지 못하는 컴퓨터의 들어오기 statement가 이 길로 온다) 둘 다 읽는다. 믿는
// 서명이 없는 statement는 명단 규칙이 스스로 거른다. 주소는 폴더로 받지 않는다. 지난번과 같은 bytes는 다시 넘기지 않는다.
// 명단에 없는 기계의 file은 폴더에 쓸 수 있는 누구나 지어낼 수 있다: scan마다 `CARRY_UNKNOWN_ROSTER_FILES_MAX`개만 돌아가며
// 읽고, 그 기계 이름의 컴퓨터 항목이 다루는 key의 statement만 `ROSTER_JOIN_STATEMENTS_MAX`개까지 넘긴다(들어오기에 드는 만큼).
import { type Result, sha256Hex } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  ROSTER_FILE_MAX_BYTES,
  rosterFilePath,
  rosterFileSchema,
} from "../../../protocol/folder/carry.ts";
import { CARRY_UNKNOWN_ROSTER_FILES_MAX } from "../../../protocol/folder/limits.ts";
import { decodeRecord } from "../../../protocol/folder/records.ts";
import {
  ROSTER_JOIN_STATEMENTS_MAX,
  type RosterStatement,
} from "../../../protocol/remote/roster.ts";
import { createFolderReader } from "../fs.ts";

export type RosterFiles = {
  /** `root`(폴더) 아래 다른 기계의 명단 file을 읽는다. `source`는 지난번 bytes를 가르는 이름이다. */
  readFrom(root: string, source: string): Promise<void>;
};

// 명단에 없는 기계 M의 file에서 넘길 것: M 이름의 컴퓨터 항목이 다루는 key의 statement.
function joinStatements(
  machine: Id<"mch">,
  statements: readonly RosterStatement[],
): RosterStatement[] {
  const keys = new Set(
    statements.flatMap((each) =>
      "machine" in each.body &&
      each.body.kind === "computer" &&
      each.body.machine === machine
        ? [each.body.key]
        : [],
    ),
  );
  return statements
    .filter((each) => keys.has(each.body.key))
    .slice(0, ROSTER_JOIN_STATEMENTS_MAX);
}

export function createRosterFiles(deps: {
  me(): Id<"mch">;
  /** 명단 view에 그 기계의 하나뿐인 컴퓨터 항목이 있다. */
  known(machine: Id<"mch">): boolean;
  receive(statements: readonly RosterStatement[]): Promise<Result<void>>;
  log(message: string): void;
}): RosterFiles {
  const last = new Map<string, string>();
  // source마다 명단에 없는 기계를 어디까지 읽었나(돌아가며 읽는다).
  const after = new Map<string, string>();
  return {
    async readFrom(root, source) {
      const reader = createFolderReader(root);
      const listed = await reader.listMachines();
      if (!listed.ok) return;
      const others = listed.value.filter((machine) => machine !== deps.me());
      const known = others.filter((machine) => deps.known(machine));
      const unknown = others.filter((machine) => !deps.known(machine));
      const from = after.get(source) ?? "";
      const turn = [
        ...unknown.filter((machine) => machine > from),
        ...unknown.filter((machine) => machine <= from),
      ].slice(0, CARRY_UNKNOWN_ROSTER_FILES_MAX);
      if (turn.length > 0) after.set(source, turn.at(-1)!);
      for (const machine of [...known, ...turn]) {
        const path = rosterFilePath(machine);
        const read = await reader.read(path, ROSTER_FILE_MAX_BYTES);
        if (!read.ok) continue;
        const key = `${source}\n${machine}`;
        const hash = await sha256Hex(read.value);
        if (last.get(key) === hash) continue;
        const file = decodeRecord(
          rosterFileSchema,
          read.value,
          ROSTER_FILE_MAX_BYTES,
        );
        if (!file.ok || file.value.machine !== machine) {
          deps.log(`${source} ${path}: not a roster file of that machine`);
          last.set(key, hash);
          continue;
        }
        const statements = deps.known(machine)
          ? file.value.statements
          : joinStatements(machine, file.value.statements);
        const done = await deps.receive(statements);
        if (done.ok) last.set(key, hash);
        else deps.log(`${source} ${path}: ${done.error.message}`);
      }
    },
  };
}

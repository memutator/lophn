// 다른 컴퓨터의 명단 file `machines/<mch>/roster.json`을 읽어 statement만 명단에 넘긴다. 믿는 서명이 없는 statement는 명단
// 규칙이 스스로 거른다. 주소는 폴더로 받지 않는다. 지난번과 같은 bytes는 다시 넘기지 않는다.
// - 명단의 컴퓨터의 것은 `computers` 폴더에서만 읽는다: 그 기계가 서명한 목록이 실은 것이라 아무나 바꿔 scan마다 명단 계산을
//   돌리게 하지 못한다(사람의 폴더의 것은 거울 take-in이 검증해 `computers`로 들인다).
// - 명단에 없는 기계의 것은 사람의 폴더에서 바로 읽는다(아직 믿지 못하는 컴퓨터의 들어오기 statement가 이 길로만 온다). 그
//   폴더는 누구나 쓸 수 있어 지어낸 기계가 끝없을 수 있으니 scan마다 `CARRY_UNKNOWN_ROSTER_FILES_MAX`개만 돌아가며 읽고, 그
//   기계 이름의 컴퓨터 항목이 다루는 key의 statement만 `ROSTER_JOIN_STATEMENTS_MAX`개까지 넘긴다(들어오기에 드는 만큼).
import { type Result, sha256Hex } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  ROSTER_FILE_MAX_BYTES,
  rosterFilePath,
  rosterFileSchema,
} from "../../../protocol/remote/carry.ts";
import { CARRY_UNKNOWN_ROSTER_FILES_MAX } from "../../../protocol/folder/limits.ts";
import { decodeRecord } from "../../../protocol/folder/records.ts";
import {
  ROSTER_JOIN_STATEMENTS_MAX,
  type RosterStatement,
} from "../../../protocol/remote/roster.ts";
import { createFolderReader } from "../fs.ts";

export type RosterFiles = {
  /** `computers` 폴더에서 명단의 컴퓨터의 명단 file을 읽는다. */
  readKnown(computers: string): Promise<void>;
  /** 사람의 폴더에서 명단에 없는 기계의 명단 file을 몇 개씩 읽는다. */
  readUnknown(shared: string): Promise<void>;
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
  // 명단에 없는 기계를 어디까지 읽었나(돌아가며 읽는다).
  let after = "";

  async function offer(
    reader: ReturnType<typeof createFolderReader>,
    source: string,
    machine: Id<"mch">,
    join: boolean,
  ): Promise<void> {
    const path = rosterFilePath(machine);
    const read = await reader.read(path, ROSTER_FILE_MAX_BYTES);
    if (!read.ok) return;
    const key = `${source}\n${machine}`;
    const hash = await sha256Hex(read.value);
    if (last.get(key) === hash) return;
    const file = decodeRecord(
      rosterFileSchema,
      read.value,
      ROSTER_FILE_MAX_BYTES,
    );
    if (!file.ok || file.value.machine !== machine) {
      deps.log(`${source} ${path}: not a roster file of that machine`);
      last.set(key, hash);
      return;
    }
    const done = await deps.receive(
      join
        ? joinStatements(machine, file.value.statements)
        : file.value.statements,
    );
    if (done.ok) last.set(key, hash);
    else deps.log(`${source} ${path}: ${done.error.message}`);
  }

  const others = async (root: string) => {
    const reader = createFolderReader(root);
    const listed = await reader.listMachines();
    return {
      reader,
      machines: listed.ok
        ? listed.value.filter((machine) => machine !== deps.me())
        : [],
    };
  };

  return {
    async readKnown(computers) {
      const { reader, machines } = await others(computers);
      for (const machine of machines) {
        if (deps.known(machine)) {
          await offer(reader, "computers", machine, false);
        }
      }
    },
    async readUnknown(shared) {
      const { reader, machines } = await others(shared);
      const unknown = machines.filter((machine) => !deps.known(machine));
      const turn = [
        ...unknown.filter((machine) => machine > after),
        ...unknown.filter((machine) => machine <= after),
      ].slice(0, CARRY_UNKNOWN_ROSTER_FILES_MAX);
      if (turn.length > 0) after = turn.at(-1)!;
      for (const machine of turn) await offer(reader, "shared", machine, true);
    },
  };
}

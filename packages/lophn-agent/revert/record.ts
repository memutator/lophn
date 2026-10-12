import type { Result } from "../../base/mod.ts";
import type { recordRewindFile } from "../../contracts/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
} from "../../contracts/platform/mod.ts";
import type { RewindStore } from "./store.ts";

// 문서 tool이 파일을 쓰기 직전에 pre-image를 남기는 기록(RecordRewindFile)과, 그 호출을 쓰기에
// 감싸는 harness 쪽 배선이다(lophn-agent/revert R13·R14). 구현은 agent-RW3a가 채운다.
// RW3a의 범위는 이 command와 recordBeforeWrite까지다. 실제 문서 쓰기 tool(harness/tools/bundles/document.ts의
// document.create·document.save_version)에 이 배선을 거는 일은 documents가 파일 기반 쓰기로 바뀐 뒤 따로
// 한다(지금 그 tool은 documents의 version 저장 contract를 부른다).

// 한도 판정(R14)과 같은 `(tool_call, path)` 중복 처리는 이 command가 한다. 한도를 넘는 쓰기는 막지
// 않고 그 checkpoint를 `files_restorable=false`로 낮춘다. 한 번 낮아진 checkpoint는 되돌아가지 않고 이유도
// 처음 것을 지킨다. 이유: 크기가 한도(10 MB)를 넘으면 `limit_file`, 크기는 한도 안인데 blob이 없으면(저장소
// 쓰기 실패) `record_failed`, 개수·총량은 `limit_count`·`limit_total`.
export function createRecordRewindFile(): CommandDefinition<
  typeof recordRewindFile
> {
  throw new Error("not implemented: agent-RW3a");
}

export type RecorderPorts = {
  store: Pick<RewindStore, "put">;
  // project 폴더 기준 상대 경로의 지금 내용. 파일이 없으면 null.
  read(path: string): Promise<Uint8Array | null>;
  // RecordRewindFile command를 부른다(실행 중인 run의 agent 자격).
  record(
    input: Input<typeof recordRewindFile>,
  ): Promise<Result<Output<typeof recordRewindFile>>>;
};

export type RecordedWrite = {
  // 기록이 한도 안에서 pre-image를 남겼나. 기록에 실패했거나 한도를 넘었으면 false다.
  recorded: boolean;
};

// 쓰기 직전에 before를 읽고 pre-image를 저장소에 두고, write()를 부르고, 쓴 직후에 after를 읽어
// RecordRewindFile을 부른다. 기록이나 저장이 실패해도 쓰기는 막지 않는다. 쓰기 자체가 실패하면
// 기록하지 않고 그 오류를 돌려준다. 이름 변경은 옛 경로(moved_from)의 내용을 before로 남긴다.
export function recordBeforeWrite(
  ports: RecorderPorts,
  write: {
    session: string;
    tool_call: string;
    path: string;
    moved_from: string | null;
    run(): Promise<Result<void>>;
  },
): Promise<Result<RecordedWrite>> {
  void ports;
  void write;
  throw new Error("not implemented: agent-RW3a");
}

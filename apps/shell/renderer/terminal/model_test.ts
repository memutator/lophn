import { assertEquals } from "@std/assert";

import type { TerminalRuntime } from "../../ipc/terminal.ts";
import {
  acceptOutput,
  endingOf,
  endingWording,
  folderTitle,
  phaseOfReply,
  splitInput,
} from "./model.ts";

const runtime = (patch: Partial<TerminalRuntime> = {}): TerminalRuntime => ({
  terminal_ref: "term_1",
  project: "prj_1",
  folder_ref: "prj_1_0",
  cwd_at_start: "/work/app",
  program_path: "/bin/bash",
  launch_kind: "shell",
  state: "running",
  generation: 1,
  columns: 80,
  rows: 24,
  exit_code: null,
  failure_reason: null,
  output_seq: 0,
  dropped_output: false,
  ...patch,
});

Deno.test("shell/terminal#R9: 확인된 종료·시작 실패·결과 불명·종료 확인 실패를 구별한다", () => {
  assertEquals(endingOf(runtime()), null);
  assertEquals(endingOf(runtime({ state: "exited", exit_code: 0 })), "exited");
  assertEquals(
    endingOf(runtime({ state: "exited", failure_reason: "spawn_failed" })),
    "start_failed",
  );
  assertEquals(
    endingOf(runtime({ state: "unknown", failure_reason: "host_lost" })),
    "unknown",
  );
  assertEquals(
    endingOf(runtime({ state: "unknown", failure_reason: "kill_unconfirmed" })),
    "stop_unconfirmed",
  );
});

Deno.test("shell/terminal#R9: exit code는 확인된 값만 문구에 싣고 없으면 추측하지 않는다", () => {
  assertEquals(endingWording("exited", 2), {
    wording: { key: "terminal.status.exited", values: { code: "2" } },
    tone: "warning",
  });
  assertEquals(
    endingWording("exited", null).wording.key,
    "terminal.status.ended",
  );
  assertEquals(
    endingWording("unknown", null).wording.key,
    "terminal.status.unknown",
  );
  assertEquals(
    endingWording("start_failed", null).wording.key,
    "terminal.status.start-failed",
  );
});

Deno.test("shell/terminal#R1: 여러 등록 폴더 답은 고르기 화면이고 시작하지 않는다", () => {
  const phase = phaseOfReply({
    ok: false,
    reason: "choose_folder",
    message: "choose",
    folders: [
      { folder_ref: "prj_1_0", path: "/work/a" },
      { folder_ref: "prj_1_1", path: "/work/b" },
    ],
  });
  assertEquals(phase.kind, "choose");
  if (phase.kind === "choose") assertEquals(phase.folders.length, 2);
});

Deno.test("shell/terminal#R2: 쓸 수 없는 폴더는 이유를 가진 거절이다", () => {
  for (
    const reason of ["no_folder", "not_directory", "unreadable"] as const
  ) {
    assertEquals(phaseOfReply({ ok: false, reason, message: "x" }), {
      kind: "refused",
      reason,
    });
  }
  assertEquals(
    phaseOfReply({ ok: false, reason: "host_lost", message: "x" }),
    { kind: "refused", reason: "unavailable" },
  );
});

Deno.test("shell/terminal#R7: 건너뛴 seq나 host의 dropped 표시는 출력 일부 없음이다", () => {
  const chunk = (seq: number, dropped = false) => ({
    terminal_ref: "term_1",
    generation: 1,
    seq,
    chunk: `c${seq}`,
    dropped_output: dropped,
  });
  const first = acceptOutput(0, 1, [chunk(1), chunk(2)]);
  assertEquals(first, { writes: ["c1", "c2"], lastSeq: 2, missing: false });
  const again = acceptOutput(2, 1, [chunk(2), chunk(3)]);
  assertEquals(again.writes, ["c3"]);
  assertEquals(acceptOutput(0, 1, [chunk(5)]).missing, true);
  assertEquals(acceptOutput(0, 1, [chunk(1, true)]).missing, true);
  // 다른 generation의 늦은 출력은 쓰지 않는다.
  assertEquals(acceptOutput(0, 2, [chunk(1)]).writes, []);
});

Deno.test("shell/terminal#R3: 큰 붙여넣기는 순서를 지켜 IPC 상한 안으로 자른다", () => {
  const text = "a".repeat(9000) + "😀" + "b".repeat(10);
  const parts = splitInput(text, 9001);
  assertEquals(parts.join(""), text);
  for (const part of parts) assertEquals(part.length <= 9001, true);
  assertEquals(parts[0]!.length, 9000);
});

Deno.test("shell/workspace#R1: 터미널 탭 제목은 시작 폴더의 이름이다", () => {
  assertEquals(folderTitle("/work/app/"), "app");
  assertEquals(folderTitle("C:\\work\\site"), "site");
  assertEquals(folderTitle("/"), null);
});

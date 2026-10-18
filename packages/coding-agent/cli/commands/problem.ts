// `lophn problem`: 문제를 읽고, 두 release 사이 source diff를 본다.
import { type CommandEntry, entryOf } from "./types.ts";

export const PROBLEM_COMMANDS: readonly CommandEntry[] = [
  entryOf("problem list", "진행 중인 문제 목록을 읽는다"),
  entryOf(
    "problem show",
    "문제 하나를 읽는다. message 앞부분은 problem occurrence로 읽는다",
  ),
  entryOf(
    "problem more",
    "문제의 근거를 종류를 골라 더 읽는다. log 본문은 problem body로 읽는다",
  ),
  entryOf(
    "problem occurrence",
    "문제의 발생 하나의 message 앞부분과 근거를 읽는다",
  ),
  entryOf("problem body", "발생의 message, details, log 본문을 읽는다"),
  entryOf("problem diff", "두 release 사이 source 차이를 읽는다"),
];

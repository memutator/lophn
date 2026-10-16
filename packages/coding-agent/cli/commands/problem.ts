// `lophn problem`: 문제를 읽고, 두 release 사이 source diff를 보고, 고친 기록을 남긴다.
import { err } from "../../../base/mod.ts";
import { recordFix } from "../../connection/mod.ts";
import { type CommandEntry, entryOf, noToken } from "./types.ts";

export const PROBLEM_COMMANDS: readonly CommandEntry[] = [
  entryOf("problem list", "진행 중인 문제 목록을 읽는다"),
  entryOf("problem show", "문제 하나를 읽는다"),
  entryOf("problem more", "문제의 근거를 종류를 골라 더 읽는다"),
  entryOf("problem diff", "두 release 사이 source 차이를 읽는다"),
  entryOf("problem fix-records", "문제의 지난 고친 기록을 읽는다"),
  entryOf("problem record-fix", "summary 본문을 올리고 고친 기록을 남긴다", {
    run: (input, ctx) =>
      ctx.client === undefined
        ? Promise.resolve(err(noToken()))
        : recordFix(ctx.client, input, ctx.idempotencyKey),
  }),
];

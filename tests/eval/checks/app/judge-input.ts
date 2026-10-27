// judge가 받는 입력을 만든다. fixture(core === null)에서도 빈 글이 아닌 글을 돌려준다.

import { releasesListRecords } from "../../../../packages/protocol/apps/activation/activation.ts";
import { appTools } from "../../../../packages/protocol/apps/declaration/read.ts";
import { appGet } from "../../../../packages/protocol/apps/mod.ts";
import type { Id } from "../../../../packages/protocol/base/mod.ts";
import type { AskInput } from "../../../../packages/protocol/lophn-agent/ask-tool.ts";
import {
  messageBody,
  receivedMessageList,
} from "../../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../../../support/core/mod.ts";
import { asksGapInput, joinInput } from "../../judge/mod.ts";
import type { CheckInput, TrialRecord } from "../../types.ts";
import { toolCallsOf } from "../records.ts";
import { clip, designOf } from "./design-doc.ts";
import type { BugSpec } from "./diagnose.ts";
import { findApp } from "./live.ts";
import { git } from "./reuse.ts";

// request는 사람 말(`say`)이다.
export function askedAgainInput(
  request: string,
): (input: CheckInput) => string {
  return ({ trial }) => {
    const questions = toolCallsOf(trial, "ask").flatMap(
      (c) =>
        (c.input as { questions?: AskInput["questions"] } | null)?.questions ??
        [],
    );
    return asksGapInput(request, questions);
  };
}

// 앱이 선언한 tool과 연결, App Engineer가 쓴 DESIGN.md 전체를 카드와 견주게 한다.
export function cardCoveredInput(
  card: string,
  app: string,
): (input: CheckInput) => Promise<string> {
  return async (input) => {
    let declaration = "(not available)";
    if (input.core !== null) {
      const found = await findApp(input.core, app);
      const read = await input.core.call(appTools, { app: found.id });
      declaration = [
        ...read.tools.map(
          (a) =>
            `- ${a.name} (${a.effect}): ${a.description} input=${JSON.stringify(
              a.inputSchema,
            )}`,
        ),
        ...read.facts.app_connections.map(
          (c) => `connection: ${c.app} -> ${c.tools.join(", ")}`,
        ),
      ].join("\n");
    }
    const text = await designOf(input, app);
    return joinInput([
      { label: "CARD", text: card },
      { label: "DECLARATION", text: clip(declaration) },
      {
        label: "DESIGN",
        text: text === null ? "(DESIGN.md not found)" : clip(text),
      },
    ]);
  };
}

// 문제를 말한 뒤 App Engineer의 마지막 답과, 되살린 bug release에서 가장 큰 번호 release까지 고친 diff.
// 켜지 못한 trial에서도 고친 곳을 보도록 켜진 release가 아니라 가장 큰 번호를 쓴다.
export function rootCauseInput(
  bug: BugSpec,
  app: string,
): (input: CheckInput) => Promise<string> {
  return async ({ trial, core }) => {
    let answer = "(not available)";
    let diff = "(not available)";
    if (core !== null) {
      answer = await lastAnswer(core, trial, app);
      diff = await fixDiff(core, app);
    }
    return joinInput([
      {
        label: "BUG",
        text: `${bug.description}\nfiles: ${bug.files.join(", ")}`,
      },
      { label: "ANSWER", text: clip(answer) },
      { label: "FIX_DIFF", text: clip(diff) },
    ]);
  };
}

async function lastAnswer(
  core: Core,
  trial: TrialRecord,
  app: string,
): Promise<string> {
  const session = trial.sessions.findLast(
    (s) => s.agent.role === "app_engineer" && s.place?.name === app,
  )?.session as Id<"ses"> | undefined;
  if (session === undefined) return "(no answer)";
  const { messages } = await core.call(receivedMessageList, { session });
  const last = messages
    .filter((m) => m.from.kind === "agent" && m.from.session === session)
    .reduce<(typeof messages)[number] | null>(
      (a, m) =>
        a === null || BigInt(m.created_seq) > BigInt(a.created_seq) ? m : a,
      null,
    );
  if (last === null) return "(no answer)";
  const { content } = await core.call(messageBody, { message: last.id });
  const text = content.parts
    .flatMap((p) => (p.kind === "text" ? [p.text] : []))
    .join("\n");
  return text === "" ? "(no answer)" : text;
}

async function fixDiff(core: Core, app: string): Promise<string> {
  const found = await findApp(core, app);
  const { app: got } = await core.call(appGet, { app: found.id });
  const { releases } = await core.call(releasesListRecords, { app: found.id });
  const sorted = [...releases].sort((a, b) => a.number - b.number);
  const from = sorted[0];
  const to = sorted.at(-1);
  if (
    got.source_path === null ||
    from === undefined ||
    to === undefined ||
    from.code_commit === to.code_commit
  ) {
    return "(no new release)";
  }
  return await git(got.source_path, [
    "diff",
    from.code_commit,
    to.code_commit,
    "--",
    ".",
    ":(exclude)package-lock.json",
  ]);
}

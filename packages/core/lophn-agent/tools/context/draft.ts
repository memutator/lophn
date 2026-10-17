import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import {
  bundleOpenDraftRoute,
  glossaryListRoute,
  glossaryRemoveRoute,
  glossarySetRoute,
} from "../../../../protocol/projects/mod.ts";
import { commandOf, readOf } from "../../run-loop/core-call.ts";
import { fitted, invalid, notFound } from "../fit-result.ts";
import type { ToolContext } from "../tool-context.ts";

// Project Manager가 context의 새 판을 만드는 쓰기다.

// 새 판의 초안 폴더를 연다. context가 없으면 새 context를 첫 판과 함께 만든다.
// 폴더는 lophn data 안에 있다. 계약과 검색 script는 이 폴더에 file.write로 쓴다.
export async function openDraft(
  ctx: ToolContext,
  input: { context?: string; name?: string; purpose?: string },
): Promise<Result<ToolResult>> {
  let body;
  if (input.context !== undefined) {
    body = { context: input.context };
  } else {
    if (ctx.place?.kind !== "project") {
      return invalid("a new context is made in a project");
    }
    if (input.name === undefined || input.purpose === undefined) {
      return invalid("a new context needs a name and a purpose");
    }
    body = {
      new: {
        id: ctx.ids.newId("ctx"),
        project: ctx.place.id,
        title: input.name,
        purpose: input.purpose,
      },
    };
  }
  const opened = await commandOf(
    ctx.core,
    bundleOpenDraftRoute,
    body,
    {},
    ctx.tool_call,
  );
  if (!opened.ok) return opened;
  const { context, bundle, folder } = opened.value;
  return ok(fitted(
    `draft ${bundle} of context ${context} is open at ${folder}`,
    { context, draft: bundle, folder },
  ));
}

// 용어의 뜻을 정하고 고친다. remove가 참이면 지운다. 용어는 context 안에서 글이 같으면 같은 항목이다.
export async function setGlossary(
  ctx: ToolContext,
  input: {
    context: string;
    term: string;
    meaning: string;
    remove?: boolean;
  },
): Promise<Result<ToolResult>> {
  const term = input.term.trim();
  const listed = await readOf(ctx.core, glossaryListRoute, {
    context: input.context,
  });
  if (!listed.ok) return listed;
  const entry = listed.value.entries.find((e) => e.term === term);

  if (input.remove === true) {
    if (entry === undefined) return notFound("no such term");
    const removed = await commandOf(
      ctx.core,
      glossaryRemoveRoute,
      { entry: entry.id },
      { base_revision: entry.revision },
      ctx.tool_call,
    );
    if (!removed.ok) return removed;
    return ok(fitted(`removed the term ${term}`, { term }));
  }

  const set = entry === undefined
    ? await commandOf(
      ctx.core,
      glossarySetRoute,
      {
        id: ctx.ids.newId("trm"),
        context: input.context,
        term,
        meaning: input.meaning,
      },
      {},
      ctx.tool_call,
    )
    : await commandOf(
      ctx.core,
      glossarySetRoute,
      { entry: entry.id, meaning: input.meaning },
      { base_revision: entry.revision },
      ctx.tool_call,
    );
  if (!set.ok) return set;
  return ok(fitted(`set the term ${term}`, {
    term: set.value.term,
    meaning: set.value.meaning,
  }));
}

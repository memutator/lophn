import { err, ok, type Result } from "../../../packages/base/mod.ts";
import {
  contextCreateRoute,
  contextGetRoute,
} from "../../../packages/protocol/projects/mod.ts";
import {
  openSession,
  say,
  until,
  waitTurnEnd,
} from "../../support/core/human.ts";
import type { JournalEntry, Reply } from "../../support/fake-server/mod.ts";
import { lastToolResult } from "../../support/fake-server/probe.ts";
import type { Id } from "../../../packages/protocol/base/mod.ts";
import type { SetupContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

// PM이 `context_draft` -> bundle 쓰기 -> `context_test` -> `context_submit`을 하는 fake 대본이다.
// 진짜 model 없이 제품의 draft 길(격리 test와 적용)을 그대로 지난다.
const afterDraft = (bundle: string) => (request: JournalEntry): Reply => {
  const result = lastToolResult(request) ?? "";
  let content: { context?: string; draft?: string; folder?: string } = {};
  try {
    content = JSON.parse(result).content ?? {};
  } catch {
    // 결과가 JSON이 아니면 아래에서 text로 끝낸다.
  }
  const { context, draft, folder } = content;
  if (context === undefined || draft === undefined || folder === undefined) {
    return { kind: "text", text: `no draft: ${result}` };
  }
  const target = JSON.stringify({ context, draft });
  return {
    kind: "tool",
    calls: [
      {
        id: "t_write",
        name: "file_write",
        arguments: JSON.stringify({
          path: `${folder}/bundle.json`,
          content: bundle,
        }),
      },
      { id: "t_test", name: "context_test", arguments: target },
      { id: "t_submit", name: "context_submit", arguments: target },
    ],
  };
};

export async function restoreContext(
  ctx: SetupContext,
  material: Material,
): Promise<Result<void>> {
  const { core, fake } = ctx;
  const spec = JSON.parse(textOf(material, "context.json")) as {
    project: string;
    name: string;
    title: string;
    purpose: string;
  };
  const project = ctx.world.projects[spec.project];
  if (project === undefined) {
    return err({
      code: "invalid_input",
      message: `context ${spec.name}: project ${spec.project} not restored`,
    });
  }
  const id = material.manifest.ids[spec.name] as Id<"ctx">;
  await core.call(contextCreateRoute, {
    id,
    project,
    title: spec.title,
    purpose: spec.purpose,
  });

  fake.reset();
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: [{
          id: "t_draft",
          name: "context_draft",
          arguments: JSON.stringify({ context: id }),
        }],
      },
    },
    // bundle은 JSON 한 줄로 줄여도 같은 내용이다.
    {
      reply: afterDraft(
        JSON.stringify(JSON.parse(textOf(material, "bundle.json"))),
      ),
    },
    { reply: { kind: "text", text: "done" } },
  ]);
  const session = await openSession(core, { role: "project_manager", project });
  await say(core, session, "make the context");
  await waitTurnEnd(core, session);
  try {
    await until("context 적용", async () => {
      const read = await core.call(contextGetRoute, { context: id });
      return read.applied === null ? undefined : true;
    }, 15_000);
  } catch {
    const last = fake.journal().map((entry) => lastToolResult(entry)).filter((
      text,
    ) => text !== undefined).at(-1);
    return err({
      code: "internal",
      message: `context ${spec.name} was not applied: ${
        last ?? "no tool result"
      }`,
    });
  }
  ctx.world.contexts[spec.name] = id;
  return ok(undefined);
}

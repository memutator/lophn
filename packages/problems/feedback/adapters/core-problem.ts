// collector가 core loopback으로 기존 문제를 읽는 adapter(grouping#R6). fetch는
// 주입받는다: core graph의 EXTERNAL_FETCH tripwire가 bare fetch를 금지하므로
// property 접근으로만 부른다. 없는 문제와 범위 밖 문제는 같은 null이다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { getProblemOutputSchema } from "../../../protocol/problems/mod.ts";
import type { CoreCall } from "../../snapshots/mod.ts";
import type { SelectedProblem } from "../model.ts";

const UNREADABLE = "문제를 읽지 못했다";

export function coreProblemLookup(client: CoreCall) {
  return async (id: string): Promise<Result<SelectedProblem | null>> => {
    let response: { status: number; bytes: Uint8Array };
    try {
      response = await client.fetch(
        `${client.baseUrl.replace(/\/$/, "")}/v1/problems/get`,
        {
          method: "POST",
          headers: {
            "authorization": `Bearer ${client.credential}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ problem: id }),
        },
      );
    } catch {
      return err({ code: "unavailable", message: UNREADABLE });
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(response.bytes));
    } catch {
      return err({ code: "unavailable", message: UNREADABLE });
    }
    if (response.status !== 200) {
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      return code === "not_found" || code === "forbidden"
        ? ok(null)
        : err({ code: "unavailable", message: UNREADABLE });
    }
    const parsed = getProblemOutputSchema.safeParse(body);
    if (!parsed.success) {
      return err({ code: "unavailable", message: UNREADABLE });
    }
    const problem = parsed.data.problem;
    return ok({
      id: problem.id,
      app: problem.app,
      group_key: problem.group_key,
    });
  };
}

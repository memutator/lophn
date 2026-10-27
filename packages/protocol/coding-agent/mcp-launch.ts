// coding agent 실행 계획에 lophn MCP endpoint 설정을 더하는 순수 함수다. harness마다 방법이 다르고
// harness-adapter의 `mcp` 칸이 고른다. 설정은 이 session의 계획(argv·env)에만 실린다.
// token 원문은 받지 않는다. 설정은 env 이름 `CODING_TOKEN_ENV`만 참조하고, 값은 호출자가 plan.env에 둔다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { z } from "zod";
import { HARNESS_ADAPTERS } from "./harness-adapter.ts";
import { codingLaunchPlanSchema } from "./launch-plan.ts";
import { CODING_MCP_SERVER_NAME } from "./mcp.ts";
import { CODING_TOKEN_ENV } from "./token.ts";

type Plan = z.infer<typeof codingLaunchPlanSchema>;

// url은 core가 연 `http://127.0.0.1:<port>/mcp`다.
export function withCodingMcp(plan: Plan, url: string): Result<Plan> {
  const name = CODING_MCP_SERVER_NAME;
  let next: Plan = plan;
  switch (HARNESS_ADAPTERS[plan.harness_id].mcp) {
    case null:
      return ok(plan);
    case "argv_after_prompt": {
      const config = {
        mcpServers: {
          [name]: {
            type: "http",
            url,
            headers: { Authorization: `Bearer \${${CODING_TOKEN_ENV}}` },
          },
        },
      };
      // `--mcp-config`는 variadic이라 뒤의 positional을 삼킨다. prompt 뒤 맨 끝에 둔다.
      next = {
        ...plan,
        argv: [...plan.argv, "--mcp-config", JSON.stringify(config)],
      };
      break;
    }
    case "argv_before_prompt": {
      // root option이라 model flag 앞(실행 파일 이름 바로 뒤)에 둔다.
      const flags = [
        "-c",
        `mcp_servers.${name}.url=${JSON.stringify(url)}`,
        "-c",
        `mcp_servers.${name}.bearer_token_env_var=${JSON.stringify(
          CODING_TOKEN_ENV,
        )}`,
      ];
      next = {
        ...plan,
        argv: [plan.argv[0], ...flags, ...plan.argv.slice(1)],
      };
      break;
    }
    case "env": {
      const config = {
        mcp: {
          [name]: {
            type: "remote",
            url,
            headers: { Authorization: `Bearer {env:${CODING_TOKEN_ENV}}` },
          },
        },
      };
      next = {
        ...plan,
        env: { ...plan.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
      };
      break;
    }
  }
  const checked = codingLaunchPlanSchema.safeParse(next);
  return checked.success
    ? ok(checked.data)
    : err({
        code: "invalid_input",
        message: "MCP를 더한 실행 계획이 올바르지 않다",
      });
}

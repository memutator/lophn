// core가 보낸 coding plan을 host가 PTY spawn 인자로 바꾼다. shell 없이 executable·분리 argv·cwd·env로
// 열고 다른 harness·cwd로 대체하지 않는다. env는 상속 환경에서 platform 값을 빼고 env_delete를 지운 뒤
// plan의 env(coding token 포함)를 얹은 것이다. token 값은 log나 오류에 넣지 않는다.

import { codingLaunchPlanSchema } from "../../protocol/coding-agent/launch-plan.ts";
import type { CodingHost } from "./coding-types.ts";
import { stripPlatformEnv } from "./env.ts";

export function createCodingHost(): CodingHost {
  return {
    prepare(raw, context) {
      const parsed = codingLaunchPlanSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "spawn_failed",
          message: "launch plan is not valid",
        };
      }
      const plan = parsed.data;
      // main이 확인했어도 host가 연 순간의 cwd를 한 번 더 본다.
      const checked = context.checkFolder(plan.cwd);
      if (!checked.ok) {
        return {
          ok: false,
          reason: checked.reason,
          message: "app source folder cannot be used",
        };
      }
      const env = stripPlatformEnv(context.env);
      for (const name of plan.env_delete) delete env[name];
      Object.assign(env, plan.env);
      return {
        ok: true,
        launch: {
          plan: {
            session: plan.session,
            app: plan.app,
            harness_id: plan.harness_id,
            title: plan.title,
            prompt_by_argv: plan.prompt_delivery.mode === "argv",
          },
          file: plan.executable,
          args: plan.argv.slice(1),
          cwd: checked.path,
          env,
        },
      };
    },
  };
}

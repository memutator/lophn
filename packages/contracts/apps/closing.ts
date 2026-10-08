import { z } from "zod";
import { defineRead, idSchema, withReadCommon } from "../platform/mod.ts";
import { releaseSchema } from "../apps/releases.ts";

// 앱의 현재 활성 releaseRead(apps/releases#R13). problems/closing 반응기가 after가 현재
// 활성 release인지 machine 판정 compare로 다시 볼 때 쓴다. read입니다: فعال release가
// 바뀌는 것은 activation이고, 이 read는 어떤 release도 바꾸지 않는다.
export const activeReleaseReadInputSchema = z.strictObject({
  app: idSchema("app"),
});
export const activeReleaseReadOutputSchema = withReadCommon(
  z.object({ release: releaseSchema.nullable() }),
);
export const activeRelease = defineRead({
  resource: "releases",
  method: "active",
  name: "ActiveRelease",
  input: activeReleaseReadInputSchema,
  output: activeReleaseReadOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

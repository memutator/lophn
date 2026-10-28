import { z } from "zod";
import { idSchema } from "../base/ids.ts";

const workPlaceBranches = [
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
] as const;

const workPlaceOutputBranches = [
  z.object({ kind: z.literal("project"), id: idSchema("prj") }),
  z.object({ kind: z.literal("app"), id: idSchema("app") }),
] as const;

// 개설 자리. file cwd가 아니고, kind와 id 접두사 짝만 local syntax로 고정한다. session은
// project나 app 자리에만 있어 전역 자리(global)가 없다.
export const workPlaceSchema = z.discriminatedUnion("kind", workPlaceBranches);

export const workPlaceOutputSchema = z.discriminatedUnion(
  "kind",
  workPlaceOutputBranches,
);

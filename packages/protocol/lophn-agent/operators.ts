import type { z } from "zod";
import {
  agentDefinitionOutputSchema,
  agentDefinitionSchema,
  agentNameSchema,
} from "./agent-values.ts";

// Operator 정의: 이름, profile, model, context, skill·MCP 끄기와 지침(body)이다. agent grant와 앱 Operator의
// project 폴더는 사람만 정하므로 정의에 없다(agents의 사람용 route가 다룬다).
const definitionKeys = {
  profile: true,
  model: true,
  contexts: true,
  skills_off: true,
  mcp_off: true,
  body: true,
} as const;

export const operatorDefinitionSchema = agentDefinitionSchema
  .pick(definitionKeys)
  .extend({ name: agentNameSchema });
export const operatorDefinitionOutputSchema = agentDefinitionOutputSchema
  .pick(definitionKeys)
  .extend({ name: agentNameSchema });
export type OperatorDefinition = z.infer<typeof operatorDefinitionSchema>;

// operator.update용. 보낸 칸만 바꾼다.
export const operatorDefinitionPatchSchema = operatorDefinitionSchema.partial();
export type OperatorDefinitionPatch = z.infer<
  typeof operatorDefinitionPatchSchema
>;

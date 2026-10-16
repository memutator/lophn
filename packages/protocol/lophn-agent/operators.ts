import { z } from "zod";
import {
  agentDefinitionOutputSchema,
  agentDefinitionSchema,
  agentNameSchema,
} from "./agent-values.ts";
import { mcpServerSchema } from "./mcp-settings.ts";

// agent 층 MCP 서버. 이름이 같은 서버는 둘 수 없다.
const mcpServersSchema = z.array(mcpServerSchema).max(32).refine(
  (servers) =>
    new Set(servers.map((server) => server.name)).size === servers.length,
  { message: "mcp server names must be unique" },
);

// Operator 정의: 이름, profile, model, context, skill·MCP 끄기, agent 층 MCP 서버와 지침(body)이다.
// agent grant와 앱 Operator의 project 폴더는 사람만 정하므로 정의에 없다(grant는 approvals/grants.ts).
// 정의는 파일 전체의 새 내용이다: 없는 칸은 지워진다.
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
  .extend({ name: agentNameSchema, mcp_servers: mcpServersSchema.optional() });
export const operatorDefinitionOutputSchema = agentDefinitionOutputSchema
  .pick(definitionKeys)
  .extend({ name: agentNameSchema, mcp_servers: mcpServersSchema.optional() });
export type OperatorDefinition = z.infer<typeof operatorDefinitionSchema>;

// operator.update용. 보낸 칸만 바꾼다.

// 내장 role(lophn, Project Manager, App Engineer)의 정의. 사람이 고치는 것은 지침, model, skill·MCP 끄기뿐이다.
// 이름과 profile은 role이 고정하고 tool 목록은 role이 정한다.
const builtinKeys = {
  model: true,
  skills_off: true,
  mcp_off: true,
  body: true,
} as const;
export const builtinDefinitionSchema = agentDefinitionSchema.pick(builtinKeys);
export const builtinDefinitionOutputSchema = agentDefinitionOutputSchema.pick(
  builtinKeys,
);
export type BuiltinDefinition = z.infer<typeof builtinDefinitionSchema>;

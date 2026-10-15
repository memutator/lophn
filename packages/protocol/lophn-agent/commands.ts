import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import type { Role } from "./places.ts";
import { SKILL_SOURCES } from "./skill-settings.ts";

// Agent composer의 `/` 명령 registry(lophn-agent/commands). registry는 저장하는
// 표가 아니라 열 때마다 계산하는 derived 값이라 command도 event도 없고 read 하나뿐이다.

export const COMMAND_SOURCES = ["builtin", "role", "skill"] as const;
export const COMMAND_WHILE_RUNNING = ["run", "queue", "blocked"] as const;
// 전역 built-in 아홉 개의 id이자 이름이다. 이 배열의 순서가 메뉴의 고정 순서다.
export const BUILTIN_COMMAND_IDS = [
  "new",
  "rename",
  "archive",
  "compact",
  "fork",
  "mcp",
  "skills",
  "permissions",
  "recap",
] as const;

// role 명령(정해진 prompt)의 이름이다. Project Manager의 new-context는 내장 skill context-init과 겹쳐 뺐다.
export const ROLE_COMMAND_NAMES = {
  lophn: ["new-app", "repair-app"],
  project_manager: ["check-contracts"],
  app_engineer: [],
  operator: [],
} as const satisfies Record<Role, readonly string[]>;

const nonempty = z.string().regex(/\S/);

export const commandNameSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

export const commandActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("builtin"),
    id: z.enum(BUILTIN_COMMAND_IDS),
  }),
  z.strictObject({ kind: z.literal("prompt"), template: nonempty.max(4096) }),
  z.strictObject({ kind: z.literal("tool"), tool: nonempty.max(128) }),
  z.strictObject({ kind: z.literal("skill"), skill_name: commandNameSchema }),
]);

export type CommandAction = z.infer<typeof commandActionSchema>;

// 세 출처가 같은 모양을 쓴다. 출처와 action, title, skill_origin은 서로 맞아야 한다.
export const commandEntrySchema = z.object({
  name: commandNameSchema,
  // built-in·role 명령의 메뉴 제목(New session). skill은 제목 없이 이름을 쓴다.
  title: nonempty.max(64).nullable(),
  description: nonempty.max(1024),
  source: z.enum(COMMAND_SOURCES),
  // skill을 찾은 층. 같은 이름이 둘 이상일 때만 메뉴에 보인다.
  skill_origin: z.enum(SKILL_SOURCES).nullable(),
  while_running: z.enum(COMMAND_WHILE_RUNNING),
  action: commandActionSchema,
}).refine((value) => {
  if (value.source === "builtin") {
    return value.action.kind === "builtin" && value.title !== null &&
      value.skill_origin === null;
  }
  if (value.source === "role") {
    return (value.action.kind === "prompt" || value.action.kind === "tool") &&
      value.title !== null && value.skill_origin === null;
  }
  return value.action.kind === "skill" && value.title === null &&
    value.action.skill_name === value.name;
}, { message: "command source, action, title and skill origin do not match" });

export type CommandEntry = z.infer<typeof commandEntrySchema>;

// `/`로는 부를 수 없게 된 skill이다. 이름이 예약된 built-in(전역이나 그 agent의
// role 명령)과 같아 registry 목록에서 빠지고 사람에게는 이 알림으로 알린다.
// skill 자체는 읽을 수 있다.
export const commandNoticeSchema = z.object({
  kind: z.literal("reserved_name"),
  name: commandNameSchema,
  reserved_by: z.enum(["builtin", "role"]),
});

export type CommandNotice = z.infer<typeof commandNoticeSchema>;

export const commandsListInputSchema = z.strictObject({
  session: idSchema("ses"),
});

// 그 session의 agent 기준 목록이다: 전역 built-in, 그 role의 built-in, 그 agent가
// 쓸 수 있는 skill의 순서. 끈 skill은 없다.
export const commandsListOutputSchema = withReadCommon(z.object({
  commands: z.array(commandEntrySchema).max(512),
  notices: z.array(commandNoticeSchema).max(512),
}));

export const commandsList = defineRead({
  resource: "commands",
  method: "list",
  name: "ListCommands",
  input: commandsListInputSchema,
  output: commandsListOutputSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const COMMAND_ROUTES = [commandsList] as const;

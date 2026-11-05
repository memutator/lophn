import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { agentIdSchema, placeSchema } from "./places.ts";

// Agent composer의 `/` 명령 registry. registry는 저장하는
// 표가 아니라 열 때마다 계산하는 derived 값이라 command도 event도 없고 read 하나뿐이다.

const COMMAND_SOURCES = ["builtin", "skill"] as const;
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
  "status",
] as const;

const nonempty = z.string().regex(/\S/);

const commandNameSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

// 두 출처가 같은 모양을 쓴다. built-in은 제목이 있고 이름이 BUILTIN_COMMAND_IDS에 있다. skill은 제목이 없다.
const commandEntrySchema = z
  .object({
    name: commandNameSchema,
    // built-in 명령의 메뉴 제목(New session). skill은 제목 없이 이름을 쓴다.
    title: nonempty.max(64).nullable(),
    description: nonempty.max(1024),
    source: z.enum(COMMAND_SOURCES),
  })
  .refine(
    (value) => {
      if (value.source === "builtin") {
        return (
          value.title !== null &&
          (BUILTIN_COMMAND_IDS as readonly string[]).includes(value.name)
        );
      }
      return value.title === null;
    },
    { message: "command source, title and name do not match" },
  );

export type CommandEntry = z.infer<typeof commandEntrySchema>;

// session이 없는 새 session 화면은 agent와 place로 읽는다(그 자리에 session을 열면 받을 목록).
const commandsListInputSchema = z.union([
  z.strictObject({ session: idSchema("ses") }),
  z.strictObject({ agent: agentIdSchema, place: placeSchema.nullable() }),
]);

// 그 session의 agent 기준 목록이다: 전역 built-in, 그 agent가 쓸 수 있는 skill의 순서. 끈 skill은 없다.
const commandsListOutputSchema = withReadCommon(
  z.object({
    commands: z.array(commandEntrySchema).max(512),
  }),
);

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

import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory, defineRead } from "../base/route.ts";
import { tabRelationSchema } from "../lophn-agent/host-queue.ts";
import { shellCapabilitySchema } from "../supervision/core-control.ts";

// 사람의 터미널(PTY)이다. core가 PTY host를 자식으로 띄워 터미널을 열고 갖는다. desktop 화면과 폰이 같은 route로 열고, 치고,
// 크기를 잡고, 출력을 받는다. 창이 없어도 열리고 앱을 Quit해도 돈다. 상태는 메모리뿐이고 저장하는 것은 coding agent session의
// identity(`saved_sessions`)뿐이다.
//
// 날 출력은 `watch` lease가 있는 동안만 `TerminalOutputAppended`(남지 않는 event)로 흐른다. 붙는 쪽은 `watch` → `snapshot{after_seq}`
// → 받은 seq보다 큰 event만 쓴다(다른 generation은 버린다). seq가 건너뛰거나 Gateway가 다시 열리면 마지막 seq로 `snapshot`을
// 다시 읽는다. runtime이 바뀌면 lease와 상관없이 `TerminalRuntimeChanged`가 간다.
//
// 실패의 code: 없는 project나 터미널은 not_found, 지금 generation이 아니면 conflict, 폴더 문제(no_folder, not_directory, unreadable)는
// invalid_input, PTY 문제(spawn_failed, kill_unconfirmed, host_lost)는 unavailable이다. 이유는 `details.reason`(terminalFailureSchema)이다.

// 터미널 참조(`trm_…`)다. 꼴은 PTY host가 정한다.
export const terminalRefSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
// 등록 폴더 참조(`<project>_<index>`).
const folderRefSchema = terminalRefSchema;
const generationSchema = z.number().int().min(1);

// 터미널을 열거나 다시 띄우지 못한 이유다. 실패한 route는 이 값을 `details.reason`에 싣는다.
export const terminalFailureSchema = z.enum([
  "no_folder",
  "not_directory",
  "unreadable",
  "spawn_failed",
  "kill_unconfirmed",
  "host_lost",
]);
export type TerminalFailure = z.infer<typeof terminalFailureSchema>;

// 터미널 안에서 도는 coding agent(harness). 무엇이 도는지는 foreground process나 hook이, 상태는 hook만 정한다.
export const terminalAgentSchema = z.strictObject({
  // harness id(`claude`, `codex`, …). 탭 icon을 고른다.
  harness: z.string().min(1),
  // 첫 hook 전이거나 사람이 Esc·Ctrl-C로 끊은 뒤는 unknown이다.
  state: z.enum(["running", "waiting", "idle", "unknown"]),
  // 이 harness의 hook을 한 번이라도 들었다. 끊어서 unknown이 돼도 남는다.
  hooked: z.boolean(),
  // 이 harness의 TUI가 PTY foreground에서 돈다. GUI가 띄운 CLI의 hook만 들었으면 없다.
  foreground: z.literal(true).optional(),
  // hook이 알려 준 harness의 session id. 저장한 session과 이 터미널을 잇는다.
  session: z.string().optional(),
  // 그 session의 첫 prompt 한 줄.
  title: z.string().optional(),
  // hook이 알려 준 harness의 session 이름.
  name: z.string().optional(),
  // program이 OSC로 낸 마지막 제목(상태 글리프를 뗀 것). foreground가 harness TUI가 아니면 shell prompt의 제목이다.
  screen_title: z.string().optional(),
});
export type TerminalAgent = z.infer<typeof terminalAgentSchema>;

export const terminalRuntimeSchema = z.strictObject({
  terminal_ref: terminalRefSchema,
  project: z.string(),
  folder_ref: z.string(),
  cwd_at_start: z.string(),
  program_path: z.string(),
  state: z.enum(["starting", "running", "exited", "unknown"]),
  generation: z.number().int().min(0),
  columns: z.number().int().min(1),
  rows: z.number().int().min(1),
  exit_code: z.number().int().nullable(),
  failure_reason: terminalFailureSchema.nullable(),
  output_seq: z.number().int().min(0),
  dropped_output: z.boolean(),
  // PTY shell의 pid. 뜬 동안만 있다. 앱이 session lifecycle로 받아 process tree를 따라간다.
  shell_pid: z.number().int().optional(),
  agent: terminalAgentSchema.optional(),
  // 탭 줄에 보이는 이름(`terminals/name`). 어느 화면이든 같은 이름을 안다.
  tab_name: z.string().optional(),
  // 폰이 PTY 크기를 잡았다. desktop 탭은 칸에 맞추지 않고 이 크기로 그리고, 사람이 그 탭에서 `resize`하면 놓는다.
  remote_size: z.literal(true).optional(),
});
export type TerminalRuntime = z.infer<typeof terminalRuntimeSchema>;

// host가 16ms·64Ki 단위로 묶은 출력 한 조각이다. seq는 generation 안에서 오른다.
export const terminalOutputSchema = z.strictObject({
  terminal_ref: terminalRefSchema,
  generation: z.number().int().min(0),
  seq: z.number().int().min(0),
  chunk: z.string(),
  dropped_output: z.boolean(),
});
export type TerminalOutput = z.infer<typeof terminalOutputSchema>;

// hook이 session id를 알려 준 coding agent session 하나. project마다 저장한다. 상태는 저장하지 않는다.
export const terminalAgentSessionSchema = z.strictObject({
  harness: z.string().min(1),
  external_session: z.string().min(1),
  project: z.string(),
  folder_ref: z.string(),
  cwd: z.string(),
  // 첫 prompt 한 줄.
  title: z.string().nullable(),
  // harness나 사람이 붙인 session 이름.
  name: z.string().nullable(),
  // 사람이 이름을 정했다. 이후 hook이 준 이름이 덮어쓰지 않는다.
  pinned: z.boolean(),
  // epoch ms.
  started_at: z.number().int(),
  last_at: z.number().int(),
  // harness에 resume 규칙이 있어 다시 열 수 있다.
  resumable: z.boolean(),
});
export type TerminalAgentSession = z.infer<typeof terminalAgentSessionSchema>;

const harnessSchema = z.string().min(1).max(40);
// harness의 resume 명령에 따옴표 없이 들어가는 글자만 받는다.
const externalSessionSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

// 열자마자 shell에 넣을 명령. 제어 문자는 줄바꿈과 tab만 받는다: escape가 숨은 글이 터미널을 움직이지 않게 한다.
export const terminalCommandSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine(
    (text) =>
      [...text].every((char) => {
        const code = char.codePointAt(0)!;
        return (
          code === 0x09 ||
          code === 0x0a ||
          (code >= 0x20 && code !== 0x7f && (code < 0x80 || code > 0x9f))
        );
      }),
    "command has control characters",
  );

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

// 지금 core가 가진 터미널이다. project를 주면 그 project의 것만이다.
export const terminalsList = defineRead({
  resource: "terminals",
  method: "list",
  name: "TerminalsList",
  input: z.strictObject({ project: idSchema("prj").optional() }),
  output: z.strictObject({ terminals: z.array(terminalRuntimeSchema) }),
  actors: ["user"],
  errors,
});

// project의 폴더에서 터미널을 연다. cwd는 등록 폴더 안이어야 하고(아니면 unreadable) folder_ref를 core가 다시 정한다. command는 첫
// 출력 뒤 잠잠할 때 한 번 넣고(한 줄이면 실행, 여러 줄이면 붙여 넣기만), resume은 그 harness의 resume 명령을 친다. 같은 key는 같은
// 답이다. tab이 있으면 그 project를 보이는 창에 터미널 탭을 연다(창이 없어도 터미널은 열린다).
export const terminalsOpen = defineMemory({
  resource: "terminals",
  method: "open",
  name: "TerminalsOpen",
  changes: [],
  input: z.strictObject({
    project: idSchema("prj"),
    folder_ref: folderRefSchema.optional(),
    cwd: z.string().min(1).max(4096).optional(),
    command: terminalCommandSchema.optional(),
    resume: z
      .strictObject({
        harness: harnessSchema,
        external_session: externalSessionSchema,
      })
      .optional(),
    key: z.string().min(1).max(200).optional(),
    tab: z.strictObject({ relation: tabRelationSchema.nullable() }).optional(),
  }),
  output: z.strictObject({
    terminal: terminalRefSchema,
    runtime: terminalRuntimeSchema,
  }),
  actors: ["user"],
  errors,
});

// 터미널을 끝낸다. 지금 generation이 아니면 conflict다.
export const terminalsClose = defineMemory({
  resource: "terminals",
  method: "close",
  name: "TerminalsClose",
  changes: [],
  input: z.strictObject({
    terminal: terminalRefSchema,
    generation: generationSchema,
  }),
  output: z.strictObject({ runtime: terminalRuntimeSchema }),
  actors: ["user"],
  errors,
});

// 같은 터미널의 shell을 다시 띄운다(generation이 오른다). focus 검사를 거친 shell main만 부른다: `connect {client: shell}`이 준
// capability를 싣는다. 없거나 살아 있지 않으면 forbidden이다.
export const terminalsRestart = defineMemory({
  resource: "terminals",
  method: "restart",
  name: "TerminalsRestart",
  changes: [],
  input: z.strictObject({
    terminal: terminalRefSchema,
    generation: generationSchema,
    shell_capability: shellCapabilitySchema,
  }),
  output: z.strictObject({ runtime: terminalRuntimeSchema }),
  actors: ["user"],
  errors,
});

// 터미널에 글을 친다. 부른 principal이 기기면 그 기기의 터미널 입력 허락이, 아니면 살아 있는 shell capability(focus 검사를 거친
// shell main)가 있어야 한다. 둘 다 아니면 forbidden이다. respond는 xterm이 출력의 질의에 답한 것이라 사람 입력으로 세지 않는다.
// generation을 주면 그 generation일 때만 친다. 같은 key는 한 번만 친다.
export const terminalsInput = defineMemory({
  resource: "terminals",
  method: "input",
  name: "TerminalsInput",
  changes: [],
  input: z.strictObject({
    terminal: terminalRefSchema,
    generation: generationSchema.optional(),
    text: z.string().min(1).max(8192),
    key: z.string().min(1).max(200).optional(),
    respond: z.boolean().optional(),
    shell_capability: shellCapabilitySchema.optional(),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

// 보이는 칸의 크기를 PTY에 준다. 폰이 잡은 크기(`remote_size`)를 놓는다. 폰의 크기 잡기는 `terminal_view/resize`다.
export const terminalsResize = defineMemory({
  resource: "terminals",
  method: "resize",
  name: "TerminalsResize",
  changes: [],
  input: z.strictObject({
    terminal: terminalRefSchema,
    generation: generationSchema,
    columns: z.number().int().min(1).max(512),
    rows: z.number().int().min(1).max(256),
  }),
  output: z.strictObject({ runtime: terminalRuntimeSchema }),
  actors: ["user"],
  errors,
});

// host가 파싱해 둔 화면을 읽는다. after_seq 뒤 출력이 있으면 output은 지금 화면을 직렬화한 chunk 하나이고 seq는 그 화면이 담은
// 마지막 출력이다. 없으면 비어 있다.
export const terminalsSnapshot = defineRead({
  resource: "terminals",
  method: "snapshot",
  name: "TerminalsSnapshot",
  input: z.strictObject({
    terminal: terminalRefSchema,
    after_seq: z.number().int().min(0).optional(),
  }),
  output: z.strictObject({
    runtime: terminalRuntimeSchema,
    output: z.array(terminalOutputSchema),
  }),
  actors: ["user"],
  errors,
});

// 이 터미널의 날 출력을 받는다(lease 30초). 10초마다 같은 호출로 갱신한다. key는 (principal, watcher)라 한 principal의 여러 화면이
// 따로 잡는다. lease가 하나라도 있는 동안 core가 `TerminalOutputAppended`를 낸다.
export const terminalsWatch = defineMemory({
  resource: "terminals",
  method: "watch",
  name: "TerminalsWatch",
  changes: [],
  input: z.strictObject({
    terminal: terminalRefSchema,
    watcher: z.string().min(1).max(64),
    on: z.boolean(),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

// 탭 줄에 보이는 이름을 runtime의 `tab_name`으로 둔다. 빈 이름은 이름 없음이다. 알림 제목과 다른 화면의 탭 이름이 이것을 쓴다.
export const terminalsName = defineMemory({
  resource: "terminals",
  method: "name",
  name: "TerminalsName",
  changes: [],
  input: z.strictObject({
    terminal: terminalRefSchema,
    name: z.string().max(200),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

// 그 project에서 저장한 coding agent session. 새것부터다.
export const terminalsSavedSessions = defineRead({
  resource: "terminals",
  method: "saved_sessions",
  name: "TerminalsSavedSessions",
  input: z.strictObject({ project: idSchema("prj") }),
  output: z.strictObject({ sessions: z.array(terminalAgentSessionSchema) }),
  reads: [{ name: "terminal_saved_sessions", id: (input) => input.project }],
  actors: ["user"],
  errors,
});

// 저장한 session에 이름을 쓰고 고정한다. name이 null이면 고정을 푼다. 바뀐 목록을 준다.
export const terminalsRenameSaved = defineMemory({
  resource: "terminals",
  method: "rename_saved",
  name: "TerminalsRenameSaved",
  changes: [{ name: "terminal_saved_sessions", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    harness: harnessSchema,
    external_session: externalSessionSchema,
    name: z.string().min(1).max(200).nullable(),
  }),
  output: z.strictObject({ sessions: z.array(terminalAgentSessionSchema) }),
  actors: ["user"],
  errors,
});

export const TERMINAL_ROUTES = [
  terminalsList,
  terminalsOpen,
  terminalsClose,
  terminalsRestart,
  terminalsInput,
  terminalsResize,
  terminalsSnapshot,
  terminalsWatch,
  terminalsName,
  terminalsSavedSessions,
  terminalsRenameSaved,
] as const;

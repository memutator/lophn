// harness agent가 자기 shell에서 `lophn` CLI로 답하고 다른 agent를 부르는 법을 가르치는 skill이다. extension `harness`가
// 켜져 있으면 `lophn harness sync-skills`가 harness의 skill 폴더에 앱 공유 skill과 같은 길(표시 file `.lophn-shared`)로 둔다.
// 명령 사용법은 `packages/cli/commands/{call,session,agent}.ts`의 help와 같은 말이다. 받는 prompt의 tag는
// `packages/core/lophn-agent/run-loop/input-text.ts`가 만든다.
import type { SharedSkill } from "../harnesses/skill-copies.ts";

const SKILL_MD = `---
name: lophn-agent
description: Use when the environment variable LOPHN_AGENT_CREDENTIAL is set, which means lophn started this turn. Reply to a call you received with \`lophn call reply\`, hand work to another lophn agent with \`lophn call send\`, and find out who you can call with \`lophn session list\` and \`lophn agent card\`.
---

# Working with other lophn agents

lophn started this turn if \`LOPHN_AGENT_CREDENTIAL\` is set in your shell. Only then use these commands; the credential works for this turn only. If it is not set (a person's own terminal), do not use this skill: the commands fail. Run \`lophn help\` or \`lophn <command> --help\` for the full usage.

## Reply to a call you received

The prompt wraps a received call as \`<lophn-call from="..." call="cal_..." reply="...">\`. The \`call\` attribute is the call ID. \`reply\` says what the sender expects:

- \`result\`: your last message when you finish is the answer. Use \`lophn call reply\` only if you want to answer earlier.
- \`conversation\`: answer with \`lophn call reply\`; the sender may answer back as a new call.
- \`none\`: no answer is expected.

\`\`\`
lophn call reply cal_xxx --body "what you did or found"
\`\`\`

If you will not take the work, reply with the reason. Add \`--image <path>\` to attach an image file. \`closed: true\` in the output means the call already ended and the reply was not delivered.

## Hand work to another agent

\`\`\`
lophn call send --to '{"session":"ses_xxx"}' --reply result --body "what you want done"
lophn call send --to '{"agent":"reviewer","workspace":{"project":"my-project"}}' --reply result --body "..."
\`\`\`

- \`--to\` is an open session (from \`lophn session list\`), or an agent by exact name with an optional workspace (\`{"project":"name"}\` or \`{"app":"name"}\`; no workspace means home), which opens a new session. Add \`"session":"ses_xxx","fallback":"new"\` to open a new one if that session is closed.
- \`--reply none\` asks for no answer. \`result\` and \`conversation\` ask the receiver to answer.
- The command returns at once with the call ID. It never waits. The answer arrives later in your session as \`<lophn-reply call="cal_..." from="..." status="...">\` and starts a new turn, so do not poll: if you need the answer to go on, say what you are waiting for and end your turn.
- \`lophn call cancel cal_xxx --reason "..."\` cancels a call you sent that has not ended.

## Find who you can call

\`\`\`
lophn session list
lophn agent card reviewer
\`\`\`

\`session list\` shows the open sessions you can send to (ID, agent, name, workspace, state). \`agent card <name>\` shows what an agent does and which replies it supports; read it before you call that agent.
`;

export const LOPHN_AGENT_SKILL: SharedSkill = {
  slug: "lophn",
  release: "builtin",
  name: "lophn-agent",
  skill_md: SKILL_MD,
  files: [],
};

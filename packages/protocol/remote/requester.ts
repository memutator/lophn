import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { agentIdSchema } from "../lophn-agent/workspaces.ts";
import { machineIdSchema } from "../machine/mod.ts";

// 다른 기계로 넘기는 call의 "요청한 쪽". 부르는 컴퓨터의 core가 자격으로 정해 call frame의 `by`에 싣고, 받는 기계가 그 종류마다 다르게 대한다.
// 누가 어느 kind를 싣는가(입력의 칸으로 싣는 길은 없다. core가 부른 자격에서 만든다):
// - `screen`: 그 기계의 shell이 그린 사람의 화면. 살아 있는 shell capability를 실은 `machines/call`만 만든다.
// - `terminal`: 사람의 터미널. capability 없이 부른 사람의 CLI token의 `machines/call`만 만든다(agent·앱 자격은 `machines/call`의 actor가 아니다).
// - `agent`: agent 자격의 앱 호출과, core가 그 agent 대신 하는 `machines/app_tools`(그때 session은 null이다).
// - `app`: 앱 자격의 앱 호출.
// 받은 call은 다른 기계로 다시 넘기지 않는다(A가 B를 거쳐 C로 닿지 못한다). 폰은 `by`를 싣지 않는다.
export const requesterSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("screen") }),
  z.strictObject({ kind: z.literal("terminal") }),
  z.strictObject({
    kind: z.literal("agent"),
    agent: agentIdSchema,
    session: idSchema("ses").nullable(),
    name: z.string().min(1).max(64),
  }),
  z.strictObject({ kind: z.literal("app"), app: idSchema("app") }),
]);
export type Requester = z.infer<typeof requesterSchema>;

// 기계를 고르는 글: 컴퓨터 이름, `mch_`(기계 id), `dev_`(기기 id).
export const machineRefSchema = z.string().trim().min(1).max(64);
export type MachineRef = z.infer<typeof machineRefSchema>;

// 명단의 컴퓨터 하나. `self`는 이 컴퓨터다.
export const machineCandidateSchema = z.strictObject({
  machine: machineIdSchema,
  device: idSchema("dev"),
  name: z.string().min(1),
  self: z.boolean(),
});
export type MachineCandidate = z.infer<typeof machineCandidateSchema>;

// 이름은 글자 그대로(대소문자도) 같은 것이다. 같은 이름이 둘이면 고르지 않고 후보를 돌려준다(기기 id로 고르라고 한다).
export function resolveMachine(
  ref: string,
  computers: readonly MachineCandidate[],
): Result<MachineCandidate> {
  const found = computers.filter((computer) =>
    ref.startsWith("mch_")
      ? computer.machine === ref
      : ref.startsWith("dev_")
        ? computer.device === ref
        : computer.name === ref,
  );
  const [only] = found;
  if (only === undefined) {
    return err({ code: "not_found", message: `no computer matches ${ref}` });
  }
  if (found.length > 1) {
    return err({
      code: "invalid_input",
      message: `more than one computer matches ${ref}; pick one by its device id: ${found
        .map((computer) => computer.device)
        .join(", ")}`,
      details: {
        candidates: found.map(({ machine, device, name }) => ({
          machine,
          device,
          name,
        })),
      },
    });
  }
  return ok(only);
}

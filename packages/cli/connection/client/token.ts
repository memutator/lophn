// harness가 띄운 shell에는 core가 turn 자격(agent credential) file 경로를 env에 넣어 둔다(GUI 탭과 background 실행 모두).
// core가 turn이 열릴 때 그 file에 쓰고 끝나면 지운다. 이 env가 있으면 사람의 user 자격으로 바꾸지 않는다: harness는 사람이 아니라
// 그 session의 agent로 부른다.
import { readFileSync } from "node:fs";
import { AGENT_CREDENTIAL_FILE_ENV } from "../../../protocol/coding-agent/credential-env.ts";
import { AGENT_SHELL_ENV } from "../../../protocol/lophn-agent/tool-lists.ts";

type Env = { get(name: string): string | undefined };

// 없으면 null이다.
export type ReadCredentialFile = (path: string) => string | null;

const readCredentialFile: ReadCredentialFile = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/**
 * undefined면 lophn agent가 아니다. `token`이 null이면 lophn agent인데 지금 turn 자격이 없다(file이 turn 밖이라 비었다).
 */
export function agentCredential(
  env: Env,
  read: ReadCredentialFile = readCredentialFile,
): { token: string | null } | undefined {
  const file = env.get(AGENT_CREDENTIAL_FILE_ENV);
  if (file === undefined || file === "") return undefined;
  const token = read(file)?.trim() ?? "";
  return { token: token === "" ? null : token };
}

// lophn agent의 shell(shell.run, ACP terminal) 안이고 agent 자격이 없다.
export function inAgentShell(env: Env): boolean {
  return env.get(AGENT_SHELL_ENV) === "1" && agentCredential(env) === undefined;
}

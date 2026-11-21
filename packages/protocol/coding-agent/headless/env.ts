// harness process가 `lophn` CLI를 부를 때 쓰는 agent 자격의 env 이름이다. host가 넣고 CLI가 읽는다.
export const AGENT_CREDENTIAL_ENV = "LOPHN_AGENT_CREDENTIAL";

// 오래 사는 harness process(GUI 탭의 CLI)는 env가 띄울 때 정해져 turn마다 자격을 env로 줄 수 없다. 그래서 env에는 secret이 아닌
// file 경로를 두고, core가 turn이 열릴 때 그 turn의 자격을 그 file에 쓰고 turn이 끝나면 지운다. CLI는 위 env가 없을 때 이 file을 읽는다.
export const AGENT_CREDENTIAL_FILE_ENV = "LOPHN_AGENT_CREDENTIAL_FILE";

// 사람이 GUI 탭에서 `!`로 친 명령은 사람의 것이다(`!lophn tab open`처럼 사람 자격으로 부른다). adapter가 직접 띄우면 file 경로를 비운 env로
// 띄우고(`PERSON_SHELL_ENV`), CLI·server가 띄우는 shell이면 명령 앞에 이 글을 붙인다. 화면과 다시 그리기에서는 사람이 친 명령의 줄에서만,
// 맨 앞(shell 껍데기 `<shell> -lc '…'` 안의 맨 앞 포함)의 것만 뗀다. fish는 `unset`을 모른다(알려진 한계: bash·zsh·sh만 된다).
export const PERSON_SHELL_ENV: Readonly<Record<string, string>> = {
  [AGENT_CREDENTIAL_FILE_ENV]: "",
};
export const PERSON_SHELL_PREFIX = `unset ${AGENT_CREDENTIAL_FILE_ENV}; `;

// 껍데기 안 맨 앞이나 맨 앞의 `unset …; `(명령을 나눠 보이는 CLI는 `unset … && `로 잇는다).
const LEADING_PERSON_SHELL = new RegExp(
  `^((?:\\S*/)?\\w+ -l?c ['"]?)?unset ${AGENT_CREDENTIAL_FILE_ENV}(?:; | && )`,
);

export function withoutPersonShell(command: string): string {
  return command.replace(LEADING_PERSON_SHELL, "$1");
}

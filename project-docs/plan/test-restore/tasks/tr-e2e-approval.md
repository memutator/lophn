# tr-e2e-approval

허락을 묻게 하는 shell helper 하나(`shell_run "rm -r <미리 만든 폴더>"`)를 두고, `approval_test.ts`를 그 helper와 `once`·`reject`로 고친다(`allow-once-consumed`는 지운다). shell 규칙 e2e `shell-rule_test.ts`를 새로 쓴다.

- 단위: e2e (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/core/shell-ask.ts` (새 file)
  - `tests/e2e/approval_test.ts`
  - `tests/e2e/shell-rule_test.ts` (새 file)
- 계약:
  - 쓰는 것:
    - `packages/protocol/approvals/shell-rules.ts`의 `PRODUCT_SHELL_RULES`(ask `rm -r*`, floor deny `rm -rf ~`)와 `SHELL_RULES_SETTING_KEY`(`approvals.shell_rules`)
    - `packages/protocol/approvals/turn-request.ts`의 `turnRequestDecide`(choice `once | always | reject`)와 turn request의 `always_patterns`
    - `packages/protocol/events/mod.ts`의 `sessionSnapshotsList`(`turn_requests`), `packages/protocol/config/file.ts`의 `SettingsList`, `packages/protocol/lophn-agent/sessions.ts`의 `changeSessionSkip`
    - `tests/support/core/human.ts`(`waitPermission`, `decide`), `tests/support/fake-server/mod.ts`의 `Reply`
    - tool `shell.run`(wire `shell_run`. place의 첫 폴더에서 돈다)
  - 내놓는 것(e2e 고치기 task가 이 이름과 모양에 기댄다. 이 task만 바꾼다):

    ```ts
    // tests/support/core/shell-ask.ts
    export type ShellAsk = {
      dir: string; // 미리 만든 폴더의 절대 path
      command: string; // `rm -r <name>`. place 첫 폴더 기준 상대 path
      reply(id: string): Reply; // fake 대답: `shell_run {command}` tool call 하나
      exists(): Promise<boolean>; // 폴더가 아직 있나
    };
    // folder는 place의 첫 폴더(PM이면 project 폴더), name 기본 "victim"
    export async function shellAsk(folder: string, name?: string): Promise<ShellAsk>;
    ```

    - attended session에서 이 명령은 turn request 하나를 연다. `once` 뒤에는 폴더가 없고 `reject`나 stop 뒤에는 남는다.
    - 다른 e2e가 같이 옮기는 이름: `"allow"` → `"once"`, `permission_requests` → `turn_requests`, `PermissionRequested` → `TurnRequestOpened`, `approvalsDecideTurn` → `turnRequestDecide`.

## 할 일

`shell-ask.ts`를 만들어 `approval_test.ts`를 그것으로 고치고, `always`로 답한 규칙이 Settings `approvals.shell_rules`에 남아 같은 명령을 재시작 뒤에도 다시 묻지 않는 것과 skip이어도 floor deny가 막히는 것을 `shell-rule_test.ts`로 본다.

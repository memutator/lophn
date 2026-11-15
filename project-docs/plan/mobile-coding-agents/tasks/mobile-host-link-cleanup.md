# mobile-host-link-cleanup

연결(`/host-link`)이 shell main과 core의 유일한 길이 되었으니 옛 길을 지운다: `host/take`, `host/done`, `host/report`, `terminal_sessions/report` route와 queue의 임시 이중 길(take 기반 attached 판정, take 기반 heartbeat), 그 test와 주석. 호환 장치를 남기지 않는다.

- 단위: host-link (wave 5)
- 선행: mobile-host-link-shell, mobile-coding-shell, mobile-coding-state
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/protocol/lophn-agent/session-lifecycle.ts`
  - `packages/protocol/lophn-agent/harness-host.ts`(주석)
  - `packages/protocol/lophn-agent/registry.ts`와 `mod.ts`(지운 route를 목록과 내보내기에서 빼는 만큼만)
  - `packages/core/host-queue`
  - `packages/core/main/daemon/wiring/host-queue.ts`와 `host-queue_test.ts`
  - `packages/core/main/daemon/wiring/session-lifecycle.ts`
  - `packages/core/main/daemon/wiring/extension-tools_test.ts`
  - `packages/core/remote/host_test.ts`(옛 route를 import하는 곳과 "폰이 못 부르는 route" 이름 목록에서 지운 이름을 빼는 만큼만)
  - `packages/shell/main/browser/agent/driver.ts`(주석)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `project-docs/flows/`(`areas/harness.yaml`의 `route:host/take`·`host/done`·`host/report` 입구와 shell 쪽 flow 문장, `areas/sessions.yaml`의 `route:terminal_sessions/report`와 `route:host/take`를 쓰는 곳, `tests/core-rest.yaml` 줄)
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 2(설계 1), 4(`mobile-host-link` 지우는 것)
  - architecture: `project-docs/architecture/harness-gui.md`, `platform.md`, `terminal-agent.md`(문서는 lead가 고친다. 이 task는 코드와 catalog만)
  - 이 계획이 먼저 한 것: `mobile-host-link`(연결과 queue의 연결 길), `mobile-host-link-shell`(shell이 연결로 옮김), `mobile-coding-shell`·`mobile-coding-state`(`coding_report` 길)와 각 보고
  - 지울 곳 찾기: `grep -rn "hostTake\|hostDone\|hostReport\|terminalSessionsReport\|HOST_TAKE_WAIT_MS\|host/take\|host/done\|host/report\|terminal_sessions/report" packages tools tests`
  - 다른 계획: `mobile-push`의 `terminal_sessions/signal`(작은 HTTP route, `protocol/attention/`)은 지우지 않는다
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만. `/host-link`가 유일한 길이다)

## 할 일

1. 위 grep이 가리키는 route 정의, handler 등록, import, 목록을 지운다. `HOST_TAKE_WAIT_MS`와 `ATTACHED_MS`의 take 기반 의미를 지우고 queue의 `attached()`는 연결 열림만 본다(`startShell`의 유예와 backoff는 그대로). TUI hold의 갱신은 연결의 `tui` 목록으로만 한다(`mobile-host-link`가 정한 것). `queue`가 연결 길을 위해 둔 임시 분기(이중 길)를 걷어 가장 단순한 모양으로 정리한다.
2. 옛 route를 쓰던 test를 연결 길 test로 옮기거나, 연결 길 test가 이미 덮는 것은 지운다. `extension-tools_test.ts`가 `hostTake`를 예시 operation으로 쓰던 곳은 남아 있는 다른 user route로 바꾼다. `core/remote/host_test.ts`의 이름 목록에서 `host/take`·`host/report`·`host/done`을 빼고(지운 route는 폰 자격에서 어차피 `forbidden`이다) `terminal_sessions/report`는 거기 없었으므로 그대로다.
3. 주석(`surface.ts`, `driver.ts`, `hold.ts`, `harness-host.ts`)이 `host/take`를 가리키면 연결로 고친다.
4. flows catalog에서 지운 입구와 그 flow, test file을 맞춘다.
5. (lead가 더함) `mobile-host-link-shell` 보고가 남긴 줄을 고친다. 아직 take를 말하는 주석: `packages/shell/main/browser/agent/driver.ts:1`(`host/done`), `packages/shell/main/terminal/harness-tui.ts:2-3`("매 take에"), core의 `packages/core/host-queue/{queue,hold}.ts`, `packages/protocol/lophn-agent/{host-queue,harness-host}.ts`. flows에서 아직 take를 말하는 곳: `journeys/project-work.yaml`의 "take로", `areas/harness.yaml`의 `host-request-take`·`harness-tui-hold`·`host-link` flow의 `unclear` 줄과 `uses: [host-request-take:request, host-request-done:done]` 목록들, `areas/sessions.yaml`의 같은 `uses`. 이 줄들의 path는 이 task의 추가 소유다.
6. (lead가 더함) `/host-link` 연결이 event 연결의 사람 token 한도(principal마다 4개. `packages/core/server/server.ts`의 `admission`)를 같이 쓴다. shell 하나가 Gateway와 host link로 둘을 써서 사람의 CLI watch 몫이 하나 줄었다. host link는 그 한도에서 빼고 자기 한도(한 번에 하나)만 본다. `packages/core/server/host-link.ts`와 `server.ts`의 그 줄은 이 task의 추가 소유다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(옛 route가 없어졌다는 것은 grep이 본다. 연결 길의 test는 `mobile-host-link`가 쓴 것이다)
- 남지 않음: `grep -rn "hostTake\|hostDone\|hostReport\|terminalSessionsReport\|HOST_TAKE_WAIT_MS\|host/take\|host/done\|host/report\|terminal_sessions/report" packages tools tests`가 0줄이다(`project-docs/`의 architecture와 roadmap은 lead가 끝에 고친다).
- 확인: `npm run dev:core`를 띄우고 `tools/fake-coding-host.ts`를 붙여 `hello`가 되고 `coding_sessions/list`가 canned session을 내는지 한 번 본다. 끝나면 process를 모두 정리한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 지운 export와 route 목록, queue에서 걷어 낸 임시 분기, 옮기거나 지운 test, lead가 `host-queue-interface` boundary와 architecture 문서에서 고칠 것.

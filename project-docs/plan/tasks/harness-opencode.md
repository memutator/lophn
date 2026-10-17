# harness-opencode

OpenCode로 맡기면 메시지가 늘 `state_unknown`으로 거절되는 bug를 고친다. 전역 설치(`harness-global-install`)가 놓는 OpenCode 전역 plugin이 hook을 `lophn hook opencode <event>`로 넘기게 한다.

- 단위: harness (wave 2)
- 선행: harness-global-install. 같은 `harness-adapter.ts`와 `install.ts`를 이어 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/harness-adapter.ts`
  - `packages/coding-agent/harnesses/install.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md` ("상태는 hook이 알린 event에서만 계산한다", "hook으로 상태를 안다"의 turn 끝 신호 목록). 문서는 lead가 고친다.
  - 이슈: `project-docs/issues/coding-agent.md`의 "OpenCode 맡기기에서 메시지가 늘 `state_unknown`으로 거절된다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent`, `coding-agent-harness-api`
  - 코드: `packages/protocol/coding-agent/hook-signal.ts`의 `HOOK_EVENT_TABLE.opencode`와 `opencodeSignal`(plugin이 보내는 payload는 `{type, properties}`, `session.status`는 `properties.status.type`이 busy/retry/idle, 하위 session은 plugin이 root event만 넘긴다는 전제). 이 file은 이 task 소유가 아니다. 모양이 안 맞으면 고치지 말고 보고한다.
- 계약:
  - 쓰는 것: `harness-global-install`이 만든 `pluginSource(harness)`(install.ts), `HarnessAdapter.hook`의 전역 위치와 `format: "plugin_file"`, plugin이 부르는 `lophn hook opencode <event>`(stdin JSON, `LOPHN_CODING_TOKEN` 없으면 아무것도 안 함)
  - 내놓는 것: `HARNESS_ADAPTERS.opencode.hook`이 채워진다. 다른 task가 기대는 것 없음.

## 할 일

1. **OpenCode 전역 plugin 위치와 API를 먼저 확인한다.** 이 컴퓨터에 `opencode`가 설치돼 있다(`opencode --version`, 설치 폴더의 문서·소스, `~/.config/opencode`는 읽기만). 공식 문서(opencode.ai docs의 Plugins)도 WebFetch로 본다. 확인할 것:
   - 전역 plugin 폴더와 file 이름 규칙(내가 아는 후보: `~/.config/opencode/plugins/<이름>.ts`. 확인 못한 값이다)
   - plugin의 형태(`export const X = async ({ client, ... }) => ({ event: async ({ event }) => ... })` 꼴인지)와 event 이름·payload(`session.status`, `session.idle`, `permission.asked`, `permission.replied`)
   - 하위(subagent) session을 어떻게 가리는지(`HOOK_EVENT_TABLE`/`opencodeSignal`은 plugin이 root session event만 넘긴다고 전제한다)
   - plugin 안에서 process를 띄워 stdin에 JSON을 넣는 방법(OpenCode는 Bun에서 돈다. `node:child_process`가 되는지)
2. 확인되면:
   - `harness-adapter.ts`의 `opencode.hook`을 `{ path: ".config/opencode/plugins/lophn-status.ts"(확인한 위치/이름으로), format: "plugin_file" }`로 채우고 지금의 "project plugin 위치를 조사로 확인하지 못했다" 주석을 지운다. 확인 못 한 부분(예: 이름 규칙, API 이름)은 주석에 "확인 못함"으로 남긴다.
   - `install.ts`의 `pluginSource(harness)`에 `opencode` case를 더한다. 원문은 `HOOK_EVENT_TABLE.opencode`의 event만 듣고, `process.env.LOPHN_CODING_TOKEN`이 없으면 아무것도 하지 않고(spawn 없음), root session event만 `lophn hook opencode <event>`에 stdin `JSON.stringify({type, properties})`로 넘긴다. 실패는 삼켜 OpenCode를 멈추지 않는다(pi extension 원문의 `send` 모양을 따른다).
   - `TURN_END_SIGNALS.opencode`는 `"session.status idle"` 그대로 둔다.
3. **확인되지 않으면** plugin을 추정으로 쓰지 않는다. 대신 `TURN_END_SIGNALS.opencode`를 `null`로 바꾼다(한 줄). 거절 이유가 `no_turn_end_signal`로 정직해지고 Settings 표시도 맞아진다. `HOOK_EVENT_TABLE.opencode`(소유 밖)는 남긴다. 이 경우 보고에 "확인 못 함, 정직한 거절로 대체"와 무엇을 확인하지 못했는지를 쓴다.
4. 위 두 길 중 어느 쪽이든 `harness install`을 `HOME=<.dev-data 아래 빈 경로>`로 돌려 plugin file이 위치에 생기는지 본다. 실제 `~/.config/opencode`는 쓰지 않는다.

## 정한 것

- 이슈의 "정한 것"은 전역 plugin을 놓는 쪽이고, 확인이 안 되면 null로 가는 것이 이슈의 추천(앞쪽)과 같다. 두 길 모두 이 task 안에서 끝낸다.
- OpenCode의 skill 전역 폴더(`.config/opencode/skills`)는 `harness-global-install`이 이미 정했다. 확인 결과가 다르면 이 task에서 같은 file(`harness-adapter.ts`)의 그 줄을 고쳐도 된다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 설치 원문은 문자열이고 hook 변환은 `hook-signal.ts`가 이미 다룬다.
- 남지 않음: `grep -rn "project plugin 위치" packages`가 0줄. (확인 못 해 null로 간 경우) `grep -n "opencode" packages/protocol/coding-agent/harness-adapter.ts`에서 `TURN_END_SIGNALS.opencode`가 `null`이고 `canDeliverMessages("opencode")`가 false다.

## 보고

- 바꾼 file
- 통과한 check
- 확인한 것과 못 한 것: OpenCode 전역 plugin 위치, plugin API, 하위 session 구분, 어디서(local 문서, 소스, 공식 문서) 확인했는지
- 정한 것
- 계약 바꾸기 요청: `hook-signal.ts`와 plugin payload가 안 맞을 때
- **무겁게 짠 것**
- **알려진 미완 동작**

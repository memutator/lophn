# harness-headless

shell host가 harness 입력함의 입력을 그 harness의 headless CLI 명령으로 실행하고, 구조 출력을 lophn session 기록으로 옮긴다. host는 extension `harness`다.

- 단위: harness (wave 2)
- 선행: harness-core.
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/harness-adapter.ts`(+test), 새 `packages/protocol/coding-agent/headless/**`(parser, 권한 표, fixture)
  - 새 `packages/shell/main/extensions/bundled/harness/**`(manifest, entry, host)
  - extension entry build: `packages/shell/main/` build script 한 곳, `tools/package-linux.ts`, `packages/shell/main/electron-builder.yml`(본체 안 extension을 설치 root `extensions/`로)
  - `tools/check-deps.ts`(새 folder 규칙이 필요하면)
- 읽을 것:
  - architecture: `project-docs/architecture/extension.md`(extension은 `ctx`로만 lophn에 닿는다), `coding-agent.md`의 "harness agent", `terminal-agent.md`
  - 이슈: `project-docs/issues/extension.md`(설치본에 본체 안 extension이 안 들어간다), `project-docs/issues/coding-agent.md`의 "harness agent를 켜는 화면에 harness가 아직 없다"
  - 계약: `packages/protocol/extensions/manifest.ts`(`ExtensionContext`, `ExtensionSpawn`), `packages/protocol/lophn-agent/harness-host.ts`(host route)
  - 사실: 각 CLI의 `--help`와 lead가 녹화한 실제 출력(lead의 알아 둘 것)
  - 제품 결정: 계획 README 정한 것 4~6
- 계약:
  - 쓰는 것: `harness-core`의 host route(`ctx.core.call("memory", "harness", <method>, input)`), `ExtensionContext`
  - 내놓는 것: `HARNESS_ADAPTERS[*].headless {command, args(prompt, sessionId, cwd), permissions(table)}`

## 할 일

1. `HARNESS_ADAPTERS`에 `headless` 칸(claude-code, codex, opencode). parser는 순수 함수다: 구조 출력 → 메시지 글, `harness_tool` part, 외부 session id, 끝.
2. 권한 표(정한 것 5): 정의의 deny → disallow flag, 전부 허락 flag는 쓰지 않는다. 표에 없는 harness는 띄우지 않는다.
3. host(extension `harness`): `activate`에서 입력을 꺼내는 고리를 돌리고 `deactivate`에서 멈추고 띄운 process를 끈다. 입력을 꺼내 받은 block을 prompt로(이미지는 글 자리 표시) 실행한다. cwd는 session의 place 폴더. 외부 session id가 있으면 resume. 멈추면 process를 죽이고 turn을 끊긴 것으로 끝낸다.
4. spawn env: `ctx.spawn`은 shell main의 env를 물려준다(harness가 자기 API key를 쓴다). lophn의 user token은 넣지 않는다.
5. 켜기: manifest가 있어 Settings › System › Extensions에 harness가 보이고 켜진다. entry는 shell main bundle 밖에서 따로 빌드한 CJS이고 개발(`extensions/bundled/harness/`)과 .deb 설치본(설치 root `extensions/`) 모두에 놓인다.
6. fixture: lead가 녹화한 실제 출력에서 만든다. 사람의 환경이 드러나는 칸(hook 출력, MCP·plugin 목록, 절대 경로, rate limit)은 줄여 둔다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "parser가 녹화 fixture에서 메시지, tool part, session id, 끝을 낸다"(harness마다)
  - "권한 표는 deny를 disallow로 옮기고 전부 허락 flag를 내지 않는다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 실제 harness를 띄우는 test는 만들지 말고 적는다.

# rd-cap-skill

coding agent skill의 내장 SDK 목록에 `@lophn/cap-fs`, `@lophn/cap-net`, `@lophn/cap-secret`을 이름으로 적고, 지금 되는 것을 한 줄씩 쓴다.

- 단위: rd-cap-skill (wave 4)
- 선행: rd-cap-net-transport, rd-cap-secret-supervisor, rd-cap-fs. 셋의 동작이 정해져야 skill이 맞게 적는다.
- 소유(이 task만 고친다):
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "cap-fs, cap-net, cap-secret이 깔리지 않아…"
  - architecture: `project-docs/architecture/coding-agent.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli`, `sdk`
  - 앞 task의 보고(각 SDK의 `guide.md`가 정본이다): `packages/sdk/cap-fs/guide.md`, `packages/sdk/cap-net/guide.md`, `packages/sdk/cap-secret/guide.md`
- 계약:
  - 쓰는 것: 세 `guide.md`
  - 내놓는 것: 없음

## 할 일

1. `SKILL.md` 4번 항목의 내장 SDK 괄호 — 지금 "내장 SDK(`@lophn/app-ui`, `@lophn/blueprint`, `@lophn/cap-*`)" — 를 이름을 다 적은 목록으로 바꾼다: `@lophn/app-ui`, `@lophn/blueprint`, `@lophn/cap-app-api`, `@lophn/cap-store`, `@lophn/cap-problem`, `@lophn/cap-project`, `@lophn/cap-fs`, `@lophn/cap-net`, `@lophn/cap-secret`.
2. 한 문장을 덧붙인다: 외부 network(`cap-net`, 사람이 켠 host·port와 같은 컴퓨터의 loopback 서비스), 앱에 값이 없는 secret(`cap-secret`, `cap-net` 요청에 lophn이 붙인다), 허락된 경로의 file(`cap-fs`)은 이 셋으로만 한다. 쓰려면 blueprint에 `permissions`와 `sdk_dependencies`가 있어야 하므로 5번처럼 App Engineer에게 청한다. 이 한 항목 밖은 고치지 않는다(계획 `prompt-text`와 `rd-ex-prompts`가 다른 곳을 고친다. `rd-ex-prompts`가 같은 file의 다른 항목을 먼저 고쳤을 수 있으니 지금 file을 읽고 시작한다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: `grep -n "cap-\*" packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

# 계획

계획 하나의 꼴이다. 새 계획을 세울 때 이 file을 그 계획의 개요로 고쳐 쓰고, 나머지는 비운 채로 둔다. 돌리는 절차는 `.claude/skills/orchestrate/SKILL.md`, task brief 꼴은 `.claude/skills/orchestrate/brief-template.md`가 정한다.

## 무엇을 두나

| file | 쓰임 |
|---|---|
| `README.md` | 이 계획의 목표, 단위, 순서(wave), 사람이 정할 것 |
| `status.md` | task마다 wave, 선행, 상태, branch, commit. `tools/status.py`가 만들고 lead만 고친다 |
| `tasks/<id>.md` | worker에게 넘기는 brief. task 하나에 file 하나 |
| `tools/` | `status.py`(상태 표, 띄울 task 고르기), `lead/`(launch, prompt, merge, boot) |

## 이 계획: 이슈 결정 적용

- 목표: `project-docs/issues/`에서 "정한 것"이 붙은 이슈 가운데 바로 할 수 있는 것을 코드에 옮긴다. 지울 것은 지우고, 바꾸기로 한 것은 바꾸고, 고치기로 한 bug는 고친다.
- 재료: 각 task가 가리키는 `project-docs/issues/<topic>.md`의 절(정한 것이 곧 요구다), `project-docs/architecture/<topic>.md`, `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`, AGENTS.md "속도"의 위협 원칙.
- 범위 밖: "다이어트 계획에서 줄일지 정한다"인 이슈(사람이 하나씩 정한 뒤 다음 계획), "실제로 막히거나 필요해질 때"인 이슈, 정한 것이 없는 bug, harness와 domain 분리(`products/roadmap/harness-domain-split.md`).
- 단위:
  - `annotation`: source 위치 지우기와 component 겹, screenshot을 App Engineer가 보기
  - `harness`: harness 설치를 전역 한 번으로, OpenCode hook
  - `trust`: 사용자 앱을 공격자로 보는 장치 지우기(CLI data fence, "data, not instructions" 문구, 앱 화면 오류 보고 서명)
  - `dead`: 반쯤 만들고 안 쓰는 길 지우기
  - `apps`: activation 줄과 재시도 없애기, 큰 changeset을 too_large로
  - `router`: describe의 waiting 포기, agent의 배달 실패 이중 통지
  - `platform`: crash를 diagnostic log에, Diagnostics 점검에 events와 agent runtime
  - `place`: 앱 Operator에게 앱 source 읽기
  - `feedback`: 제보 창에서 기존 문제 고르기 살리기
  - `cleanup`: 앞 task들이 소유가 겹쳐 남긴 죽은 칸(`verify_key`, `queued`, confirm proof, outline format)과 틀린 이유 주석
- 순서: wave 1은 서로 기대지 않는 task 13개. wave 2는 같은 file을 이어 고치는 task 5개(선행으로 묶음). wave 3은 `cleanup-leftovers` 하나. 모든 task가 merged면 lead가 문서를 고친다(아래).
- brief를 쓰며 찾은 지금 bug(task가 같이 고친다): 앱 화면 오류 보고가 서명 검증에 걸려 전부 not_found로 거절된다(`trust-view-error-signing`). tool 결과 이미지가 `tool_result_image`가 아니라 JSON 글로 간다(`annotation-screenshot`). I/O worker가 diagnostics 쓰기를 모두 거절해 diagnostic log에 아무것도 안 남는다(`platform-crash-diagnostics`).
- 사람이 정할 것: 없음. 결정은 이슈의 "정한 것"에 있다. brief가 정한 것과 다르게 가야 하면 worker는 멈추고 보고한다.

## lead가 할 일

- task가 merge될 때마다 그 이슈 절을 `issues/archived/<topic>.md`로 옮긴다(closed: fixed, guard).
- 모든 task가 merged면 architecture 문서를 코드에 맞춘다: `annotation.md`(source 위치, component 겹, screenshot, 신원 문장), `coding-agent.md`(전역 설치, data fence, Hermes·OpenClaw), `app-call.md`(큰 changeset, 신원 문장), `agent-definition.md`(reaction 문구, prefix 이유), `event.md`·`approval.md`·`place-session.md` 중 바뀐 곳. changelog 열린 판에 항목을 덧붙이고 tasks와 status를 비운다.

## 규칙

- task를 나누는 크기, 소유, 병렬 규칙, review, merge는 orchestrate skill을 따른다.
- 끝남 기준은 task마다 brief의 "끝남"이 정한다. 기본은 `deno task check` 통과, 위험 test(`write-test`), 죽은 코드·TODO·옛 이름이 없음이다.
- worker 보고의 "무겁게 짠 것"과 "알려진 미완 동작"은 `project-docs/issues/`의 이슈가 된다.
- 계획이 끝나면 task brief와 `status.md`를 비우고, changelog의 열린 판에 항목을 덧붙인다. 남은 이슈는 다음 계획의 재료다.

---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# worker 지침

lead가 띄운 worker가 작업 하나를 구현할 때 따르는 지침이다. 구조와 등급은 [team.md](team.md)를 따른다.

## 먼저 읽을 것

1. `AGENTS.md`, [architecture.md](architecture.md), [code-map.md](code-map.md), [tasks.md](tasks.md)
2. lead가 준 작업 블록(`docs/plan/<팀>.md`의 `### T<n>`)
3. 작업 블록의 `요구:`가 가리키는 requirements, 그 concern의 domain model과 architecture, `조사:`가 있으면 그 문서

다른 최상위의 문서는 contract와 concern id로만 본다. 필요한 것만 읽고 context를 아낀다.

## 경로

worker의 Bash는 명령마다 cwd가 main checkout으로 돌아갈 수 있다. 그래서 **모든 명령과 파일 경로는 lead가 준 worktree의 절대 경로로 쓴다**(`git -C <worktree>`, `cd <worktree> && ...`). main checkout(`/home/pyosechang/projects/lophn`)은 읽기만 하고 고치지 않는다. 테스트의 fixture·Worker entry·temp 경로는 `import.meta.url`이나 temp dir 기준으로 잡는다.

## 구현

- 작업의 `자리:` 밖은 고치지 않는다. 다른 concern의 코드·계획, intent, `docs/concerns.yaml`은 고치지 않는다.
- contract가 바뀌어야 하거나 다른 concern이 막으면 멈추고 lead에게 짧게 말한다.
- 구현하다가 그 concern의 requirements가 틀렸다는 것이 드러나면 같은 PR에서 고치고 계획 "## 질문"에 남긴다.
- 테스트 이름은 요구 번호로 시작한다. 평소에는 targeted test만 돌린다. full `deno task check`는 PR 직전에 한 번만 돌린다(메모리 때문에 동시에 여러 개 돌리지 않는다).
- stash는 쓰지 않는다. 의미 있는 진척마다 WIP commit을 하고 push한다. 이미 push한 branch는 rebase·force push 대신 merge로 갱신한다.
- code-review Skill은 쓰지 않는다.

## PR

1. `git fetch origin` 후 origin/main을 merge로 반영하고 full `deno task check`를 돌린다.
2. 같은 PR에서 계획의 그 작업에 `- 상태: 완료 (#<PR>)`를 단다. 작업 일부만 끝냈으면 `- 상태: 진행 (#<PR>) — 남은 것: ...`으로 적는다.
3. push하고 PR을 연다. 병합은 하지 않는다. lead가 review하고 병합한다.

## 보고

끝나면 lead에게 짧게 보고한다: PR 번호와 head sha, 바꾼 자리, 통과한 check, 테스트가 가리키는 요구, 남은 것과 막힌 것.

# ex-skills

eval을 돌리는 개발 쪽 agent 둘이 일하는 법을 skill 둘로 쓴다. `eval-run`은 eval을 돌리는 agent session(runner. 지금은 lead, 뒤에는 더 싼 session. 고정된 model이 아니다)이 eval CLI를 돌리고 진행을 보고, App Engineer의 질문에 답하고 judge item을 채점하고(둘 다 item마다 새 subagent), 멈춘 run을 알아채고 보고서를 쓰는 법이다. `eval-experiment`는 experimenter(`claude-opus-5-5`)가 판정 결과를 해석하고 원인을 가르고 의심스러운 judge 판단을 짚고 다음 spec 초안을 쓰는 법이다. 코드는 없다. 글 두 개다.

- 단위: ex-skills (wave 4)
- 선행: ex-cli
- 소유(이 task만 고친다):
  - `.claude/skills/eval-run/**`
  - `.claude/skills/eval-experiment/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/eval.md`의 "역할과 흐름"(역할 표: 하는 것과 하지 않는 것이 이 skill의 규칙이다), "judge를 믿고 쓰기", "experiment", "trial 수", "특정 시나리오에 맞추지 않기", "병렬과 의존", "지켜야 할 것"
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것"의 runner·experimenter, 판정, 기준 구성, trial 정책, 예산)
  - 채점과 사람 역할: `ex-judge-agent.md`(`deno task eval:judge <run>`, `show`, `set`, 정상 채점은 덮지 않는다), `ex-human-agent.md`(`deno task eval:answer <run>`, `show`, `set`), `ex-repeat.md`(진단 item)
  - 같은 계획의 brief(merge된 코드가 정본이고 brief는 그 뒤 이름과 어긋나면 코드를 따른다): `ex-spec.md`(`spec.json`, `result.json`, `report.md`의 꼴. `ExperimentResult`의 칸. 경고와 진단은 `overfit?`, `repeats?`, `assembly?`에 있다), `ex-cli.md`(`deno task eval:experiment`, `eval:gate`의 인자, 출력, 종료 코드), `ex-verdict.md`(판정 규칙 `default@1`), `ex-trials.md`(trial 정책), `ex-overfit.md`, `ex-repeat.md`, `ex-assembly.md`(경고와 진단이 어디에 남는지)
  - eval-base brief: `project-docs/plan/eval-base/tasks/ev-runner.md`(`deno task eval`의 옵션과 종료 코드, run 요약과 full record의 자리), `ev-scorecard.md`(`deno task eval:scorecard`와 diff), `ev-judge.md`(`JudgeItem`: verdict, 인용, `quote_found`, `error`)
  - 본보기(skill의 꼴): `.claude/skills/write-test/SKILL.md`, `.claude/skills/issue/SKILL.md`, `.claude/skills/orchestrate/SKILL.md`. frontmatter는 `name`과 `description` 둘뿐이다. description은 "언제 쓰는가"를 한 문단으로 쓴다.
  - 등록 방식: `project-docs/context-component-registry.yaml`(skill은 `kind: skill`, `path: .claude/skills/<이름>/`. 등록은 lead가 한다)
  - 문서 path 검사: `tools/check-docs.ts`(skill 안의 backtick 저장소 path는 `packages/`, `project-docs/`, `tools/`, `.claude/`로 시작하면 실제로 있어야 하고 `<...>`가 든 path는 건너뛴다. `tests/...`는 검사하지 않는다)
- 계약:
  - 쓰는 것(merge된 코드에서 확인해 skill에 그대로 적는다. 아래 이름은 계획 기준이다):
    - 명령: `deno task eval:gate`, `deno task eval:experiment <id>`, `deno task eval`, `deno task eval:scorecard`, `deno task eval:judge`, `deno task eval:answer`. 인자, 출력 줄, 종료 코드는 ex-cli가 만든 `tests/eval/run.ts`와 `deno.json`의 task를 보고 쓴다. 상상으로 쓰지 않는다.
    - 기록: `tests/eval/experiments/<id>/spec.json`, `result.json`, `report.md`(ex-spec). run 요약 `tests/eval/runs/<id>.json`. 전체 기록 `.dev-data/eval/<run>/trial-<n>.json`(`{ trial, judge, source }`)과 `trial-<n>.core.log`(ev-runner).
  - 내놓는 것: `.claude/skills/eval-run/SKILL.md`, `.claude/skills/eval-experiment/SKILL.md`. 다른 task가 기대지 않는다. lead가 `runner`·`experimenter` role과 두 skill 항목을 registry에 올린다.

## 할 일

`eval-experiment`는 150줄, `eval-run`은 200줄을 넘기지 않는다(싼 session이 읽는 글이라 짧아야 한다). 명령은 복사해 쓸 수 있게 코드 블록으로 쓴다. 규칙마다 "왜"를 한 줄로 붙인다.

1. `.claude/skills/eval-run/SKILL.md`: runner의 일.
   - frontmatter: `name: eval-run`. description은 "lophn eval experiment나 `deno task eval`을 돌리고, 진행을 보고, App Engineer의 질문에 답하고 judge item을 채점하고(item마다 새 subagent), 멈춘 run을 알아채고, 실행 기록을 쓸 때 쓴다. eval을 돌리는 agent session(runner)이 읽는다."라는 뜻.
   - **순서**: ① `tests/eval/experiments/<id>/spec.json`을 읽고 시나리오, 예산, trial 정책을 확인한다(바꾸지 않는다). ② `deno task eval:gate`. 실패하면 거기서 멈추고 단계 이름과 출력 마지막 줄을 보고한다. ③ `deno task eval:experiment <id>`를 background로 돌린다. ④ 진행을 확인하는 동안 질문에 답하고 채점한다(아래). ⑤ 끝나고 채점 대기가 비면 `result.json`을 읽어 `run.md`를 쓴다. ⑥ 보고한다. 판단 case를 그냥 돌리는 `deno task eval`도 ③만 다르고 같다.
   - **진행 확인**(cron처럼): 정해진 간격으로 stdout 마지막 줄들, `.dev-data/eval/`에서 가장 최근에 바뀐 file의 시각, 비용 줄(CLI가 찍는다)을 본다. 확인마다 한 줄 상태를 caller에게 남긴다. 간격과 "멈춤" 기준 숫자는 이 task가 정한다: 질문 대기가 없으면 확인 간격 3분, 판단 case만 도는 experiment는 stdout과 기록 file이 10분 변하지 않으면 멈춘 것으로 본다(`waitUntilIdle`의 timeout이 5분이다). coding agent 시나리오가 든 experiment는 trial 하나가 길어(시간 상한 90분) 30분으로 본다. **답을 기다리는 질문이 있는 동안은 멈춘 것이 아니라 runner의 차례다**(확인 간격 1분 이하). 첫 experiment에서 재 보고 고친다고 skill에 적는다.
   - **질문에 답하기**(stdout에 `답 대기 <run> <key>`가 뜨면):
     1. `deno task eval:answer <run> show <key>`의 stdout 전문을 받는다.
     2. **새 subagent** 하나를 띄운다(fork가 아니다. 이 session의 context를 주지 않는다). prompt는 그 stdout 전문만이다. 한 글자도 더하지 않는다(시나리오 이름, 진행 상황, 가설, 다른 질문의 답을 쓰지 않는다). subagent_type은 한 가지로 정해 쓴다(기본 `sonnet-high`).
     3. subagent의 마지막 글이 `[["label"], [...]]` 꼴 JSON인지 본다. code fence만 벗기고 고치지 않는다. 아니면 새 subagent로 한 번 더 시킨다.
     4. `deno task eval:answer <run> set <key> --model <그 subagent의 model 이름> <<'EOF' ... EOF`로 넣는다(질문마다 subagent 하나. 한 subagent에 질문 여럿을 몰지 않고, 앞 subagent를 이어 쓰지 않는다).
     - 이유: 사람 역할은 질문, 요구 카드, 앞서 자기가 한 답만 아는 사람이다. 돌리는 쪽의 가설과 진행에 끌리지 않게 하려는 것이다.
   - **채점하기**(stdout에 `채점 대기 <run> <key>`가 뜨거나 `deno task eval:judge <run>`이 목록을 낼 때): 위와 같은 절차로 `deno task eval:judge <run> show <key>`의 전문만 새 subagent에 주고, 마지막 글의 `{"verdict": "...", "quote": "..."}`를 `deno task eval:judge <run> set <key> --model <name> <<'EOF' ... EOF`로 넣는다. program이 enum과 인용을 검사해 `error`로 남길 수 있다. 오류로 기록된 item만 새 subagent로 다시 채점할 수 있다. **정상으로 기록된 채점은 다시 하지 않는다**(program이 거절한다). 질문과 달리 채점은 trial이 끝난 뒤에 몰아서 해도 된다. 진단 item(`repeat-kind`)도 같은 목록에 있고 같은 절차다.
   - **하지 않는 것**(각각 이유 한 줄):
     - runner 자신이 답하거나 채점하지 않는다. 직접 판단하면 돌리는 쪽의 가설이 판단에 들어간다. subagent의 답을 고치거나 골라 쓰지 않는다(code fence 벗기기만).
     - 결과를 고치지 않는다: `result.json`, `tests/eval/runs/*.json`, `.dev-data/eval/`(채점 대기·답 file 포함)를 손으로 고치지 않는다. 판정과 기록의 정본이다. CLI(`eval:judge`, `eval:answer`)로만 적는다.
     - 떨어진 trial만 골라 다시 돌리지 않는다. 몇 번 더 돌릴지는 program의 trial 정책이 정한다. 통과할 때까지 돌리면 결과를 고르는 일이 된다.
     - 상한을 넘기지 않는다: `budget_usd`나 `--budget`을 올리지 않고, 예산이 끊은 experiment(`inconclusive`)를 caller가 시키지 않았는데 이어 돌리지 않는다.
     - 시킨 것 말고 다른 experiment나 `deno task eval --all`을 돌리지 않는다. 진짜 provider는 비용이 든다(AGENTS.md "사람에게 묻는 것").
     - key를 찍거나 옮기지 않는다. `.env`를 열지 않는다. CLI가 key 없이 0으로 끝나면 그대로 보고한다.
     - 해석하지 않는다. 원인 추정, 판정 뒤집기, 다음 고칠 것을 쓰지 않는다. experimenter의 일이다.
   - **멈춘 run을 알면**: 지체 없이 caller에게 알린다. 마지막 stdout 10줄, 마지막 변화 시각, 지금까지 비용, 어느 시나리오와 trial인지를 쓴다. 스스로 process를 죽이거나 다시 돌리지 않고 멈추라고 요청한다(이유: 돈과 시간 상한은 program이 지킨다).
   - **판정은 채점이 다 들어온 뒤에만 쓴다**: `deno task eval:judge <run>`이 목록을 비워야(대기 0) `result.json`의 판정을 보고에 쓴다. 남아 있으면 "채점 대기 n개"라고 쓴다.
   - **`run.md`**(`tests/eval/experiments/<id>/run.md`): 사실만 쓴다. 칸: 명령과 시작·끝 시각, gate 결과(단계별 ok), 종료 코드, `result.json`의 `decision`과 `reasons`(그대로 복사), 시나리오별 표(역할, 기준 통과/trial, variant 통과/trial, status), 비용(`cost_usd` / `budget_usd`, `stopped_by_budget`), 경고(시나리오 고유 단어, 되풀이 진단, assembly 재기가 `result.json`에 있으면 그 줄을 그대로), 답한 질문 수와 채점한 item 수와 그때 쓴 model, 멈춤이나 이상한 출력(시각과 줄). 계산하지 않고 `result.json`의 숫자를 옮긴다. 이유: runner와 experimenter가 서로의 file을 덮어쓰지 않고, 사실과 해석이 갈린다.
   - **보고**(caller에게): 판정 한 줄, 비용, 이상한 점이 있었나, `run.md` 경로. 해석은 experimenter에게 넘긴다고 쓴다.
2. `.claude/skills/eval-experiment/SKILL.md`: experimenter의 일.
   - frontmatter: `name: eval-experiment`. description은 "lophn eval experiment의 판정 결과를 해석하고, 떨어진 run을 읽어 원인을 가르고, 의심스러운 judge 판단을 짚고, 다음 spec 초안을 쓸 때 쓴다. experimenter(`claude-opus-5-5`)가 읽을 때."라는 뜻.
   - **읽는 순서**(싼 것부터. Opus는 읽는 만큼 돈이 든다): ① `spec.json`(가설, 바꾼 것, target, 미리 쓴 case, 정책) ② `result.json`(`decision`, `reasons`, `scenarios[].status`, `mixed`, `excluded`, `stopped_by_budget`) ③ `run.md`(runner의 사실 기록) ④ 떨어졌거나 이상한 시나리오의 run 요약 `tests/eval/runs/<run>.json`(check verdict, judge item, 수치) ⑤ 그 가운데 필요한 trial만 전체 기록 `.dev-data/eval/<run>/trial-<n>.json`과 core log. 전체 기록은 크다. 어느 trial이 왜 필요한지 정하고 연다.
   - **해석 질문**: 판정이 `adopt`/`reject`/`inconclusive` 가운데 어느 것이고 왜(`reasons`)인가. target이 나아진 것이 trial 수로 우연이 아닌가(정책이 3번까지 늘렸나). guard가 `weaker`(통과율이 낮아졌지만 worse는 아님)인가. `mixed`면 섞인 결과로만 읽는다. `excluded`가 있으면 어떤 시나리오가 기준에서 빠졌나. 미리 쓴 case가 target과 같은 규칙을 정말 시험하나. 경고(시나리오 고유 단어)가 걸린 줄이 일반 규칙인가 시나리오 맞춤인가.
   - **원인 가르기**(떨어진 trial마다 하나로 정하고 근거를 file과 id로 댄다. 못 정하면 "모름"이라 쓰고 무엇을 더 보면 가려지는지 적는다):
     - model 탓: 지침을 읽고도 다른 선택을 했고, 같은 버전에서 trial끼리 갈린다. tool 호출은 정상으로 받아들여졌다.
     - 제품 탓: tool이 거절(`invalid_input` 등)하거나 Gate가 막거나 안내 글이 틀렸다. 같은 요청이면 어느 model이라도 막힌다. `configuration_unavailable`이나 `settle`의 timeout처럼 program이 찍은 사실이 이유다.
     - judge 탓(grader 포함): judge verdict가 program이 확인한 사실과 어긋나거나, 인용이 입력과 맞지 않거나, check가 right fixture에서 통과하지 않을 모양이다.
   - **의심스러운 judge 판단을 `report.md`에 따로 적는다**(roadmap): program 사실과 어긋난 verdict, `cannot_tell`이 몰린 criterion, `quote_found: false`나 `error`가 있는 item, 같은 입력에서 trial끼리 verdict가 갈린 것. 항목마다 run id, trial, check id, criterion@n, verdict, 인용, 왜 의심스러운지를 쓴다. 사람이 같은 입력으로 다시 볼 수 있어야 한다. judge를 직접 다시 부르지 않는다.
   - **판정을 뒤집지 않는다.** 판정은 program이 계산한다. 이의가 있으면 `report.md`의 "판정 이의"에 무엇이 어떤 근거로 틀렸는지 쓰고 사람이 정하게 한다. `result.json`을 고치지 않고, 규칙(`default@1`)을 결과에 맞춰 바꾸자고 하지 않는다(규칙은 돌리기 전에 정한 것이다).
   - **harness를 직접 고치지 않는다.** 다음 고칠 것은 제안으로 쓴다(어느 component, 어느 줄, 왜). 흐름은 experimenter → planner와 사람 → 고침(roadmap "역할과 흐름").
   - **다음 spec 초안**: `tests/eval/experiments/<다음 id>/spec.json`을 ex-spec의 꼴(`parseSpec`이 받아들이는 모양)로 쓴다. 초안이라고 `report.md`에 쓴다(확정은 planner와 사람이 한다). 규칙: 고치기 전에 같은 규칙을 시험하는 다른 요청의 case를 `cases`에 먼저 쓴다(그 시나리오 file이 없으면 새 시나리오를 만들지 말고 "이런 case가 필요하다"고 제안으로 쓴다. 새 시나리오는 이 계획 밖이다). 판정 규칙과 예산은 돌리기 전에 적는다. 방금 본 결과를 보고 규칙을 고르지 않는다. 고친 줄에 맞춰 case를 쓰지 않는다.
   - **`report.md`의 꼴**(`tests/eval/experiments/<id>/report.md`): `## 판정`(program 결과 한 줄 인용), `## 해석`, `## 떨어진 것과 원인`(표: 시나리오 또는 check, run과 trial, 원인[model/제품/judge/모름], 근거), `## 의심스러운 judge 판단`(없으면 "없음"), `## 경고와 진단`(시나리오 고유 단어, 되풀이 `repeat-kind`, assembly prefix 재기. `result.json`에 있는 것만), `## 다음`(고칠 것 제안, 다음 spec 초안 경로), `## 판정 이의`(없으면 "없음").
3. 두 skill 모두 끝에 "이 skill이 기대는 것" 한 줄 목록을 둔다: 명령 이름, 기록 file 이름, 역할 표. 코드가 바뀌면 skill도 바뀌어야 하는 곳을 알리려는 것이다.
4. `deno run --allow-read tools/check-docs.ts`가 통과한다(skill 안의 저장소 path 검사).

## 정한 것

- **runner의 보고서는 `run.md`, experimenter의 해석은 `report.md`다.** roadmap은 runner가 "보고서를 쓴다"고, ex-spec은 `report.md`를 experimenter가 쓴다고 했다. 둘을 한 file로 하면 두 session이 서로의 글을 덮어쓸 수 있어 file을 나눴다.
- **답하고 채점하는 subagent의 type은 한 가지로 고정해 쓰고 model 이름을 `--model`로 적는다.** 기본은 AGENTS.md의 worker 기본인 `sonnet-high`(`claude-sonnet-5-5`)다. 이유: 한 run 안에서 채점 model이 섞이면 읽기 어렵다. 다른 type을 쓰면 scorecard가 grader가 다른 run으로 따로 보인다(README). `run.md`는 program이 읽지 않고 commit한다(experiment 기록의 일부).
- **멈춤 기준은 10분(판단 case만)·30분(coding agent 포함)이고, 답 대기는 멈춤이 아니다.** roadmap에 숫자가 없다. 첫 experiment에서 재 보고 고친다.
- **experimenter는 `result.json`의 칸 이름을 코드(`tests/eval/experiment/spec/types.ts`)에서 읽는다.** skill에 칸을 복사해 두지 않는다(복사본이 낡는다). 위 "읽는 순서"에 쓴 칸은 계획 기준이고, merge된 코드와 다르면 코드를 따라 skill을 쓴다.
- **experimenter가 `report.md`에 쓰는 것 가운데 program이 낸 사실과 자기 추정을 섞지 않는다.** 원인 표의 "근거" 칸은 file과 id로 댄 사실만 쓰고, 추정은 "해석" 절에 쓴다. 이유: 사람이 judge와 판정을 의심할 때 근거를 따라갈 수 있어야 한다.

## 끝남

- `deno task check`가 통과한다(docs 단계가 skill 안의 path를 본다).
- 위험 test: 없음. 이유: 글이다. 판정은 program이 계산하고 이 task에는 판정이 없다.
- 남지 않음: `grep -rn "run.md\|report.md" .claude/skills/eval-run .claude/skills/eval-experiment`에서 두 file의 쓰는 쪽이 한 곳씩이다(runner가 `run.md`, experimenter가 `report.md`).
- `eval-experiment`가 150줄 이하, `eval-run`이 200줄 이하이고, frontmatter가 `name`과 `description` 둘이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 `project-docs/context-component-registry.yaml`에 role 둘과 skill 둘을 올린다(worker는 registry를 고치지 않는다). 제안: 새 role 둘 `runner`("experiment를 돌리고 진행을 보고 실행 기록을 쓴다")와 `experimenter`("판정을 해석하고 원인을 가르고 다음 spec 초안을 쓴다")를 `roles`에 더하고, component `skill-eval-run`(roles `[runner]`, path `.claude/skills/eval-run/`)과 `skill-eval-experiment`(roles `[experimenter]`, path `.claude/skills/eval-experiment/`)를 올린다. `change_reasons.paths`는 `tests/eval/run.ts`, `deno.json`, `tests/eval/experiment/spec/types.ts`. note: "명령 이름, experiment 기록 file의 꼴, 역할 표가 바뀔 때."
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것. 특히 실제 CLI 인자와 출력이 위 계획 이름과 달랐던 곳.
- 넘길 줄: 남의 file을 최소로 맞춘 곳(없어야 한다)
- 계약 바꾸기 요청: `result.json`의 `overfit?`, `repeats?`, `assembly?`가 landed 코드와 달라 skill이 읽을 수 없으면 적는다.
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 두 skill 모두 진짜 agent가 읽고 일해 본 적이 없다. 새 subagent가 `show`의 글만으로 답하고 채점하는 절차는 첫 experiment를 손으로 돌릴 때(lead) 한 번씩 해 보고 고친다.

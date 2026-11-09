---
name: issue
description: lophn의 `project-docs/issues/<id>.yaml`에 이슈를 올리고, 정하고, 닫고, 되살릴 때 쓴다. worker 보고의 "무겁게 짠 것"·"알려진 미완 동작"을 받을 때, review에서 결함이나 worker의 큰 실수를 찾았을 때, 사람이 bug를 말했을 때, 일하다 고치지 않고 넘어가는 문제가 생겼을 때, task가 merge되어 이슈를 닫을 때, 닫은 문제가 다시 생겼을 때.
---

# 이슈

이슈 하나가 yaml file 하나(`project-docs/issues/<id>.yaml`)다. 칸과 규칙은 `project-docs/issues/README.md`가 정하고, 목록은 `node tools/records.ts issues [--topic <t>] [--status open]`다. 이 skill은 언제 무엇을 어떻게 쓰는지다.

## 올릴지

이슈는 문제만 담는다. 쌓이면 아무도 안 본다. 올리기 전에 다음을 거른다.
- **누가 무엇을 잃나가 구체적이어야 한다.** 데이터, 권한, 사람이 보는 동작, 큰 개발 비용 중 하나를 한 문장으로 못 쓰면 올리지 않는다. "무겁다", "헷갈릴 수 있다"만으로는 이슈가 아니다.
- **"확인 못 함"은 이슈가 아니다.** 실제로 돌려 보지 못한 것은 lead가 merge 전에 확인하거나 사람에게 확인을 부탁한다. 확인해서 틀린 것이 나오면 그때 bug다. 코드만 봐도 틀리는 것이 확실하면(예: 사람이 손으로 trust해야 hook이 돈다) 처음부터 bug다.
- **사실을 적은 것은 이슈가 아니다.** "순서가 정해져 있다", "칸이 셋이다" 같은 것은 그 이유가 필요하면 코드 주석이나 architecture 문서의 결정으로 간다.
- **작은 follow-up은 이슈로 미루지 않는다.** worker 보고의 "무겁게 짠 것"·"알려진 미완 동작"이 그 task 안에서 고칠 만큼 작으면 같은 worker에게 고쳐 보내게 하고 merge한다.
- **무게(defect)는 줄이는 비용이 작고 얻는 것이 구체적일 때만** 올린다(중복 지우기, 안 쓰는 칸, 같은 일을 두 길로 하기). 그렇지 않은 무게는 올리지 않는다.

## 올리기

1. **코드와 대조한다.** worker 보고, review 메모, 옛 문서의 글을 그대로 옮기지 않는다. 적힌 파일과 함수를 열어 지금도 그런지 본다. 옮겨 적은 글은 자주 틀린다(예: 이미 고쳐짐, 개수가 다름, 원인이 다른 곳). 이미 고쳐졌으면 올리지 않는다.
   - "사람이 ~하면"으로 쓰는 영향은 그 동작을 하는 화면이나 tool을 코드에서 찾는다. 그 길이 없으면 영향이 아니다(반쯤 만든 기능이다).
   - "제한이 없다", "~뿐이다", "~가 없다"는 grep으로 확인한다. file과 함수 이름, 개수는 열어 본 것만 쓴다. 세 계획이 올린 이슈 여섯 중 다섯이 이 칸에서 틀렸다.
2. **같은 이슈를 찾는다.** `grep -rln "<함수나 파일 이름>" project-docs/issues`로 열린 것과 닫은 것(`status: fixed|kept`)을 같이 본다. 열린 것에 있으면 그 file의 칸에 덧붙인다. 닫은 것에 있으면 새로 쓰지 않고 회귀로 되살린다(아래).
   - 겉 문구(실패 이름, 오류 code)가 같다고 같은 이슈가 아니다. 실패의 detail(이유, 증거, log)을 읽어 원인이 같은지 본 뒤에 덧붙인다. detail을 못 읽으면 "원인 확인 못 함"으로 따로 쓴다. 새 wire 회귀를 옛 입력 이슈의 "막힌 앱"으로 붙였다가 진단이 늦어진 일이 있다.
3. **id와 topic을 고른다.** file 이름 `<id>.yaml`의 id는 kebab-case이고 한 번 정하면 바꾸지 않는다. `topic`은 architecture 문서 이름이 있으면 그것(`approval`, `coding-agent` …), 없으면 `shell`, `platform`, `code-health`, `mistakes`, `planning`이다.
4. **kind를 고른다.** 동작이 틀리거나 아직 안 되면 bug, 동작은 맞는데 코드가 문제면 defect, worker가 크게 잘못했으면 mistake. worker 보고의 "알려진 미완 동작"은 bug, "무겁게 짠 것"은 defect다.
5. **쓴다.** 칸은 README의 yaml 그대로다.
   - `now`: 파일 path와 함수 이름, 어떻게 그렇게 되나. 읽는 사람이 코드를 바로 열 수 있게.
   - `impact`: 누가 무엇을 잃나. 막연한 "헷갈린다"보다 데이터, 권한, 화면, 개발 비용 중 무엇인지.
   - `fix`: 안마다 크기(작음, 중간, 큼)와 잃는 것. 추천 하나를 밝힌다.
   - `modules`: `project-docs/module-catalog.yaml`에 있는 path만. 걸린 module을 빠짐없이.
   - task id, commit hash, 요구 ID를 쓰지 않는다. 찾은 날은 git log가 안다.
6. **`decide`를 쓸지 정한다.** 아래 "정하기" 기준으로 답이 나오면 `decide` 대신 `decided`를 쓴다. 사람만 정할 수 있는 것(제품 동작, 되돌리기 비싼 것)만 `decide`로 남긴다.
7. `node tools/records.ts check --file project-docs/issues/<id>.yaml`로 칸과 modules를 본다.

## 정하기

정할 것을 사람에게 묻기 전에 이미 정해진 것으로 답이 나오는지 본다. 나오면 묻지 않는다.
- **architecture 문서에 규칙이 있나.** event, approval 등의 "지키는 것"과 "결정"에서 답이 나오는 경우가 많다.
- **AGENTS.md "속도"로 정해지나.**
  - 가장 단순한 구현, 미리 만들지 않는다: 실제로 막히거나 필요해질 때 한다.
  - 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다: 그것만 막는 장치는 지운다. AI가 만든 코드와 agent의 실수, 인터넷에서 온 것을 막는 장치(데이터 잃기, 폴더 밖 쓰기, 틀린 되돌리기)는 남긴다.
- **반쯤 만든 길이면 둘로 나눈다.** 지워도 잃는 기능이 없는 죽은 코드는 지운다. 제품 기능을 반만 만든 것(지우면 그 기능을 포기)은 사람에게 묻는다. 물을 때는 살리는 비용과 지우면 잃는 것을 같이 쓴다.
- **경계도 아니고 동작도 맞는 무거운 내부 구현**은 사람에게 묻지 않는다. 줄이는 비용이 작고 얻는 것이 구체적이면 "정한 것: 줄인다. <어떻게>"로 두고, 아니면 kept로 닫는다. 미뤄 두는 "나중에 정한다"를 만들지 않는다.

사람에게 물을 때는 질문 도구보다 채팅으로 먼저 설명한다. 무엇이 어떻게 돌아가는지, 예 하나, 고르는 것마다 잃는 것, 추천. 원칙 하나로 여러 이슈가 정해지면 원칙을 먼저 묻는다. 결정이 나면 `decide`를 `decided`로 옮기고, 결정은 change-log 항목의 `decisions`에 남긴다(`by: person | agent`, 사람이 정하지 않고 추천으로 진행한 것은 agent).

## mistake

worker가 크게 잘못한 것(review에서 되돌린 것, 사람이 찾은 것)을 `kind: mistake`, `topic: mistakes`로 쓴다. 코드보다 그 실수를 가능하게 한 context를 본다.
- `cause`: 지침이 없었나, 틀렸나, 있었는데 그 worker에게 안 실렸나(pull 문서에만 있었나).
- `prevent`: check로 잡을 수 있으면 check. 못 하면 바꿀 문장과 그 문장이 실리는 곳(AGENTS.md, skill, brief, `worker-prompt`).
- 한 번이면 문장으로 막고 끝낼 수 있다. 다시 생기면 check로 막는다.

## 닫기

task가 merge되거나 사람이 남기기로 정하면 `status`를 바꾼다. file은 옮기거나 지우지 않는다.
- `status: fixed`(고침) 또는 `kept`(남김)로 바꾸고 `closed`(fixed면 지금 코드가 어떻게 하나, kept면 남기는 이유)와 `guard`(다시 생기면 잡는 test나 check 이름, 정말 없으면 `없음`)를 채운다.
- fixed는 같은 변경에서 change-log 항목을 남긴다(`products/change-log/README.md`).
- 고치지 않고 남기는 것도 코드 주석으로 옮기고 지우지 않는다. kept로 둔다.

## 회귀

닫은 문제가 다시 보이면 `status: open`으로 되돌리고 `regressed`(앞서 어떻게 닫았나, 이번에 무엇이 같은가)를 쓴다.
- bug: 이번에 고칠 때 test를 쓴다(AGENTS.md "두 번 이상 고친 버그", `write-test` skill).
- mistake: 문장으로 막은 것이 실패했다. check로 막는다.
- `guard: 없음`으로 닫은 이슈가 회귀 후보다. 같은 module을 고칠 때 닫은 이슈도 훑는다(`node tools/records.ts issues --topic <t>`).

## 확인

쓰거나 옮긴 뒤 본다.
- `modules`가 모두 module-catalog에 있다. 닫은 이슈에는 `closed`와 `guard`가 있다.
- 열린 이슈의 `decide`가 정말 사람만 정할 수 있는 것이다.
- `node tools/records.ts check`(`npm run check`의 records 단계)가 통과한다.

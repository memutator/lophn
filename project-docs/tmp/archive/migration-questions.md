# requirements migration — 정할 것과 지금 상태 (2026-10-12)

옛 requirements(platform, problems, apps/sdk)를 새 requirements로 옮기는 중에 사람이 정해야 할 것을 모았다. 문항마다 lead 추천이 있다. 답 칸을 채우거나 "추천대로"라고 하면 된다.

* 분류표: `migration/triage/`
* 거르는 기준: `migration/removed.md`(지운 것, 보류, 바뀐 모델), `migration/terms.md`(말 표)
* 범위와 ID: `migration/plan.md`
* 진행 기록: `docs-review.md` 6장

## 1. 지금 상태

**다 쓴 것.** 모두 `proposed`이고 사람 확인 전이다.

| 파일               | 요구                         | ID                   |
| ---------------- | -------------------------- | -------------------- |
| core-server      | 21 (core-api 12, server 9) | req-0200 \~ req-0220 |
| core-supervision | 2                          | req-0250 \~ req-0251 |
| core-secrets     | 12                         | req-0400 \~ req-0411 |
| core-diagnostics | 12                         | req-0450 \~ req-0461 |
| base             | 13                         | req-0600 \~ req-0612 |
| sdk              | 11                         | req-0500 \~ req-0510 |

새 ID가 어느 분류표 줄에서 왔는지는 `migration/written/`에 있다.

**답을 기다리는 것.**

| 파일             | candidate                                         | 걸린 문항      |
| -------------- | ------------------------------------------------- | ---------- |
| core-problems  | 103 (problems-a 39, problems-b 60, 다른 묶음에서 넘어온 4) | 1, 2, 3, 4 |
| core-approvals | 19 (+ 넘어온 1)                                      | 5          |
| core-config    | 26                                                | 6, 7, 8    |

## 2. 정할 것

### 파일 구조

**1. core-problems가 50개를 넘는다**

* 상황:
  * candidate가 103개이고, 겹치는 것을 합쳐도 80개쯤이다.
  * README 3장은 "50개쯤 넘으면 자식 요소의 파일로 나눈다"고 정했다. 그런데 catalog에서 problems는 자식이 없다.
  * shell도 나중에 같은 처지가 된다.
* 걸린 줄: core-problems 전부
* 추천: catalog는 쪼개지 않는다. README에 "자식이 없는 요소는 50개를 넘어도 파일 하나"를 예외로 넣는다.
* 답: 오키

### problems

**2. repair ticket과 claim이 남는가**

* 상황:
  * 문제를 고치는 일을 ticket으로 만들고, coding agent가 claim을 잡아 고친다는 옛 모델이다.
  * 결정 원문에는 이 모델을 남기거나 지운다는 말이 없다. HANDOFF는 "ticket의 자리는 problems 리뷰 때 다시 본다"고 미뤘다.
  * coding agent에게 남긴 앱 tool 묶음에는 ticket이 들어 있다.
* 걸린 줄: problems-a의 closing R9a, grouping R8a, R8b, R9, R14b(그리고 grouping R12), problems-b의 repairs R4a, R5
* 추천:
  * 남긴다.
  * 남긴다면 ticket이 problems에 속하는지 apps에 속하는지도 정해야 한다. 지금 리팩터링 계획은 코드를 core의 apps 아래에 둔다.
* 답:

**3. 문제에 원인 가설이 붙는 자리**

* 상황:
  * 같은 분류로 묶은 문제가 같은 원인이라는 증명은 아니다. 그래서 문제 상세에 보고(관측)와 원인 가설을 갈라 보이는 규칙이 있었다.
  * 원인 가설을 붙이던 해석 연결은 지운 것(문서의 판, 앱 문서, run 단위 revert)에 걸려 빠졌다.
* 걸린 줄: problems-a grouping R5
* 추천: 뺀다.
* 답:

**4. 진단 상세 수집을 끄는 설정**

* 상황:
  * 문제가 생겼을 때 snapshot과 상세 기록을 모으는 일을 사람이 끌 수 있는지다.
  * 끌 수 있다면 "끄면 새 수집만 멈추고 이미 모은 snapshot과 기록은 그대로"가 요구가 된다.
* 걸린 줄: problems-b snapshots R7
* 추천: 없음. 정해 주세요.
* 답: 둔다

### approvals·config

**5. 승인 선택지**

* 상황:
  * "Always allow"를 두지 않는 것은 사람 말 없이 lead 추천대로 간 것이다(removed.md 3장).
  * 지금 코드의 확인 창은 "한 번 허락 / 이 session 동안 허락 / 거절"이다.
* 걸린 줄: approvals-config의 approvals R18(그리고 candidate R19a, R20a)
* 추천: 선택지는 "한 번 허락 / 이 session 동안 허락 / 거절"로 하고, Always allow는 두지 않는다.
* 답:

**6. config는 무엇을 맡나**

* 상황:
  * agent 설정은 전역·project·Operator 층이다(req-0038).
  * 옛 요구는 config가 "내장 기본값과 전역 선택" 두 층만 맡고, 자리별 agent 설정은 다른 원본에 둔다고 했다.
* 걸린 줄: approvals-config settings R5
* 추천:
  * config는 층을 합치고 검사하는 장치만 맡는다.
  * 항목의 뜻과 원본은 그 항목을 가진 요소(agents 등)가 가진다.
* 답:

**7. 전역 층에 둘 것**

* 상황:
  * 옛 요구는 전역 층에 role별 기본 model, 요약용 model 한 칸, 즐겨찾기 model 목록, 기본 권한, provider·model catalog 보완을 두었다.
  * 새 설계에서 model은 agent 설정에서 정한다(req-0039).
* 걸린 줄: approvals-config settings R7c
* 추천: role별 기본 model과 즐겨찾기 목록만 남기고 나머지는 뺀다.
* 답:

**8. 지침을 고치면 언제 반영되나**

* 상황:
  * LOPHN.md 같은 지침을 고쳤을 때 도는 run에 언제 반영되는지다.
  * 지금 코드는 call마다 다시 읽는다. skill은 "다음 run부터, 도는 run은 시작할 때 읽은 것"이다(req-0099).
* 걸린 줄: approvals-config settings R24b
* 추천: skill과 같게 "다음 run부터"로 맞춘다.
* 답:

### sdk

**9. SDK가 처음 내놓을 package 구성**

* 상황: 옛 첫 묶음의 이름 목록에 지운 것(cap-save, 앱 문서 저장)과 정하지 않은 것(cap-schedule, format package)이 섞여 있다.
* 걸린 줄: sdk R4
* 추천: apps를 볼 때 정한다. 지금은 보류.
* 답:

**10. cap-schedule의 automation**

* 상황:
  * 직접 명령과 automation이 같은 handler를 쓰는 것, 호출 문맥 전달, 예외 수집을 묶은 package다.
  * automation이 주기 실행(보류)을 가리키는지가 불분명하다.
* 걸린 줄: sdk R27
* 추천: 주기 실행이 보류라 이것도 보류.
* 답:

**11. 앱이 화면 상태를 agent에게 보여 주는 기능**

* 상황:
  * 앱이 화면 상태를 등록하고, 민감한 칸을 빼고, agent가 주석을 다는 기능이다(옛 이름 agent-context).
  * 결정 원문에 이 기능이 없다. 남긴다면 Context와 이름이 겹치지 않게 다시 지어야 한다.
* 걸린 줄: sdk R39
* 추천: apps를 볼 때 정한다. 지금은 보류.
* 답:

### diagnostics·server

**12. 동봉 SDK와 설치된 SDK의 hash 비교 점검**

* 상황: diagnostics의 점검인지, 보류한 install-and-update의 일인지 불분명하다.
* 걸린 줄: secrets-diagnostics-base diagnostics R9
* 추천: install-and-update 쪽 일로 보고 보류.
* 답:

**13. 넓은 grant와 오래 쓰지 않은 grant 점검**

* 상황: 너무 넓은 grant, file과 network를 함께 허락한 앱, 오래 쓰지 않은 grant를 점검하는 항목이다. 새 앱 허락 모델에도 이 개념이 있는지 모른다.
* 걸린 줄: secrets-diagnostics-base diagnostics R10b
* 추천: apps 허락 모델을 볼 때 정한다. 지금은 보류.
* 답:

**14. API 호환 규칙**

* 상황:
  * "같은 major 안에서는 선택 필드 추가만 허용하고, 그 밖의 변경은 새 major로 가른다"는 규칙이다.
  * AGENTS.md 호환성 절("MVP 이전, 호환 장치를 만들지 않는다")과 부딪힐 수 있다.
* 걸린 줄: server-supervision api R6a
* 추천: 뺀다.
* 답:

**15. 응답 시간 수치**

* 상황: p95, p99 같은 응답 시간 수치와 재는 법이다. worker는 README 1장("재는 것은 eval 몫")에 따라 뺐다.
* 걸린 줄: server-supervision의 responsiveness R6\~R10
* 추천: eval로 보낸다.
* 답:

## 3. 읽을 때 짚을 곳 (다 쓴 요구 중 worker가 확신하지 못한 곳)

| 요구                 | 짚을 것                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| req-0205           | 호출자 종류 목록이 새 모델과 맞는지 확인하지 못해서, 목록은 빼고 "token이 자격을 정한다"만 썼다.                                            |
| req-0250           | child의 자격을 쥐는 쪽이 supervision인지 app-runtime인지 확인하지 못했다.                                                 |
| req-0406           | token이 새면 안 되는 곳의 목록(argv, URL, 환경 변수, skill, 안내, 오류, event, model 문맥, 일반 조회 결과)을 그대로 acceptance로 옮겼다. |
| req-0402, req-0403 | "허용된 이름"은 앱 허락 모델이 정하는데, 그 모델이 아직 정해지지 않았다.                                                            |
| req-0504           | SDK의 앱 secret 쓰기가 secrets 요구와 맞는지 봐야 한다.                                                               |
| req-0500           | SDK의 앱 정의 검사가 app-releases의 검사와 같은 기준인지 봐야 한다.                                                         |

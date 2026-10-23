# workflow: 남은 것

상태: 로드맵. 2026-10-20 사람이 방향을 내고 2026-10-22 모양을 다시 정했다. `kind: agent` workflow(정의, instance와 줄, report와 고치기, 넘기기, 사람 step, 켤 때와 멈춤, 기본 view, workflow artifact, kit의 node 그림)는 계획 `workflow`로, workflow별 layout(desk와 상단 bar의 `project ▾ / desk ▾`)은 계획 `workflow-shell`로 land했다. job이 instance를 시작하는 길은 계획 `schedule-job`으로, `kind: flow`(workflow 폴더의 `flow.ts`를 sandbox process로 띄우는 길, SDK `@lophn/flow`, flow caller, `workflow.check`)는 계획 `flow`로 land했다(`project-docs/architecture/job.md`, `project-docs/architecture/workflow.md` "flow"). 메커니즘은 `project-docs/architecture/workflow.md`다. 여기에는 아직 하지 않은 일과 그 일을 정하는 사람의 결정만 남긴다.

## 원칙: lophn program은 최대한 약하다

- lophn은 workflow 안의 agent와 program이 하는 말을 믿고, 기록하고, 보여 주고, 말한 곳에 전해 줄 뿐이다. step이 통과했는지, 결과가 맞는지 모르고, 순서를 강제하지 않는다.
- 정책과 예외 처리는 workflow 안의 agent가 한다. 결정적이고 딱딱한 제약이 필요하면 그 workflow의 program이 진다(eval의 `checkSpecLocked`처럼).
- 아래 남은 일도 이 원칙을 따른다.

## 남은 일

1. **서드 파티 harness 참가자.** 선언으로 받되 넘기지 못한다(`not_handed`·`harness`). lophn agent가 coding agent에게 맡기는 길(Router가 `coding_agent`를 거절한다)을 열 때 같이 연다(2026-10-21, `problem-ticket.md`).
2. **domain artifact의 node 그림.** kit은 모든 artifact view에 나온다. domain 쪽에 쓰는 법을 싣는 일은 `roadmap/domain.md` "node 시각화"다.

## 정한 것 (사람)

2026-10-20
- 딱딱한 규칙을 program에 두지 않는다. agent 성능이 오를수록 덜어내야 하고, 유지보수가 어렵고, 코드의 반감기가 짧다.
- 결정적 처리와 검증은 agent가 짜게 한다. 그래야 lophn이 domain에 기대지 않는다. 2026-10-21에 바꿨다: lophn agent가 직접 짠다.
- workflow file 안에서 일회용 agent를 정의하지 않는다. 참가자는 있는 agent다. 2026-10-22에 사람과 서드 파티 harness를 더했다.
- flow도 workflow의 kind로 둔다.
- workflow 안에서는 묻지 않는다. workflow로 쓴다는 것은 바깥 효과까지 책임지겠다는 뜻이다.

2026-10-22. 10-20의 "lophn은 연락처를 알려 주는 데까지"와 "상태를 두지 않는다"는 아래로 바뀌었다.
- workflow 선언을 domain 밑에 두지 않는다. workflow는 여러 domain에 걸치는 일이 더 많다.
- 선언에 kind 구분을 둔다.
- workflow는 instance가 된다. workflow에 정의된 대로 step마다 상태를 갖고, 추적되고, 화면에 보인다.
- 그래도 lophn program은 강하게 제약하지 않는다. 최대한 약하게 둔다.
  - lophn은 workflow 안의 agent와 program의 말을 믿기만 한다. 통과했는지도 모른다.
  - 진짜 결정적이고 딱딱한 제약이 필요하면 그것은 workflow에서 다뤄지는 program의 책임이다.
- 진행은 agent가 받은 대로 쓰는 자연어 칸으로 보인다. lophn이 그 뜻을 이해할 필요가 없다.
- "같은 참가자가 다시 step을 받을 때 session을 이어 쓸지" 같은 정책은 workflow에서 정한다. lophn이 정하지 않는다.
- instance 상태는 workflow 안에서 고친다. coordinator가 고칠 수도 있고, 그 step을 진행 중인 agent가 뒤 step을 고칠 수도 있다. 사람이 화면에서 step을 옮기는 길을 따로 두지 않는다.
- program이 약해야 하는 까닭: 아무리 정형화된 작업이라도 예외 처리를 program이 할 수 없다. 그래서 agent를 쓴다. 이 원칙은 workflow의 모든 정책과 예외에 같이 적용한다.
- 사람도 workflow의 참가자다. 승인 단추가 아니라 실제로 논의한다. 사람 step의 결과는 사람과 맞닿은 가장 가까운 agent가 낸다.
- 연락처를 늘 싣지 않는다.
  - domain을 둔 가장 큰 이유가 추상화와 캡슐화다.
  - agent는 어디까지 알면 되는지, 상대의 in/output이 무엇인지만 알면 되고, 그 domain을 전부 알지 않아도 동작한다.
  - workflow가 이 철학을 깨면 안 된다.
- coding agent 같은 서드 파티 harness를 참가자로 둘 수 있게 한다. 실제 구현은 미룬다.
- 비용은 다루지 않는다.
- approval은 끝났다. 바꾸지 않는다.
- workflow 정의는 셋이다.
  1. programmatic하게 선언하는 것.
     - API처럼 agent를 부르고 작성한다.
     - 모두 lophn이 이해할 수 있어야 하는 것은 아니다. lophn이 이해해야 하는 범위 안에서만 이해하면 된다.
  2. `workflow.md`.
     - 1을 자연어로 쓴 글이다.
     - 모든 참여자가 읽어야 하는 것은 아니다(캡슐화).
     - 참여자마다 알아야 하는 prompt는 1에서 선언되고, 그것으로 전달된다.
  3. workflow artifact. 정적인 것(workflow 내용을 node처럼 시각화)과 instance의 실제 상태까지 반영해 보이는 것 둘이다.
- 모든 workflow에 3이 필요한 것은 아니다. workflow를 만들 때 정한다. PM이 물어보면 된다.
- workflow를 만드는 것은 PM의 책임이다.
- workflow의 node 시각화 방식을 domain에도 적용한다. 그래서 우리 kit에서 재사용 가능하게 만든다.
- sidebar는 VS Code 같은 activity bar(리본)로 바꾼다. 항목이 너무 많아져 segmented toggle로는 감당하지 못한다.

## 끝남 기준

- lophn core에 eval을 아는 코드와 report 글을 해석하는 코드가 없다.

## 하지 않는 것

- **step 통과 판정, 결과 검증, 순서 강제.** lophn은 report를 믿는다. 딱딱한 제약은 workflow의 program이 진다.
- **넘기기 정책과 예외 처리.** session 고르기, 순서 바꾸기, 다시 하기, instance 고칠 자격 판정을 lophn에 두지 않는다. workflow 안의 agent가 한다.
- **사람의 step 옮기기 단추.** 사람은 agent에게 말한다.
- **workflow 그림 그리기.** PM의 artifact가 그린다.
- **workflow를 agent prompt에 늘 싣기, 연락처.** agent는 자기 step의 prompt와 in/out만 받는다.
- **선언의 반복·갈라짐 문법.** step 안의 일은 담당의 일이다.
- **call 막기.** 선언 밖 call도 묻지도 막지도 않는다. 받은 agent의 동작은 그 agent의 할당이 거른다.
- **비용 관측과 상한.**
- **approval 바꾸기.**
- **workflow file 안의 일회용 agent.**

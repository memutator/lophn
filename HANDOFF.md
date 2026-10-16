# HANDOFF

`project-docs/plan/cleanup-report.md`를 읽고 이어서 해 줘.

wave 4 cleanup(cleanup-dead, cleanup-names, cleanup-comments)은 Windows 머신에서 끝냈고 main에 들어가 있다. 그 머신에 deno가 없어서 type check·lint·fmt·test·renderer build·core 기동을 한 번도 돌리지 못했다. main은 아직 검증 전 상태다.

할 일:

1. 보고서 "확인하지 못한 것" 표의 명령을 모두 돌린다: `deno task check:full`, `deno fmt --check`, wording `generate.ts --check`, renderer build, `project-docs/plan/tools/lead/boot.sh`로 core 두 번 기동. 개발 DB(`.dev-data`)는 schema가 바뀌었으니 먼저 지운다.
2. 실패하면 고친다. 오류는 먼저 schema 칸 이름 바꾸기(`run`→`turn`, `mode`→`delivery`, `*_commands`→`*_app_api`)에서 의심한다. 되살린 `packages/shell/main/decision-handle/ipc_test.ts`가 통과하는지 꼭 본다.
3. 모두 통과하면 고친 것을 commit한다. push는 나에게 묻고 한다.
4. 그다음 보고서 "고칠 버그" 4개를 fix task 하나로 묶어 진행할지 나에게 묻는다.

worker는 `haiku-high`를 쓴다. 정할 수 없는 것은 추천안으로 진행하고 `project-docs/tmp/docs-review.md`에 적는다. 다 끝나면 이 file을 지운다.

# place-session (닫음)

## pre-image를 core가 읽어 두는 memory route 둘과 root별 기록

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/core/main]
closed: kept
guard: 없음
```

지금: file tool이 쓰기 전에 `StageRewindFile`로 core에게 쓰기 직전 파일 내용을 읽어 두게 하고, 쓴 뒤 `RecordRewindWrite`로 결과를 기록한다(`session/rewind/write-routes.ts`, `record.ts`의 `recordBeforeWrite`). 둘 다 memory route고 허용 폴더를 root로 기록한다. 한 단위에 허용 폴더가 둘 이상이거나 앞 기록의 after와 뒤 기록의 before가 다르면 `judge.ts`가 `chain_broken`으로 건너뛴다.

영향: route 둘, root별 기록, 판정 규칙(`chain_broken` 등 skip 사유 아홉 개)이 무겁다. 대신 agent runtime이 보낸 내용을 믿지 않고 core가 직접 읽으므로 파일 되돌리기가 틀린 내용으로 덮어쓰는 일(사용자 파일 손상)을 막는다.

고치려면: 추천: 남긴다(kept). 데이터 보호 장치라 단순화 이득이 작다. 이유를 `write-routes.ts` 머리 주석에 한 문단으로 둔다.

닫음: 남긴다. 되돌릴 때 틀린 내용으로 사람 파일을 덮지 않게 한다.

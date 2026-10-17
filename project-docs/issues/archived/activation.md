# activation (닫음)

## `release.prepare_bundle`의 `ticket_source` 계약과 core가 다르다

```yaml
kind: defect
modules: [packages/core/apps, packages/protocol]
closed: fixed
guard: 없음
```

지금: 계약은 optional인데 core가 필수로 막는다.

영향: 계약과 구현이 어긋난다.

고치려면: 계약을 필수로 맞춘다.

닫음: `protocol/apps/releases.ts`의 `releasePrepareBundleInputSchema`가 `ticket_source: ticketSourceSchema`(필수, strictObject)다. `core/apps/control.ts`의 핸들러에 남은 `body.ticket_source === undefined` 검사는 타입만 optional인 중복 방어다.

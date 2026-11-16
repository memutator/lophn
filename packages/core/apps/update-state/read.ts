// 앱 하나의 기계 사이 판 차이를 모은다(`apps/update_state`). 따라가기 상태, held, 기계별 꼴 판 범위, 다른 기계 앱 기록의
// 활성 release, 이 기계 release 행을 받아 한 값으로 합친다. 읽기만 한다.
import type { ReleaseRecord, UpdateState } from "../../../protocol/apps/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { FollowState } from "../follow/mod.ts";
import type { HeldDetail, MachineExchange } from "../../folder/import/mod.ts";

type ActiveRelease = {
  bundle_hash: string;
  code_commit: string;
  data_schema: number;
};

export type UpdateStateInput = {
  app: Id<"app">;
  me: Id<"mch">;
  /** 이 기계의 활성 release. */
  current: ActiveRelease | null;
  follow: FollowState;
  held: readonly HeldDetail[];
  machines: readonly MachineExchange[];
  /** 다른 기계들의 그 앱 활성 release(앱 기록 사본). 범위 밖 기계의 기록은 없다. */
  offered: readonly { machine: Id<"mch">; release: ActiveRelease | null }[];
  releases: readonly Pick<ReleaseRecord, "bundle_hash" | "number">[];
};

export function buildUpdateState(input: UpdateStateInput): UpdateState {
  const { me, current } = input;
  const local = new Map(input.releases.map((row) => [row.bundle_hash, row]));
  const exchange = new Map(input.machines.map((row) => [row.machine, row]));

  const machineRow = (
    machine: Id<"mch">,
    release: ActiveRelease | null,
  ): UpdateState["machines"][number] => {
    const known = exchange.get(machine);
    return {
      machine,
      name: known?.name ?? machine,
      this_machine: machine === me,
      lophn_version: known?.lophn_version ?? null,
      exchange: known?.exchange ?? "ok",
      release:
        release === null
          ? null
          : {
              bundle_hash: release.bundle_hash,
              number: local.get(release.bundle_hash)?.number ?? null,
              code_commit: release.code_commit,
              data_schema: release.data_schema,
            },
    };
  };

  const others = new Map<Id<"mch">, ActiveRelease | null>();
  for (const row of input.offered) {
    if (row.machine !== me) others.set(row.machine, row.release);
  }
  // 범위 밖 기계는 앱 기록을 읽지 않아 이 앱을 쓰는지 모른다. 주고받지 못한다는 것은 보인다.
  for (const row of input.machines) {
    if (row.machine !== me && row.exchange !== "ok" && !others.has(row.machine))
      others.set(row.machine, null);
  }
  const machines = [
    machineRow(me, current),
    ...[...others]
      .map(([machine, release]) => machineRow(machine, release))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];

  // 이 기계가 지금 것보다 먼저 들인 release는 옛 release다. 사람이 이전으로 돌아가 내려놓은 release는 번호가 더 커서 newer다:
  // 그 기계는 내려오지 않으니 "그 기계가 올라오면 온다"고 보이면 틀린다.
  const currentNumber =
    current === null ? null : (local.get(current.bundle_hash)?.number ?? null);
  const held = input.held
    // 지금 release의 held는 바로 적용되는 중이다.
    .filter((row) => row.bundle_hash !== current?.bundle_hash)
    .map((row) => {
      const number = local.get(row.bundle_hash)?.number ?? null;
      const older =
        row.data_schema < (current?.data_schema ?? 0) ||
        (number !== null && currentNumber !== null && number < currentNumber);
      return {
        machine: row.origin,
        bundle_hash: row.bundle_hash,
        data_schema: row.data_schema,
        changes: row.changes,
        bytes: row.bytes,
        full: row.full,
        why: older ? ("older_release" as const) : ("newer_release" as const),
      };
    });

  return { app: input.app, follow: input.follow, held, machines };
}

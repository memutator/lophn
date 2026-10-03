import { assert, assertEquals } from "@std/assert";
import { dueTimes } from "./schedule.ts";

const FIRST = "2026-10-04T00:00:00.000Z";
const FIRST_MS = Date.parse(FIRST);
const EVERY = 60_000;

function cycle(n: number): string {
  return new Date(FIRST_MS + n * EVERY).toISOString();
}

function at(ms: number): string {
  return new Date(FIRST_MS + ms).toISOString();
}

function due(input: {
  first_at?: string;
  every_ms?: number;
  last_due_at?: string | null;
  now: string;
}) {
  return dueTimes({
    first_at: input.first_at ?? FIRST,
    every_ms: input.every_ms ?? EVERY,
    last_due_at: input.last_due_at === undefined ? null : input.last_due_at,
    now: input.now,
  });
}

function okValue(result: ReturnType<typeof dueTimes>) {
  assert(result.ok);
  return result.value;
}

function rejected(result: ReturnType<typeof dueTimes>) {
  assert(!result.ok);
  assertEquals(result.error.code, "invalid_input");
}

Deno.test(
  "lophn-agent/scheduling#R6: 10회 놓친 뒤 가장 최근 1회만 처리하고 9회를 놓침으로 센다",
  () => {
    // 0회차 이후 now가 10회차에 정확히 걸렸으니 1~10회차 미처리, 10회차만 처리한다.
    assertEquals(okValue(due({ last_due_at: cycle(0), now: cycle(10) })), {
      latest_due_at: cycle(10),
      missed_count: 9,
      next_due_at: cycle(11),
    });

    // 지금이 회차 사이 어딘가면 floor로 가장 최근 회차를 고른다.
    assertEquals(
      okValue(due({ last_due_at: cycle(0), now: at(10 * EVERY + 500) })),
      {
        latest_due_at: cycle(10),
        missed_count: 9,
        next_due_at: cycle(11),
      },
    );

    // 몇 회를 더 놓쳤으면 가장 최근 회차가 뒤로 밀리고 놓침이 늘어난다.
    assertEquals(okValue(due({ last_due_at: cycle(0), now: cycle(12) })), {
      latest_due_at: cycle(12),
      missed_count: 11,
      next_due_at: cycle(13),
    });

    // 가장 최근 회차를 이미 처리했으면 새로 처리할 회차가 없다.
    assertEquals(okValue(due({ last_due_at: cycle(10), now: cycle(10) })), {
      latest_due_at: null,
      missed_count: 0,
      next_due_at: cycle(11),
    });
  },
);

Deno.test("lophn-agent/scheduling#R3: 간격 0과 음수는 거절한다", () => {
  for (const every of [0, -1, -EVERY]) {
    rejected(due({ every_ms: every, now: cycle(5) }));
  }
  // 정수가 아니면 회차 위를 계산할 수 없다.
  for (const every of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    rejected(due({ every_ms: every, now: cycle(5) }));
  }
  // 밀리초 정수를 넘어서면 주기가 정확히 안 맞는다.
  rejected(due({ every_ms: Number.MAX_SAFE_INTEGER + 1, now: cycle(5) }));

  // 양의 정수 간격은 받는다.
  assertEquals(okValue(due({ every_ms: 1, now: FIRST })), {
    latest_due_at: FIRST,
    missed_count: 0,
    next_due_at: at(1),
  });
});

Deno.test(
  "lophn-agent/scheduling#R2: 첫 시점 전과 정확히 경계에서 회차를 센다",
  () => {
    // 첫 회차 전이면 처리할 회차가 없고 다음 회차는 first_at 그대로다.
    assertEquals(okValue(due({ now: cycle(-1) })), {
      latest_due_at: null,
      missed_count: 0,
      next_due_at: FIRST,
    });

    // 정확히 경계(now == 회차)는 due에 들어간다.
    assertEquals(okValue(due({ now: FIRST })), {
      latest_due_at: FIRST,
      missed_count: 0,
      next_due_at: cycle(1),
    });

    // 경계에서 1ms만 지나도 같은 회차다.
    assertEquals(okValue(due({ now: at(1) })), {
      latest_due_at: FIRST,
      missed_count: 0,
      next_due_at: cycle(1),
    });
  },
);

Deno.test(
  "lophn-agent/scheduling#R7: last_due_at이 없으면 first_at부터 세고, 회차 밖이면 거절한다",
  () => {
    // last_due_at이 null이면 처리 이력이 없으니 first_at 회차부터 놓침으로 센다.
    assertEquals(okValue(due({ now: cycle(3) })), {
      latest_due_at: cycle(3),
      missed_count: 3,
      next_due_at: cycle(4),
    });

    // first_at 전이면 last_due_at이 있어도 거절한다.
    rejected(due({ last_due_at: cycle(-1), now: cycle(3) }));
    // 회차 위가 아니면(last_due_at - first_at가 간격의 배수가 아님) 거절한다.
    rejected(due({ last_due_at: at(2 * EVERY + 500), now: cycle(3) }));

    // first_at보다 뒤에 있는 회차라면 처리 이력으로 믿는다.
    const resumed = okValue(due({ last_due_at: cycle(2), now: cycle(3) }));
    assertEquals(resumed.latest_due_at, cycle(3));
    assertEquals(resumed.missed_count, 0);

    // 간격이 first_at의 소수 밀리초를 어긋나게 잡아도 회차 위 여부는 정확히 판단한다.
    const offGrid = okValue(
      due({ every_ms: 250, last_due_at: at(500), now: at(1000) }),
    );
    assertEquals(offGrid.latest_due_at, at(1000));
    assertEquals(offGrid.missed_count, 1);
    assertEquals(offGrid.next_due_at, at(1250));
  },
);

Deno.test(
  "lophn-agent/scheduling#R3: 시각은 UTC ISO 밀리초 문자열만 받는다",
  () => {
    for (
      const bad of [
        "2026-10-04T00:00:00Z", // 밀리초 없음
        "2026-10-04T00:00:00.000", // UTC 표식 없음
        "2026-10-04T00:00:00.000+09:00", // offset 있음
        "2026-10-04 00:00:00.000Z", // 공백 구분
        "2026-10-04T00:00:00.0000Z", // 소수 네 자리
        "2026-13-45T99:99:99.999Z", // 형식은 맞지만 없는 날짜
        "not-a-time",
        "",
      ]
    ) {
      rejected(due({ first_at: bad, now: FIRST }));
      rejected(due({ now: bad }));
      rejected(due({ last_due_at: bad, now: FIRST }));
    }
  },
);

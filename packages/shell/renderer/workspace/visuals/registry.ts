// 대화 안 시각 블록은 앱 카드뿐이다(표·차트·도표 블록은 MVP 밖이다). 앱 카드는 본문의 `app_card` part 그대로이거나,
// 옛 `visual` part 안의 `app_card` 블록이다. 받은 값을 믿지 않고 그릴 수 있는 모양인지 보고, 아니면 그리지 않는다.
// contracts를 import하면 zod와 core 쪽 graph가 renderer bundle에 들어오므로 id 모양만 여기에 옮겨 적는다.

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const APP_ID = new RegExp(`^app_${ULID}$`);
const RELEASE_ID = new RegExp(`^rel_${ULID}$`);

export interface AppCardRef {
  readonly app: string;
  /** 카드를 만든 때의 판. 본문의 `app_card` part는 판을 싣지 않아 null이고, 그때는 지금 판이다. */
  readonly release: string | null;
  /** 앱 blueprint 화면 key. */
  readonly view: string;
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 옛 `visual` part의 블록이 앱 카드이면 그 참조와 제목. 아니면 null이다. */
export function cardOfBlock(
  raw: unknown,
): { readonly card: AppCardRef; readonly title: string | null } | null {
  if (!plain(raw) || raw["kind"] !== "app_card") return null;
  const payload = raw["payload"];
  if (!plain(payload)) return null;
  const { app, release, view } = payload;
  if (
    typeof app !== "string" || !APP_ID.test(app) ||
    typeof release !== "string" || !RELEASE_ID.test(release) ||
    typeof view !== "string" || view === ""
  ) return null;
  const title = raw["title"];
  return {
    card: { app, release, view },
    title: typeof title === "string" && title !== "" ? title : null,
  };
}

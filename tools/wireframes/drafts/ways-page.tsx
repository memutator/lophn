// Context 탭을 여는 길을 한 장에 모은다. 길마다 눌러 가는 순서를 상자와 화살표로 보이고, 끝 상자는 열리는 Context
// 탭이다. "try it"은 gallery에서 그 길을 눌러 볼 수 있는 page로 간다(frame은 iframe이라 위 창의 주소를 바꾼다).
import { pageById } from "../pages/index.ts";
import { WAYS } from "./ways.ts";
import styles from "./compose.module.css";

function goTo(id: string) {
  const target = globalThis.top ?? globalThis;
  target.location.hash = `#/${id}`;
}

export function ContextWays() {
  return (
    <div className={styles.waysPage}>
      <h1 className={styles.searchTitle}>Ways to open a Context tab</h1>
      <ol className={styles.ways}>
        {WAYS.map((way) => (
          <li key={way.title} className={styles.way}>
            <h2 className={styles.wayTitle}>{way.title}</h2>
            <div className={styles.wayFlow}>
              <span className={styles.wayStep}>{way.steps[0]}</span>
              {way.steps.slice(1).map((step) => (
                <span key={step} className={styles.wayHop}>
                  <span className={styles.wayArrow} aria-hidden="true">→</span>
                  <span className={styles.wayStep}>{step}</span>
                </span>
              ))}
              <span className={styles.wayHop}>
                <span className={styles.wayArrow} aria-hidden="true">→</span>
                <span className={styles.wayResult}>
                  Context tab<br />
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {way.result}
                  </span>
                </span>
              </span>
            </div>
            <a
              className={styles.link}
              href={`#/${way.tryIt}`}
              title={pageById(way.tryIt)?.title}
              onClick={(event) => {
                event.preventDefault();
                goTo(way.tryIt);
              }}
            >
              try it →
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

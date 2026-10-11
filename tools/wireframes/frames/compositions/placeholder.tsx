// 새 설계 part의 첫 page. 명세가 오기 전의 자리표시다.
//
// 새 설계 page는 이 파일처럼 `@lophn/design/components`와 고정 데이터만으로 한 화면을 짜고,
// frames/screens.tsx의 SCREENS에 올린다. core·preload·mock 통로를 부르지 않는다. 문구는
// wording catalog가 아니라 이 구성 안의 고정 글이다.
import { EmptyState, launcherEmptyIcon } from "@lophn/design/components";

import styles from "./placeholder.module.css";

export function PlaceholderComposition() {
  return (
    <div className={styles.window}>
      <div className={styles.bar}>lophn</div>
      <div className={styles.body}>
        <div className={styles.card}>
          <EmptyState
            icon={launcherEmptyIcon}
            message="New design pages come next. Each one is a static composition for you to check before it is built."
            action={{ label: "Back to the list", onSelect: goToList }}
          />
        </div>
      </div>
    </div>
  );
}

// frame은 iframe 안이라서 목록은 바깥 문서의 주소가 가리킨다.
function goToList() {
  const target = globalThis.top ?? globalThis;
  target.location.hash = "#/";
}

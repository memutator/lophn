import { t } from "@lophn/wording";
import styles from "./author-mark.module.css";

export interface AuthorMarkProps {
  // agent가 쓴 내용의 작성자 이름(사람이 아는 역할 이름).
  author: string;
}

// agent 작성 표식은 작은 글자만 쓴다. 반짝임·강조색을 두지 않는다.
export function AuthorMark({ author }: AuthorMarkProps) {
  return (
    <span className={styles.mark} data-author="agent">
      {t("common.author.label", { author })}
    </span>
  );
}

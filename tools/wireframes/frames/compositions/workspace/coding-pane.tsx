// Settings › Coding agents. 제품마다 실행 파일, version, 로그인, turn 끝 신호, skill 설치를 보이고
// 기본 실행 옵션을 정한다. 연결 만들기, 범위, 이름, 회수 단추와 doctor 단계는 없다.
import { useState } from "react";
import {
  Button,
  Field,
  Input,
  Select,
  StatusMark,
} from "@lophn/design/components";
import { retryIcon } from "../../../../../packages/shell/renderer/icons/mod.ts";

import a from "../agents.module.css";
import c from "../compose.module.css";
import { CODING_PRODUCTS, type CodingMark } from "./data.ts";
import { VendorIcon, vendorOf } from "../../vendors/vendor-icon.tsx";
import styles from "./workspace.module.css";

/** 제품 이름 앞에 vendor 아이콘을 붙인다. */
function ProductName({ name }: { name: string }) {
  const vendor = vendorOf(name);
  return (
    <span className={styles.productName}>
      {vendor === undefined ? null : <VendorIcon vendor={vendor} />}
      {name}
    </span>
  );
}

const DEFAULT_CHOICES = ["Claude Code", "Codex", "Gemini CLI", "OpenCode"];

/** 기본 제품 고르기. 제품마다 아이콘이 붙은 줄이다. 맡길 수 없는 제품은 목록에 없다. */
function ProductPicker() {
  const [value, setValue] = useState("Claude Code");
  return (
    <fieldset className={styles.productPicker}>
      <legend>Default product</legend>
      <div role="radiogroup" aria-label="Default product">
        {DEFAULT_CHOICES.map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={name === value}
            className={styles.productOption}
            onClick={() => setValue(name)}
          >
            <ProductName name={name} />
          </button>
        ))}
      </div>
      <span className={styles.muted}>
        Used when an App Engineer does not pick one.
      </span>
    </fieldset>
  );
}

function Mark(
  { mark, note }: {
    mark: { tone: CodingMark; label: string; note?: string };
    note?: string;
  },
) {
  if (mark.label === "-") return <span className={styles.dim}>-</span>;
  return (
    <div className={styles.cell}>
      <StatusMark tone={mark.tone} label={mark.label} />
      {(note ?? mark.note) === undefined
        ? null
        : <span className={styles.caption}>{note ?? mark.note}</span>}
    </div>
  );
}

export function CodingPane() {
  return (
    <div className={`${a.setPage} ${styles.wide}`}>
      <h1 className={c.searchTitle}>Coding agents</h1>
      <p className={a.setLead}>
        Products on this computer that App Engineers can hand a task to.
      </p>
      <div className={styles.toolbar}>
        <span className={styles.muted}>Detected at 10:41:52</span>
        <Button icon={retryIcon}>Detect again</Button>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Executable</th>
              <th scope="col">Sign-in</th>
              <th scope="col">Turn-end signal</th>
              <th scope="col">Takes a task</th>
              <th scope="col">Skill</th>
            </tr>
          </thead>
          <tbody>
            {CODING_PRODUCTS.map((product) => (
              <tr key={product.name}>
                <td>
                  <ProductName name={product.name} />
                </td>
                <td>
                  {product.executable === null
                    ? <span className={styles.dim}>Not found</span>
                    : (
                      <div className={styles.cell}>
                        <span className={styles.mono}>
                          {product.executable}
                        </span>
                        <span className={styles.caption}>
                          version {product.version}
                        </span>
                      </div>
                    )}
                </td>
                <td>
                  <Mark mark={product.signIn} />
                </td>
                <td>
                  <Mark mark={product.turnEnd} />
                </td>
                <td>
                  <Mark mark={product.handOff} />
                </td>
                <td>
                  <div className={styles.cell}>
                    <Mark mark={product.skill} />
                    {product.skill.tone === "critical"
                      ? <Button size="sm">Install again</Button>
                      : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted}>
        Without a turn-end signal, lophn sends only the first prompt and no
        follow-up messages. A product that can't take the first prompt is not
        offered as a default.
      </p>
      <section className={a.setSection}>
        <h2 className={a.setSectionTitle}>Default run options</h2>
        <div className={styles.options}>
          <ProductPicker />
          <Field label="Model">
            <Select
              options={[
                { value: "default", label: "Product default" },
                { value: "opus", label: "Opus" },
                { value: "sonnet", label: "Sonnet" },
              ]}
              defaultValue="default"
            />
          </Field>
          <Field
            label="Extra command-line options"
            help="Passed as written when lophn starts the product. Its permission mode follows these options and the product's own defaults."
          >
            <Input defaultValue="--add-dir ../shared" />
          </Field>
          <div className={styles.actions}>
            <Button variant="primary">Save</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

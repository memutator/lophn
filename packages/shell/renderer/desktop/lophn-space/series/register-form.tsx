import { type FormEvent, useState } from "react";
import {
  Button,
  Field,
  FormFrame,
  Input,
  Select,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  placeOf,
  placeValue,
  validNextRule,
  validSeriesName,
} from "../model.ts";
import type { Catalog, LophnSource, Series } from "../source.ts";
import { formatLabel } from "../documents/notices.tsx";
import listStyles from "../documents/documents.module.css";
import styles from "./series.module.css";

export interface RegisterSeriesProps {
  source: LophnSource;
  catalog: Catalog;
  formats: readonly string[];
  onRegistered: (series: Series) => void;
}

type Problem = "name" | "title" | "rule";

// series 등록: 자리·이름·제목·format·정렬·다음 이름 규칙(documents/series#R1).
// 첫 key는 등록 뒤 첫 멤버를 더할 때 사람이 정한다.
export function RegisterSeries(
  { source, catalog, formats, onRegistered }: RegisterSeriesProps,
) {
  const [place, setPlace] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [chosenFormat, setFormat] = useState<string | undefined>(undefined);
  // format 목록이 늦게 와도 문서 format을 먼저 고른다.
  const format = chosenFormat ??
    (formats.includes("document") ? "document" : formats[0]);
  const [direction, setDirection] = useState<"ascending" | "descending">(
    "ascending",
  );
  const [rule, setRule] = useState("");
  const [problems, setProblems] = useState<ReadonlySet<Problem>>(new Set());
  const [failure, setFailure] = useState<"taken" | "failed" | null>(null);

  const placeOptions = [
    ...catalog.projects.map((item) => ({
      value: placeValue({ kind: "project", id: item.id }),
      label: item.title,
    })),
    ...catalog.apps.map((item) => ({
      value: placeValue({ kind: "app", id: item.id }),
      label: item.title,
    })),
  ];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = new Set<Problem>();
    if (!validSeriesName(name)) found.add("name");
    if (title.trim() === "") found.add("title");
    if (!validNextRule(rule)) found.add("rule");
    setProblems(found);
    const chosen = place === undefined ? null : placeOf(place);
    if (found.size > 0 || chosen === null || format === undefined) return;
    const result = await source.createSeries({
      place: chosen,
      name,
      title,
      format,
      direction,
      nextRule: rule,
    });
    if (!result.ok) {
      setFailure(result.code === "conflict" ? "taken" : "failed");
      return;
    }
    setFailure(null);
    onRegistered(result.value);
  };

  return (
    <FormFrame
      header={
        <h1 className={styles.title}>
          {t("documents.heading.register-series")}
        </h1>
      }
    >
      <form
        className={styles.form}
        onSubmit={(event) => void submit(event)}
        data-register-form=""
      >
        <Field label={t("documents.label.place")}>
          <Select
            options={placeOptions}
            value={place}
            placeholder={t("documents.label.choose-place")}
            onValueChange={setPlace}
          />
        </Field>
        <Field
          label={t("documents.label.series-name")}
          help={t("documents.label.name-help")}
          error={problems.has("name")
            ? t("documents.error.name-invalid")
            : failure === "taken"
            ? t("documents.error.series-taken")
            : undefined}
        >
          <Input
            data-series-name=""
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          label={t("documents.label.series-title")}
          error={problems.has("title")
            ? t("documents.error.title-missing")
            : undefined}
        >
          <Input
            data-series-title=""
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t("documents.label.format")}>
          <Select
            options={formats.map((item) => ({
              value: item,
              label: formatLabel(item),
            }))}
            value={format}
            onValueChange={setFormat}
          />
        </Field>
        <Field label={t("documents.label.series-order")}>
          <Select
            options={[
              {
                value: "ascending",
                label: t("documents.label.order-ascending"),
              },
              {
                value: "descending",
                label: t("documents.label.order-descending"),
              },
            ]}
            value={direction}
            onValueChange={(value) =>
              setDirection(value === "descending" ? "descending" : "ascending")}
          />
        </Field>
        <Field
          label={t("documents.label.next-rule")}
          help={t("documents.label.next-rule-help")}
          error={problems.has("rule")
            ? t("documents.error.rule-invalid")
            : undefined}
        >
          <Input
            data-next-rule=""
            value={rule}
            onChange={(event) => setRule(event.target.value)}
          />
        </Field>
        {failure === "failed"
          ? (
            <p className={listStyles.error} data-register-failed="">
              {t("documents.error.register-failed")}
            </p>
          )
          : null}
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            disabled={place === undefined || format === undefined}
            data-register-submit=""
          >
            {t("documents.button.register")}
          </Button>
        </div>
      </form>
    </FormFrame>
  );
}

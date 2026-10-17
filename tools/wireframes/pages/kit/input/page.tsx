// Kit · input. @lophn/ui/input의 component와 예제(control-sizes, orders-filters).
import { useContext } from "react";
import {
  Checkbox,
  Field,
  FieldContext,
  Input,
  Select,
  Switch,
  Textarea,
} from "@lophn/ui/input";

import { ControlSizes } from "./control-sizes.tsx";
import { OrdersFilters } from "./orders-filters.tsx";
import { Example, kit, Page, Section } from "../kit.tsx";

const EXAMPLE_NOW = new Date("2026-10-06T15:30:00Z");

// Field가 넘기는 id·오류 상태를 FieldContext로 읽어 보이는 최소 입력.
function ContextReader() {
  const field = useContext(FieldContext);
  if (field === null) return null;
  return (
    <>
      <input id={field.id} aria-invalid={field.invalid} />
      <span className={kit.mono}>invalid: {String(field.invalid)}</span>
    </>
  );
}

export function KitInput() {
  const options = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly", disabled: true },
  ];
  return (
    <Page>
      <div className={kit.colTwo}>
        <Section title="Input">
          <div className={kit.column}>
            <div className={kit.field}>
              <Field label="Project name" help="Letters, numbers and dashes.">
                <Input placeholder="phroner" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Project name" error="That name is already used.">
                <Input defaultValue="phroner" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Disabled">
                <Input defaultValue="Read only" disabled />
              </Field>
            </div>
            {(["sm", "md", "lg"] as const).map((size) => (
              <div key={size} className={kit.field}>
                <Field label={`Size ${size}`}>
                  <Input size={size} defaultValue={size} />
                </Field>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Textarea and Select">
          <div className={kit.column}>
            <div className={kit.field}>
              <Field label="Purpose" help="One or two sentences.">
                <Textarea
                  rows={3}
                  defaultValue="Keep the monthly food spending under the plan."
                />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Purpose" error="Write at least one sentence.">
                <Textarea rows={2} />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Notes">
                <Textarea rows={2} defaultValue="Locked." disabled />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Repeat">
                <Select options={options} defaultValue="weekly" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Repeat" error="Pick how often.">
                <Select options={options} placeholder="Choose" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Disabled select">
                <Select options={options} defaultValue="daily" disabled />
              </Field>
            </div>
          </div>
        </Section>
      </div>
      <Section title="Checkbox and Switch">
        <div className={kit.colTwo}>
          <div className={kit.column}>
            <Checkbox label="Track Markdown files" defaultChecked />
            <Checkbox label="Use .gitignore" />
            <Checkbox label="Disabled, checked" defaultChecked disabled />
            <Checkbox label="Disabled" disabled />
          </div>
          <div className={kit.column}>
            <Switch label="Show line numbers" defaultChecked />
            <Switch label="Wrap long lines" />
            <Switch label="Disabled, on" defaultChecked disabled />
            <Switch label="Disabled" disabled />
          </div>
        </div>
      </Section>
      <Section
        title="FieldContext"
        note="Field가 자식에게 id와 오류 상태를 넘긴다. 새 입력 control이 이 context를 읽는다."
      >
        <div className={kit.colTwo}>
          <Field label="Context, valid" help="id를 label과 잇는다.">
            <ContextReader />
          </Field>
          <Field label="Context, invalid" error="invalid가 true가 된다.">
            <ContextReader />
          </Field>
        </div>
      </Section>
      <Section
        title="control-sizes"
        note="sm·md·lg 높이의 Button·Input·Select를 같은 줄에 맞춘다."
      >
        <Example>
          <div className={kit.panel}>
            <ControlSizes />
          </div>
        </Example>
      </Section>
      <Section
        title="orders-filters"
        note="기간·상태·검색으로 read command의 입력을 만든다."
      >
        <Example>
          <div className={kit.panel}>
            <OrdersFilters
              now={EXAMPLE_NOW}
              call={() => Promise.resolve()}
            />
          </div>
        </Example>
      </Section>
    </Page>
  );
}

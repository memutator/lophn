// Kit · app-ui. @lophn/app-ui 예제(order-actions). 앱 bridge가 없어 눌러도 실패 문구가 나온다.
import { OrderActions } from "./order-actions.tsx";
import { Example, kit, Page, Section } from "../kit.tsx";

export function KitAppUi() {
  return (
    <Page>
      <Section
        title="order-actions"
        note="blueprint command를 버튼으로 두고 누르면 확인 없이 바로 호출한다."
      >
        <Example>
          <div className={kit.panel}>
            <OrderActions selected={() => ["ord_1"]} />
          </div>
        </Example>
      </Section>
    </Page>
  );
}

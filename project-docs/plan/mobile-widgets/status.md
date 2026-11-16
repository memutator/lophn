# 상태

lead만 고친다. `tools/status.py mobile-widgets build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mobile-phone-link-contract` | phone-link | 1 | 없음 | merged | phone-link/mobile-phone-link-contract | 67830a85c |  |
| `mobile-widget-wireframes` | widget-design | 1 | 없음 | merged | widget-design/mobile-widget-wireframes | 41d072928 |  |
| `mobile-widget-spike` | widget-spike | 1 | 없음 | merged | spike/widgets | 70b29dafb |  |
| `mobile-widget-contract` | widgets | 1 | 없음 | merged | widgets/mobile-widget-contract | e8a53a8a2 |  |
| `mobile-cap-phone` | phone-use | 2 | mobile-phone-link-contract | merged | phone-use/mobile-cap-phone | be7c592cf |  |
| `mobile-widgets-decl` | widgets | 2 | 없음 | merged | widgets/mobile-widgets-decl | 21b5553ac |  |
| `mobile-open-target` | open-target | 3 | 없음 | merged | open-target/mobile-open-target | 4564cf5e6 |  |
| `mobile-widget-core` | widgets | 3 | mobile-widget-contract, mobile-widgets-decl | merged | widgets/mobile-widget-core | b2df3e21c |  |
| `mobile-widget-store` | widgets | 4 | mobile-widget-core, mobile-open-target, mobile-widget-spike | merged | widgets/mobile-widget-store | 2bad892dc |  |
| `mobile-widget-native` | widgets | 5 | mobile-widget-store, mobile-widget-spike, mobile-widget-wireframes | merged | widgets/mobile-widget-native | f51a4ad8d |  |
| `mobile-widget-screens` | widgets | 6 | mobile-widget-native, mobile-widget-wireframes, mobile-open-target | running | widgets/mobile-widget-screens |  |  |
| `mobile-shortcut-native` | shortcuts | 7 | mobile-widget-screens, mobile-open-target, mobile-widget-spike, mobile-widget-wireframes | todo |  |  |  |
| `mobile-phone-link` | phone-link | 8 | mobile-phone-link-contract | merged | phone-link/mobile-phone-link | 512b34f40 |  |
| `mobile-phone-use-grant` | phone-use | 9 | mobile-phone-link, mobile-widgets-decl, mobile-phone-link-contract, mobile-cap-phone | merged | phone-use/mobile-phone-use-grant | 77649030b |  |
| `mobile-phone-location` | phone-link | 10 | mobile-phone-link, mobile-phone-use-grant | merged | phone-link/mobile-phone-location | 8b34716d6 |  |
| `mobile-widgets-guidance` | widgets | 10 | mobile-widget-core, mobile-widgets-decl, mobile-cap-phone, mobile-phone-use-grant, mobile-widget-native | merged | widgets/mobile-widgets-guidance | 0d4bf72c1 |  |

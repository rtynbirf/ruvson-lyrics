# KNOWN ISSUES · ruvson-lyrics — известные красные и шрамы
> Снимок Волны ×5-A (2026-11-09). Живые красные прогоны + известные квирки.

| Что | Статус | Детали | Run/ссылка |
|---|---|---|---|
| ci 19:59 (c3c5559) | 🟢 вылечено | startup_failure: двоеточие в plain-имени шага П51 ломало парсер Actions (0 jobs); фикс efc6c11 — имя в кавычках | [42517742095](https://github.com/rtynbirf/ruvson-lyrics/actions/runs/42517742095) |
| CI на efc6c11 (push 20:07) | ✅ зелёный живой | YAML-пломба подтверждена прогоном | [42518462665](https://github.com/rtynbirf/ruvson-lyrics/actions/runs/42518462665) |
| Pages 16:33 / 16:36 / 16:42 | 🟜 честный хвост | приватная репа + план free: Pages недоступен (гард FACT-exit; issue #7). НЕ флейк, ретраи вслепую запрещены | [42500458274](https://github.com/rtynbirf/ruvson-lyrics/actions/runs/42500458274) · [42500791962](https://github.com/rtynbirf/ruvson-lyrics/actions/runs/42500791962) · [42501230408](https://github.com/rtynbirf/ruvson-lyrics/actions/runs/42501230408) |
| Pages 21:31 | 🟜 честный хвост | та же стража на HEAD efc6c11; GET /pages=404 (API-факт 09.11) | [42525608333](https://github.com/rtynbirf/ruvson-lyrics/actions/runs/42525608333) |
| yml-мусор `branches: ain]` в ci.yml | 🟢 вылечено ×5-A | последний живой экземпляр класса КОСЯКА ×4: пуш-фильтр не имел смысла; исправлено на `[ main ]` | .github/workflows/ci.yml |
| ⬜ квота Artifact storage аккаунта | 🟜 честный хвост | нужен хозяин/billing; влияет на Pages-деплой и любые upload-artifact | см. KNOWN_ISSUES H-PE11-PHOENIX |
| Квирк: репо 526 МБ | ℹ️ по дизайну | полные клоны тяжёлые; filter-repo только по протоколу П-24 и прямой команде хозяина | polimat-hub#42 |

# MANIFEST: RUVSON_QUANTUM_v5 — части вынесены в саркофаг (вне git)

Дата: 2026-11-08

## Что здесь было

5 частей архива `RUVSON_QUANTUM_v5.part1of5 … part5of5` (каждая ровно 85.2 MiB /
89 342 035–89 342 039 bytes, суммарно 426 MB). Хранились в git **дважды**:

1. Блобы в истории `main` этого репозитория (потеря места).
2. Ассеты релиза `media-vault` + зашифрованная копия `r1a002.enc` в релизе
   `import/ruvson-lyrics` репозитория `release-vault` (саркофаг).

## Пломбы (git-sha1 блобов, сверены 2026-11-08 до переписывания истории)

| файл | размер | git-sha1 (пломба) | где живёт |
|---|---|---|---|
| `RUVSON_QUANTUM_v5.part1of5` | 85.2 MB | `cda1c72e2225f9394c063cda98b1ab72998abbd7` | релиз `media-vault` этого репо (ассет id 721891572) + `release-vault` import/ruvson-lyrics `r1a002.enc` (зашифрованная копия) |
| `RUVSON_QUANTUM_v5.part2of5` | 85.2 MB | `6e4a0a6b15637b5965e8d0f0edfb5dcd006a07d7` | релиз `media-vault` этого репо (ассет id 721893092) + `release-vault` import/ruvson-lyrics `r1a002.enc` (зашифрованная копия) |
| `RUVSON_QUANTUM_v5.part3of5` | 85.2 MB | `c0e480f515eee0573b4b07af1a23b97eb85c6f63` | релиз `media-vault` этого репо (ассет id 721893943) + `release-vault` import/ruvson-lyrics `r1a002.enc` (зашифрованная копия) |
| `RUVSON_QUANTUM_v5.part4of5` | 85.2 MB | `c5e9839aadd2618ba00ec1eb66161c1c096367d3` | релиз `media-vault` этого репо (ассет id 721894760) + `release-vault` import/ruvson-lyrics `r1a002.enc` (зашифрованная копия) |
| `RUVSON_QUANTUM_v5.part5of5` | 85.2 MB | `11da60f5b8f12890e4b8220b3f5bb14a5f088775` | релиз `media-vault` этого репо (ассет id 721895518) + `release-vault` import/ruvson-lyrics `r1a002.enc` (зашифрованная копия) |

## Верификация саркофага перед удалением из git (2026-11-08)

Все 5 ассетов релиза `media-vault` скачаны через API
(`Accept: application/octet-stream`), для каждого вычислен `git hash-object`:

- 5/5 hash-object **совпал** с пломбой из body релиза и с sha блоба в истории main;
- 5/5 размеры **совпали байтово**: локальный файл = ассет API = git-блоб.

## Причина удаления из git

Правило дома №4: репозиторий ≤ 500 MB (было 514 MB). Двойное хранение убрано:
данные остаются в саркофаге (релиз `media-vault` + `release-vault` `r1a002.enc`),
из git-истории блобы >50 MB будут вычищены `git filter-repo
--strip-blobs-bigger-than 50M` сразу после этого коммита.

## Примечание про v4 (2026-11-08, агент B-2)

Кроме 5 частей v5, в истории git лежали 3 части `RUVSON_QUANTUM_v4.part{1,2,3}of3`
(~73.1 MB каждая, тоже >50 MB) — их из истории вычищает та же команда
`git filter-repo --strip-blobs-bigger-than 50M`. Их саркофаг: `release-vault`,
релиз `import/ruvson-lyrics`, ассет `r1a001.enc` (219 400 112 bytes = сумма
3 частей v4). Части v5 там же — `r1a002.enc` (446 710 208 bytes).

Сборка архива: см. `SHA256SUMS` и `assemble_v5.py` рядом.

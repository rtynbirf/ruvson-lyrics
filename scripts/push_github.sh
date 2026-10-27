#!/bin/bash
# Синк проекта в приватный репозиторий GitHub (rtynbirf/ruvson-lyrics)
cd "$(dirname "$0")/.." || exit 1
git add -A
git commit -m "sync: $(date '+%Y-%m-%d %H:%M')" || echo "нечего коммитить"
git push origin main

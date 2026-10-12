#!/usr/bin/env bash
# Database dump + uploaded files, keeps the newest 14 of each.
# Daily at 03:30 (crontab -e):  30 3 * * * /opt/pado/deploy/vps/backup.sh >> /var/log/pado-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.prod.yml"
DIR="${BACKUP_DIR:-$PWD/backups}"
KEEP="${BACKUP_KEEP:-14}"
TS="$(date +%Y%m%d-%H%M)"
mkdir -p "$DIR"

$COMPOSE exec -T postgres pg_dump -U pado -Fc pado > "$DIR/db-$TS.dump"
$COMPOSE run --rm --no-deps --user root -v "$DIR":/backup --entrypoint sh api -c "tar czf /backup/uploads-$TS.tgz -C /app uploads"

for kind in db uploads; do
  ls -1t "$DIR"/$kind-* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
done
echo "backup $TS done: $(du -sh "$DIR" | cut -f1) in $DIR"

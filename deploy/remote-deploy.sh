#!/usr/bin/env bash
# Runs on the deploy host (fed over SSH by deploy.sh):  remote-deploy.sh <commit-sha>
set -euo pipefail

SHA="$1"
ROOT=/opt/meds
REPO=https://github.com/Birditch/meds.git
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "$ROOT/.env is missing (see docs/deploy.md)" >&2
  exit 1
fi
if [[ ! -d src/.git ]]; then
  git clone --quiet "$REPO" src
fi
git -C src fetch --quiet origin
git -C src checkout --quiet --detach "$SHA"

echo "Building meds:sha-$SHA"
docker build --quiet --build-arg COMMIT="$SHA" -t "meds:sha-$SHA" src >/dev/null
install -m 0644 src/deploy/compose.yaml compose.yaml

previous_tag=""
if previous_image="$(docker inspect --format '{{.Config.Image}}' meds-web 2>/dev/null)"; then
  previous_tag="${previous_image##*:}"
fi

if MEDS_IMAGE_TAG="sha-$SHA" docker compose up -d --wait --wait-timeout 90; then
  docker tag "meds:sha-$SHA" meds:current
  echo "$SHA $(date -u +%FT%TZ)" >> deployments.log
  echo "Healthy: meds:sha-$SHA is now meds:current"
  exit 0
fi

echo "Health check failed; recent logs:" >&2
docker logs --tail 50 meds-web >&2 || true
if [[ -n "$previous_tag" ]]; then
  echo "Restarting previous image meds:$previous_tag" >&2
  MEDS_IMAGE_TAG="$previous_tag" docker compose up -d --wait --wait-timeout 90 || true
fi
exit 1

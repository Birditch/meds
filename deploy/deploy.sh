#!/usr/bin/env bash
# Deploy a pushed commit:  deploy/deploy.sh [git-ref]   (default: HEAD)
#
# On the host (SSH alias "server"; override with MEDS_SSH_HOST) this checks the commit out in
# /opt/meds/src, builds meds:sha-<commit>, replaces the container, waits for the health check,
# and only then tags the image meds:current. A failed health check restarts the previous image.
set -euo pipefail

HOST="${MEDS_SSH_HOST:-server}"
REF="${1:-HEAD}"
cd "$(dirname "$0")/.."

SHA="$(git rev-parse --verify "${REF}^{commit}")"
if [[ "$REF" == "HEAD" ]] && ! git diff --quiet HEAD --; then
  echo "Working tree has uncommitted changes; commit and push first." >&2
  exit 1
fi
if ! git branch -r --contains "$SHA" | grep -q 'origin/'; then
  echo "Commit $SHA is not on origin; push it first." >&2
  exit 1
fi

echo "Deploying $SHA to $HOST"
ssh "$HOST" bash -s -- "$SHA" < "deploy/remote-deploy.sh"

#!/usr/bin/env bash
#
# Release bookkeeping for the SHA-tagged app images (capbase-{api,web,jobs}).
#
#   release-images.sh promote <tag>   point :latest at <tag>, record it, prune old tags
#   release-images.sh check <tag>     exit non-zero unless all three images exist at <tag>
#   release-images.sh list            show the releases still on disk, newest first
#
# `make deploy-all` builds <git-sha> tags and promotes them; `make deploy-rollback
# SHA=…` re-runs the containers on an older tag and promotes that. :latest is
# always "what is deployed", which is what the seed/rotate-admin one-shots use.
set -euo pipefail

IMAGES=(capbase-api capbase-web capbase-jobs)
KEEP="${RELEASES_KEEP:-5}"
STATE=infra/.release   # gitignored: current + previous tag, for humans
cd "$(dirname "$0")/.."

check() {
  local tag="$1" img missing=0
  for img in "${IMAGES[@]}"; do
    docker image inspect "$img:$tag" >/dev/null 2>&1 || { echo "❌ $img:$tag not found"; missing=1; }
  done
  return "$missing"
}

case "${1:-}" in
  promote)
    tag="${2:?tag required}"
    check "$tag"
    prev="$(sed -n 's/^current=//p' "$STATE" 2>/dev/null || true)"
    for img in "${IMAGES[@]}"; do docker tag "$img:$tag" "$img:latest"; done
    printf 'current=%s\nprevious=%s\ndeployed_at=%s\n' "$tag" "${prev:-}" "$(date -u +%FT%TZ)" > "$STATE"
    echo "==> Release $tag is live${prev:+ (previous: $prev — make deploy-rollback SHA=$prev)}"
    # Keep the newest $KEEP tags per image (plus whatever is live); untag the rest
    # so a VPS disk isn't eaten by every build since launch.
    for img in "${IMAGES[@]}"; do
      docker image ls "$img" --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r | cut -f2 \
        | grep -vxE "latest|<none>|$tag" | tail -n "+$KEEP" \
        | while read -r old; do docker image rm "$img:$old" >/dev/null && echo "    pruned $img:$old"; done
    done
    ;;
  check)
    check "${2:?tag required}"
    ;;
  list)
    [ -f "$STATE" ] && cat "$STATE" && echo
    docker image ls capbase-api --format 'table {{.Tag}}\t{{.CreatedAt}}\t{{.Size}}' | grep -v '<none>'
    ;;
  *)
    echo "usage: $0 promote <tag> | check <tag> | list"; exit 2 ;;
esac

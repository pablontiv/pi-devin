#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROGRAM=${0##*/}
readonly EXPECTED_REMOTES=$'mizorewww\norigin\nupstream'

die() {
  printf '%s: error: %s\n' "$PROGRAM" "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<EOF
Usage: $PROGRAM --bootstrap BEAD_ID
       $PROGRAM --normal BEAD_ID
EOF
  exit 2
}

[[ $# -eq 2 ]] || usage
mode=$1
bead_id=$2
case "$mode" in
  --bootstrap) mode=bootstrap ;;
  --normal) mode=normal ;;
  *) usage ;;
esac

command -v git >/dev/null 2>&1 || die "git is required"
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die "run this command from a Git worktree"
selected_root=$(pwd -P)
repo_root=$(cd "$repo_root" && pwd -P)
[[ "$selected_root" == "$repo_root" ]] || die "run this command from the selected task worktree root"

selected_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || die "the selected task worktree must be on a branch"
case "$selected_branch" in
  main|local/integration) die "select a dedicated task worktree, not $selected_branch" ;;
esac
[[ -z $(git status --porcelain --untracked-files=all) ]] || die "the selected task worktree must be clean"

actual_remotes=$(git remote | LC_ALL=C sort)
[[ "$actual_remotes" == "$EXPECTED_REMOTES" ]] || die "expected exactly the remotes origin, upstream, and mizorewww"

declare -A expected_urls=(
  [origin]="https://github.com/pablontiv/pi-devin.git"
  [upstream]="https://github.com/kashyab12/pi-devin.git"
  [mizorewww]="https://github.com/mizorewww/pi-devin.git"
)
for remote in origin upstream mizorewww; do
  mapfile -t configured_urls < <(git config --local --get-all "remote.$remote.url" || true)
  [[ ${#configured_urls[@]} -eq 1 && "${configured_urls[0]}" == "${expected_urls[$remote]}" ]] ||
    die "$remote must be exactly ${expected_urls[$remote]}"

  mapfile -t push_urls < <(git config --local --get-all "remote.$remote.pushurl" || true)
  if ((${#push_urls[@]} > 0)); then
    [[ ${#push_urls[@]} -eq 1 && "${push_urls[0]}" == "${expected_urls[$remote]}" ]] ||
      die "$remote push URL must be exactly ${expected_urls[$remote]}"
  fi
done

find_worktree_for_branch() {
  local wanted=$1
  git worktree list --porcelain | awk -v wanted="branch refs/heads/$wanted" '
    /^worktree / { path = substr($0, 10) }
    $0 == wanted { print path; found = 1 }
    END { if (!found) exit 1 }
  '
}

if [[ "$mode" == bootstrap ]]; then
  case "$bead_id" in
    pi-devin-1s2|pi-devin-3l6|pi-devin-ppk) ;;
    *) die "Bead $bead_id is not authorized for bootstrap mode" ;;
  esac
  git show-ref --verify --quiet refs/heads/local/integration &&
    die "bootstrap requires local/integration to be absent"
  command -v bd >/dev/null 2>&1 || die "bd is required to verify pi-devin-ppk"
  command -v node >/dev/null 2>&1 || die "node is required to verify pi-devin-ppk"
  ppk_json=$(bd show pi-devin-ppk --json) || die "could not read pi-devin-ppk"
  if ! printf '%s' "$ppk_json" | node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(0, "utf8"));
    const issue = Array.isArray(value) ? value.find((item) => item.id === "pi-devin-ppk") : value;
    process.exit(issue?.id === "pi-devin-ppk" && issue?.status === "open" ? 0 : 1);
  '; then
    die "bootstrap is allowed only while pi-devin-ppk is open"
  fi
fi

for remote in origin upstream mizorewww; do
  printf 'preflight: fetching %s heads\n' "$remote"
  git fetch --atomic --prune --no-tags "$remote" "+refs/heads/*:refs/remotes/$remote/*" ||
    die "failed to fetch $remote heads"
done

upstream_tag_listing=$(git ls-remote --tags --refs upstream) || die "failed to list upstream tags"
origin_tag_listing=$(git ls-remote --tags --refs origin) || die "failed to list origin tags"
declare -A upstream_tags=()
while IFS=$'\t' read -r oid tag_ref; do
  [[ -n "$oid" ]] || continue
  upstream_tags["${tag_ref#refs/tags/}"]=$oid
done <<< "$upstream_tag_listing"
while IFS=$'\t' read -r oid tag_ref; do
  [[ -n "$oid" ]] || continue
  tag_name=${tag_ref#refs/tags/}
  if [[ -n ${upstream_tags[$tag_name]+present} && "${upstream_tags[$tag_name]}" != "$oid" ]]; then
    die "origin/upstream tag collision: $tag_name differs (${oid} != ${upstream_tags[$tag_name]})"
  fi
done <<< "$origin_tag_listing"

printf 'preflight: fetching canonical upstream tags\n'
git fetch --atomic --no-tags --no-prune --no-prune-tags upstream \
  "refs/tags/*:refs/tags/*" || die "canonical upstream tag fetch was rejected; no tag was forced"
printf 'preflight: fetching namespaced mizorewww tags\n'
git fetch --atomic --no-tags --no-prune --no-prune-tags mizorewww \
  "refs/tags/*:refs/tags/mizorewww/*" || die "mizorewww tag fetch was rejected; no tag was forced"

if [[ "$mode" == bootstrap ]]; then
  printf 'preflight: bootstrap verification complete for %s; main and local/integration were not changed\n' "$bead_id"
  exit 0
fi

primary_worktree=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
[[ -n "$primary_worktree" ]] || die "primary worktree is missing"
primary_branch=$(git -C "$primary_worktree" symbolic-ref --quiet HEAD 2>/dev/null || true)
[[ "$primary_branch" == refs/heads/main ]] || die "the primary worktree must be checked out on main"
integration_worktree=$(find_worktree_for_branch local/integration 2>/dev/null || true)
[[ -n "$integration_worktree" ]] || die "the local/integration worktree is missing"
[[ "$repo_root" != "$primary_worktree" && "$repo_root" != "$integration_worktree" ]] ||
  die "normal mode must run from a dedicated task worktree"
[[ -z $(git -C "$primary_worktree" status --porcelain --untracked-files=all) ]] ||
  die "the primary main worktree must be clean"
[[ -z $(git -C "$integration_worktree" status --porcelain --untracked-files=all) ]] ||
  die "the local/integration worktree must be clean"
git show-ref --verify --quiet refs/remotes/upstream/main || die "upstream/main is missing after fetch"

main_before=$(git rev-parse refs/heads/main)
integration_before=$(git rev-parse refs/heads/local/integration)
printf 'preflight: main before: %s\n' "$main_before"
printf 'preflight: integration before: %s\n' "$integration_before"

git merge-base --is-ancestor refs/heads/main refs/remotes/upstream/main ||
  die "primary main cannot fast-forward to upstream/main"
git -C "$primary_worktree" merge --ff-only refs/remotes/upstream/main ||
  die "primary main fast-forward failed"
main_after=$(git rev-parse refs/heads/main)
printf 'preflight: main after: %s\n' "$main_after"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
counter=0
while :; do
  recovery_ref="refs/recovery/contribution-preflight/${stamp}-$$-${counter}"
  if git update-ref "$recovery_ref" "$integration_before" "" 2>/dev/null; then
    break
  fi
  ((counter += 1))
done
printf 'preflight: recovery ref: %s -> %s\n' "$recovery_ref" "$integration_before"

if ! git -C "$integration_worktree" rebase refs/remotes/upstream/main; then
  integration_after=$(git -C "$integration_worktree" rev-parse HEAD)
  printf 'preflight: integration after: %s\n' "$integration_after"
  die "integration rebase failed; conflict/rebase state and recovery ref are preserved"
fi
integration_after=$(git rev-parse refs/heads/local/integration)
printf 'preflight: integration after: %s\n' "$integration_after"

printf 'preflight: running npm test in local/integration\n'
if ! (cd "$integration_worktree" && npm test); then
  die "npm test validation failed; recovery ref is preserved"
fi
printf 'preflight: running npm run typecheck in local/integration\n'
if ! (cd "$integration_worktree" && npm run typecheck); then
  die "npm run typecheck validation failed; recovery ref is preserved"
fi
printf 'preflight: normal verification complete for %s\n' "$bead_id"

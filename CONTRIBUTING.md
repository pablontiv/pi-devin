# Contributing to pi-devin

This repository carries a downstream integration package while contributing suitable fixes and features back to the canonical project. Follow this contract before changing code or preparing any GitHub action.

## Repository vocabulary

The remote names are fixed:

| Remote | Repository | Role |
| --- | --- | --- |
| `origin` | `pablontiv/pi-devin` | Writable fork. Task branches may be pushed here only after human approval for the exact push. |
| `upstream` | `kashyab12/pi-devin` | Canonical read-only repository and pull request target. Never push directly to `upstream` or otherwise write to it. |
| `mizorewww` | `mizorewww/pi-devin` | Read-only, provenance-only source for historical downstream work; never a delivery target. |

Fetches from all three remotes are allowed when the task permits network access. A writable remote designation does not itself authorize a push.

## Isolate the work

Keep `local/integration` local-only as the source installed in Pi. `local/integration` must never be a pull request head. Create each upstream contribution in a clean, dedicated worktree based on `upstream/main`. After all gates pass, the PR head is a dedicated task branch pushed to `origin`, not the integration branch.

Use test-driven development for behavior changes, keep changes focused, and use Conventional Commits with any task-required trailers. Do not alter package behavior unless the task calls for it.

## Run the contribution preflight

Invoke the script from the root of the clean, dedicated task worktree and provide the selected Bead ID:

```sh
scripts/contribution-preflight.sh --normal pi-devin-xyz
```

Normal mode verifies that the configured remotes are exactly `origin=pablontiv/pi-devin`, `upstream=kashyab12/pi-devin`, and `mizorewww=mizorewww/pi-devin`. It fetches remote heads without tags, installs canonical upstream tags under `refs/tags/*`, installs historical mizorewww tags under `refs/tags/mizorewww/*`, and rejects a same-name origin/upstream tag with different object IDs. It then fast-forwards the primary `main`, creates a unique `refs/recovery/contribution-preflight/*` ref, rebases the existing `local/integration` worktree onto `upstream/main`, and runs `npm test` plus `npm run typecheck`. It reports the before/after SHAs and leaves rebase state and the recovery ref intact if a conflict occurs. It never pushes, rewrites a tag, prunes the mizorewww tag namespace, or creates `local/integration`.

The temporary bootstrap form is:

```sh
scripts/contribution-preflight.sh --bootstrap pi-devin-1s2
```

Bootstrap mode stops after remote and tag verification and does not change `main` or `local/integration`. It fails unless the selected ID is `pi-devin-1s2`, `pi-devin-3l6`, or `pi-devin-ppk`, `pi-devin-ppk` is open, and `local/integration` is absent. Normal mode fails closed when the integration worktree is missing. Do not work around any preflight failure with a reset, rebase abort, forced fetch, or push.

## Issue and pull request requirement

Every upstreamable feature or bug must have its own upstream issue and a focused pull request to `kashyab12/pi-devin`. The pull request must link that issue and must not include unrelated changes. An existing issue may be used only when it actually covers the contribution.

Changes already present upstream and package-name, release-only, or translation-only downstream changes are not resubmitted. Keep those changes in the downstream integration history instead of opening duplicate upstream work.

## Attribution and provenance

History from `mizorewww/pi-devin` remains attributable:

- Literal work must preserve the original author and identify the source repository and commit.
- Adapted work must identify the original author and record `Based-on` repository and commit provenance.

Do not replace source attribution with the integrator's identity. Keep commit hashes, repository URLs, and author facts exact.

## Human gates for external effects

Operate read-only until the task contract permits the action and a human approves the exact payload and action. Human approval is required before:

- posting an issue or an issue/PR comment;
- opening or updating a pull request;
- merging, publishing, pushing any remote, or force-pushing; or
- performing any other external effect.

Approval for one action does not authorize another. Human approval can authorize a push to `origin`, but it cannot override the rule to never push directly to `upstream`.

## Humanizer requirement

Every issue or PR title, body, and comment must pass Humanizer v3.0.0 in embedded mode, using the installed source at `/Users/pones/.pi/agent/skills/humanizer/SKILL.md`, before approval or posting. Humanization must preserve all facts, identifiers, code, commands, paths, links, attribution, and uncertainty.

Humanizer never authorizes posting. After it passes, obtain the separate human approval required for the exact external action. Do not draft or post GitHub text when the active task excludes that work.

## Validation

Run the checks required by the task, including the focused governance contract tests when governance changes. The default repository checks are:

```sh
npm test
npm run typecheck
git diff --check
```

Stop on conflicts, remote mismatches, failing checks, or uncertain state. Do not reset, force-push, or improvise around a failed gate.

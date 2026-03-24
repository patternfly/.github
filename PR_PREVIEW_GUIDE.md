# PR Preview Deployments

This guide explains how PatternFly extension repos deploy PR previews to surge.sh using shared workflows and actions from `patternfly/.github`.

## Overview

When a PR is opened by a team member, docs are automatically built and deployed to a surge.sh preview URL. A bot comments on the PR with the preview link. External contributors' PRs skip the preview by default, but a team member can trigger it by commenting `/deploy-preview`.

## Architecture

### Shared components (in `patternfly/.github`)

| Component | Path | Purpose |
|-----------|------|---------|
| Team membership check | `.github/workflows/check-team-membership.yml` | Reusable workflow that checks if the PR author (or commenter) is a member of a specified GitHub team before allowing jobs that use org secrets |
| Surge preview upload | `.github/actions/surge-preview/` | Composite action that publishes a folder to surge.sh and posts a PR comment with the preview link |

### Per-repo files

Each repo needs only one file: `.github/workflows/pr-preview.yml`

## How it works

1. A PR is opened or updated → `pull_request_target` fires
2. `check-team-membership.yml` checks if the PR author is in the `frequent-flyers` team
3. If allowed, the `deploy-preview` job runs: checks out the PR code, builds, and uploads to surge
4. The surge preview action posts a comment on the PR with the preview URL

For external contributors:
1. The preview is skipped (no runner consumed)
2. A team member reviews the PR code
3. The team member comments `/deploy-preview` on the PR
4. The `issue_comment` trigger fires, team membership is verified, and the preview deploys

## Preview URLs

Previews are published to: `{repo}-pr-{repo}-{PR#}.surge.sh`

For example, PR #42 on `react-console` → `react-console-pr-react-console-42.surge.sh`

## Required secrets

These must be available as org-level secrets (or per-repo):

| Secret | Purpose |
|--------|---------|
| `SURGE_LOGIN` | Email for the surge.sh account |
| `SURGE_TOKEN` | Auth token for surge.sh |
| `GH_PR_TOKEN` | PAT for the `patternfly-build` bot, used to post PR comments |
| `GH_READ_ORG_TOKEN` | PAT with `read:org` scope, used to check team membership |

## Setting up a new repo

### 1. Create `.github/workflows/pr-preview.yml`

#### Yarn repos

```yaml
name: pr-preview
on:
  pull_request_target:
  issue_comment:
    types: [created]

jobs:
  check-permissions:
    uses: patternfly/.github/.github/workflows/check-team-membership.yml@main
    secrets: inherit

  deploy-preview:
    runs-on: ubuntu-latest
    needs: check-permissions
    if: needs.check-permissions.outputs.allowed == 'true'
    env:
      SURGE_LOGIN: ${{ secrets.SURGE_LOGIN }}
      SURGE_TOKEN: ${{ secrets.SURGE_TOKEN }}
      GH_PR_TOKEN: ${{ secrets.GH_PR_TOKEN }}
      GH_PR_NUM: ${{ needs.check-permissions.outputs.pr-number }}
    steps:
      - uses: actions/checkout@v4
      - run: |
          git fetch origin pull/$GH_PR_NUM/head:tmp
          git checkout tmp
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: corepack enable
      - uses: actions/cache@v4
        id: yarn-cache
        name: Cache yarn deps
        with:
          path: |
            node_modules
            **/node_modules
          key: ${{ runner.os }}-yarn-${{ hashFiles('yarn.lock') }}
      - run: yarn install --immutable
        if: steps.yarn-cache.outputs.cache-hit != 'true'
      - run: yarn build
        name: Build
      - run: yarn build:docs
        name: Build docs
      - name: Upload docs
        uses: patternfly/.github/.github/actions/surge-preview@main
        with:
          folder: packages/module/public
```

#### npm repos

```yaml
name: pr-preview
on:
  pull_request_target:
  issue_comment:
    types: [created]

jobs:
  check-permissions:
    uses: patternfly/.github/.github/workflows/check-team-membership.yml@main
    secrets: inherit

  deploy-preview:
    runs-on: ubuntu-latest
    needs: check-permissions
    if: needs.check-permissions.outputs.allowed == 'true'
    env:
      SURGE_LOGIN: ${{ secrets.SURGE_LOGIN }}
      SURGE_TOKEN: ${{ secrets.SURGE_TOKEN }}
      GH_PR_TOKEN: ${{ secrets.GH_PR_TOKEN }}
      GH_PR_NUM: ${{ needs.check-permissions.outputs.pr-number }}
    steps:
      - uses: actions/checkout@v4
      - run: |
          git fetch origin pull/$GH_PR_NUM/head:tmp
          git checkout tmp
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/cache@v4
        id: npm-cache
        name: Cache npm deps
        with:
          path: '**/node_modules'
          key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
      - run: npm ci --legacy-peer-deps
        if: steps.npm-cache.outputs.cache-hit != 'true'
      - run: npm run build
        name: Build
      - run: npm run build:docs
        name: Build docs
      - name: Upload docs
        uses: patternfly/.github/.github/actions/surge-preview@main
        with:
          folder: packages/module/public
```

### 2. Verify secrets are available

If your repo uses org-level secrets, no action needed. If not, add `SURGE_LOGIN`, `SURGE_TOKEN`, `GH_PR_TOKEN`, and `GH_READ_ORG_TOKEN` to the repo's secrets.

### 3. Branch protection (recommended)

In **Settings > Branches > Branch protection rules** for `main`:
- Require the `check-pr` status checks (lint, test, a11y) to pass before merge
- Do NOT require the `pr-preview` checks — previews are optional and would block external contributor PRs

## Security

### What's protected

- **Team-gated access**: Only members of the `frequent-flyers` team can trigger preview deployments. External PRs are skipped unless a team member explicitly comments `/deploy-preview`.
- **Input sanitization**: Branch names, repo names, and upload paths are validated to prevent injection attacks.
- **No shell interpolation of secrets**: All user-controlled values and secrets flow through environment variables, preventing script injection.
- **Runner efficiency**: The `issue_comment` trigger is filtered at the job level so runners aren't allocated for unrelated comments.

## Shared component reference

### `check-team-membership.yml`

Inputs:
| Input | Default | Description |
|-------|---------|-------------|
| `team` | `frequent-flyers` | GitHub team slug to check membership against |
| `organization` | `patternfly` | GitHub organization |

Outputs:
| Output | Description |
|--------|-------------|
| `allowed` | `'true'` if the actor is a team member |
| `pr-number` | The PR number (works for both `pull_request_target` and `issue_comment`) |

### `surge-preview` action

Inputs:
| Input | Required | Description |
|-------|----------|-------------|
| `folder` | Yes | Path to the folder to publish (e.g. `packages/module/public`) |

Required env vars (set at the job level):
| Env var | Description |
|---------|-------------|
| `SURGE_LOGIN` | Surge account email |
| `SURGE_TOKEN` | Surge auth token |
| `GH_PR_TOKEN` | PAT for posting PR comments |
| `GH_PR_NUM` | PR number |

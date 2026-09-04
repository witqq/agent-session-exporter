# Release process

A release binds one locally accepted npm tarball to one annotated Git tag, one GitHub Release asset and one npm version. GitHub Actions verifies and publishes those exact bytes through OpenID Connect (OIDC) without checking out source, installing dependencies or rebuilding the package.

## Runtime and trusted publisher

Use Node.js 24.20.0 and npm 11.19.0 or newer. `.nvmrc`, `.node-version`, `engines` and GitHub Actions use the same Node release.

The npm trusted publisher for `agent-session-exporter` must use:

- organization or user: `witqq`;
- repository: `agent-session-exporter`;
- workflow filename: `publish-npm.yml`;
- environment: empty;
- allowed action: `npm publish`.

Do not add an `NPM_TOKEN` GitHub secret. The publication job runs on a GitHub-hosted runner with `id-token: write`.

## Prepare one candidate

Update `package.json`, `skills/restore-context/SKILL.md` and this runbook to the new version, then run from a clean feature branch:

```sh
npm ci --no-audit --no-fund
npm run verify
git status --short
```

The gate runs the runtime tests, parses and validates both workflows, creates exactly one npm tarball, compares npm and tar inventories, scans every packaged file for credential-shaped data and private paths, checks metadata and executable mode, installs the exact tarball into an isolated prefix, and runs the installed CLI version and help contracts. It also requires the packaged `restore-context` skill metadata and every pinned command to match the package version.

The accepted record is `test-results/package/candidate-evidence.json`. Require `sourceDirty` to be `false` and retain its tarball path and SHA-256. Do not change repository bytes after accepting it. A merge commit may reuse the candidate only when the merge tree is byte-identical to the reviewed head.

Validate the skill separately:

```sh
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" skills/restore-context
```

## Create the immutable release

After CI passes and the reviewed branch is merged into public `main`, create an annotated tag on that exact merge commit. The GitHub Release must be non-draft, non-prerelease and contain exactly the accepted `agent-session-exporter-VERSION.tgz` as its only asset. End the release notes with `[Made with Moira](https://moira-mcp.com/)`.

Tags and release assets are immutable. Never move a public tag or replace an asset.

## Publish and verify

Dispatch `.github/workflows/publish-npm.yml` from `main` with the tag and accepted SHA-256. The workflow requires the one expected Release asset, matches GitHub's stored digest, downloads it over verified HTTPS, recomputes SHA-256, checks package/version/repository/bin identity, and publishes the asset URL through OIDC.

The release is complete only when npm `latest` equals the released version, npm records provenance, the registry tarball SHA-256 matches the GitHub asset, and a new empty consumer can install and run the published `session-export --version` and `session-export --help` commands.

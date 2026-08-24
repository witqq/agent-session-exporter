# Release process

Releases are published to npm by `.github/workflows/publish-npm.yml` through npm Trusted Publishing. The
workflow uses short-lived OpenID Connect (OIDC) credentials and does not require a stored npm token.

## One-time npm configuration

Open the `agent-session-exporter` package settings on npm, add a GitHub Actions trusted publisher, and use
these exact values:

- organization or user: `witqq`;
- repository: `agent-session-exporter`;
- workflow filename: `publish-npm.yml`;
- environment: leave empty;
- allowed action: `npm publish`.

The package must retain public access. Do not add an `NPM_TOKEN` GitHub secret: the workflow authenticates
through OIDC.

## Publish a version

Update `package.json` on `main`, verify the release candidate, then create and push an annotated tag that
matches the package version exactly:

```bash
npm test
npm run pack:check
git tag -a v2.0.1 -m "agent-session-exporter 2.0.1"
git push origin v2.0.1
```

The workflow rejects malformed tags, a tag/version mismatch, or a tag whose commit is not contained in
`origin/main`. npm also rejects an already published version, so releases remain immutable.

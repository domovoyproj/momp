---
name: github-release
description: "Use when the user asks to prepare, create, publish, or update a GitHub release for omp-web, especially a versioned tag release. Generate the release body with the v0.1.7 format: commit-range preamble plus Added, Improved, and Internal sections."
---

# GitHub Release

Use this skill for releases of `ddallabenetta/omp-web`.

## Release-body contract

The release body follows the published [v0.1.7 template](https://github.com/ddallabenetta/omp-web/releases/tag/v0.1.7):

```markdown
Prepared from commits in `v<previous>..v<version>`.

### Added

- [<short-sha>] <user-visible capability, described from the commit>

### Improved

- [<short-sha>] <improvement or correction, described from the commit>

### Internal

- [<short-sha>] <CI, dependency, packaging, or maintenance change>
```

Rules:

- Keep the English-only structure above. Do not use the bilingual structure suggested elsewhere in the repository for this GitHub release format.
- Keep the preamble exactly as `Prepared from commits in \`v<previous>..v<version>\`.`.
- Use the actual previous release tag and release tag; never invent a range.
- Keep each commit's short hash in square brackets (`[abc1234]`). GitHub turns recognized hashes into commit links.
- Derive every bullet from the commit subject/body and, when necessary, its diff. Never describe an unverified change.
- Use only non-empty sections. Keep the template's section order: `Added`, `Improved`, `Internal`.
- Put bug fixes and user-facing refinements under `Improved` unless the user explicitly requests another heading. Do not add unrelated headings by habit.
- Mention the package bump in `Internal` when that commit is part of the release range, for example `Bumped the package to \`omp-web@<version>\`.`.
- Keep the prose concise, past-tense, and user-facing. Preserve relevant backticks around commands, package names, selectors, and configuration keys.
- Do not add an `Assets` section: GitHub supplies source archives and displays them separately.

## Workflow

### 1. Establish the release target

Read the repository state before changing anything:

```bash
git status --short --branch
git log --oneline --decorate -5
gh auth status
```

Use `package.json` as the canonical version source unless the user explicitly supplies a different version. The release tag is `v<package.json.version>`. Do not silently invent a new version or overwrite an existing release. Confirm that the tag, package version, and requested release target agree.

For a normal release, verify the working tree and branch are suitable for release. Do not include unrelated uncommitted changes. Follow `docs/release.md` for the repository's npm/tag/build prerequisites, but do not publish to npm unless the user asks for npm publication as well.

### 2. Identify the commit range

Find the previous release tag and inspect the complete range:

```bash
git tag --sort=-v:refname
git log --oneline --decorate v<previous>..v<version>
git log --format='%h%x09%s%n%b' v<previous>..v<version>
git diff --stat v<previous>..v<version>
```

Read the relevant diffs before writing notes. Group commits as follows:

- **Added** — new user-visible capabilities or endpoints.
- **Improved** — fixes, UX, performance, compatibility, branding, and behavior refinements.
- **Internal** — tests, CI, dependency maintenance, packaging, release automation, and version bumps.

A single commit may be represented by one bullet only. Collapse implementation-only commits into the user-visible change when the range contains both; keep the commit hash of the commit that best supports the statement.

### 3. Validate before publishing

For a code release, run the checks relevant to the requested scope. The repository uses Bun:

```bash
bun run typecheck
bun test
```

Run `bun run build` only as part of the actual production/package release flow; the repository explicitly forbids it during ordinary development. If the user asks for npm publication, follow the full build and publish procedure in `docs/release.md`.

Before creating the release, check whether the tag or GitHub release already exists:

```bash
git ls-remote --tags origin v<version>
gh release view v<version> --repo ddallabenetta/omp-web
```

Do not replace a published release unless the user explicitly asks to update its notes.

### 4. Create or update the GitHub release

Write the generated body to a temporary notes file outside the repository, review it against the contract above, then use the verified tag:

```bash
gh release create v<version> \
  --repo ddallabenetta/omp-web \
  --verify-tag \
  --title "v<version>" \
  --notes-file /tmp/omp-web-release-notes.md
```

Never use `--generate-notes`; it would bypass the required format. If the release already exists and the user explicitly requested a notes update:

```bash
gh release edit v<version> \
  --repo ddallabenetta/omp-web \
  --notes-file /tmp/omp-web-release-notes.md
```

If the tag does not exist, stop before `gh release create`: a release must point to the intended tagged commit. When the user asked for the complete tag-and-release flow, create and push the annotated tag only after version and commit checks pass, then use `--verify-tag`.

### 5. Verify the result

Confirm the published metadata and body, then check for unintended local changes:

```bash
gh release view v<version> \
  --repo ddallabenetta/omp-web \
  --json name,tagName,isDraft,isPrerelease,body,url
git status --short --branch
```

The final report must include the release URL, tag, previous-to-current commit range, the checks actually run, and any intentionally skipped step. Do not claim npm publication, tag pushes, or production builds unless their commands succeeded.

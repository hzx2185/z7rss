# Z7 RSS Agent Operating Rules

This project uses Docker Compose as the only normal runtime for development verification.

## Database Safety

- Treat `data/rss.db` as production-like data.
- Do not run `node src/server.js`, `npm start`, or any other host-side app server against `data/rss.db`.
- Do not start extra app processes on alternate host ports for verification.
- Do not delete, overwrite, restore, move, truncate, or vacuum `data/rss.db` unless the user explicitly approves the exact action.
- If the app must be verified after code changes, rebuild and restart the Compose service:
  - `docker compose build z7rss`
  - `docker compose up -d z7rss`
- If the container cannot start because `data/rss.db` is unhealthy, inspect logs and backups read-only, then ask the user before restoring from any backup.

## Why

SQLite is safe for a single owner process, but this project bind-mounts the database into Docker. Running a host Node process and the Docker container at the same time can make SQLite locking and WAL behavior unreliable across the host/container boundary. The app also starts refresh, digest, backup, and maintenance schedules, so duplicate runtimes can perform writes in the background.

## Browser Verification

- Use the running Compose service on port `39118`.
- If code changes are not reflected, rebuild/recreate the Compose service rather than launching a second server.

## Pre-Publish Cleanup And Privacy

- Before any requested GitHub push, Docker image build/tag/push, or combined source/image release, perform a cleanup and privacy pass.
- Inspect `git status --short`, staged changes, and untracked files. Do not include local caches, logs, temporary files, screenshots, cookies, `.DS_Store`, editor metadata, database dumps/backups, SQLite WAL/SHM files, or generated artifacts unless the user explicitly asks to publish that exact artifact.
- Inspect the changed diff for secrets and private data before publishing, including API keys, tokens, passwords, cookies/session values, private URLs, account/admin details, personal contact data, absolute local paths/usernames, and production RSS content or database-derived data.
- Remove unused debug code, noisy logging, dead code, throwaway scripts, and temporary verification hooks before committing or building an image, unless they are intentionally part of the requested feature or test coverage.
- Do not delete or rewrite user-created files or production-like data as part of cleanup unless the user explicitly approves the exact action. The `data/rss.db` safety rules still take priority.
- If a suspicious file or sensitive value might be needed, stop and ask instead of publishing it or silently deleting it.

## Release And Image Publishing

- Do not push to GitHub unless the user explicitly asks for a push.
- Do not build, tag, push, or otherwise publish Docker images unless the user explicitly asks for the exact image action.
- Before any requested GitHub push, complete the cleanup/privacy pass above, run the relevant tests or explain why they could not be run, then use the existing remote and branch unless the user names another target.
- Before any requested Docker image publish, complete the cleanup/privacy pass above, confirm the image name and tag, build through Docker Compose or `docker build`, and never use `latest` as the only tag unless the user explicitly requests it.
- When publishing both source and image, push GitHub first, then build and push the Docker image from the pushed commit so `BUILD_COMMIT`, `BUILD_TIME`, and `APP_VERSION` can identify the release.

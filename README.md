# prodpai_app — Prod Pai Todo List

A small, self-contained task manager used as the **demo workload** for the Prod-Pai Cloud DevSecOps project.

This repository is responsible for one thing only: **test → scan → build → push a container image to Amazon ECR**.
The infrastructure that actually runs the image (VPC, ALB, WAF, Auto Scaling Group, Falco, dashboard) is deployed from the sister repository [`prodpai_cloud`](https://github.com/nuntawatrdd/prodpai_cloud).

```text
 prodpai_app (this repo)                                prodpai_cloud
┌──────────────────────────────────────────┐          ┌──────────────────────────────────────────┐
│ push to main                             │          │ "Terraform Deploy Infra" (manual)        │
│   └─ CI: test ─ security ─ build ─ scan  │  image   │   └─ ASG instances pull <ECR>:latest     │
│        └─ push  <ECR>/prodpai_cloud:SHA  │ ───────► │ "Patch & Rollout ASG" (manual)           │
│                 <ECR>/prodpai_cloud:latest│          │   └─ replaces instances to pick up image │
└──────────────────────────────────────────┘          └──────────────────────────────────────────┘
```

The app itself is a **static web app**: HTML, CSS and vanilla JavaScript served by Nginx. It has no backend, no database, makes no external API calls, and loads nothing from a CDN.

---

## Table of contents

1. [Features](#features)
2. [Technology stack](#technology-stack)
3. [Repository layout](#repository-layout)
4. [How the app is built](#how-the-app-is-built)
5. [Run locally](#run-locally)
6. [Container image & Nginx](#container-image--nginx)
7. [Tests](#tests)
8. [CI pipeline](#ci-pipeline)
9. [Secrets & configuration](#secrets--configuration)
10. [Deploying the image](#deploying-the-image)
11. [Data storage & reset](#data-storage--reset)
12. [Security notes](#security-notes)
13. [Known limitations](#known-limitations)
14. [Troubleshooting](#troubleshooting)

---

## Features

- **Dashboard layout** with a sidebar (status views and data actions), a greeting, summary cards for **total / completed / pending** tasks and a progress bar.
- **Add tasks** with:
  - title — required, trimmed, max **120** characters
  - description — optional, max **500** characters
  - priority — Low / Medium / High
  - due date — optional (`YYYY-MM-DD`)
- **Edit** a task in a dialog pre-filled with its current values (completion status is kept).
- **Complete / reopen** a task with a checkbox button; counters update immediately.
- **Delete** a task after a confirmation dialog.
- **Filter** by All / Pending / Completed and **search** title + description. Filters and search can be combined.
- **Sort** by newest, oldest, priority, or due date (tasks without a due date go last).
- **Badges** for overdue and due-today tasks.
- **Empty states** for "no tasks" and "no matches", inline validation errors, and toast feedback.
- **Load sample tasks** (never duplicated) and **Clear all tasks** (with confirmation).
- **Accessible & responsive**: works from 360 px phones to desktop, light and dark themes, visible focus rings, a skip link, and `prefers-reduced-motion` support.

## Technology stack

| Layer | Choice |
|---|---|
| UI | HTML5, CSS (custom properties, grid/flex), vanilla JavaScript (ES5-compatible), inline SVG icons |
| Storage | Browser `localStorage`, key `prodpai.todo.tasks.v1` |
| Web server | `nginxinc/nginx-unprivileged:1.30.6-alpine3.24-slim`, non-root (uid 101), port **8080** |
| Tests | Node.js ≥ 22 built-in test runner (`node:test`) — **no npm dependencies** |
| CI | GitHub Actions, Semgrep, Trivy, Amazon ECR |

## Repository layout

```text
prodpai_app/
├── index.html              # markup, SVG icon sprite, dialogs (~280 lines)
├── css/
│   └── style.css           # theme tokens + responsive layout (~640 lines)
├── js/
│   ├── core.js             # pure logic, no DOM: validation, CRUD, filter/sort, storage (unit-tested)
│   └── app.js              # DOM rendering and event handling
├── assets/
│   └── favicon.svg
├── nginx.conf              # full Nginx config: non-root, /health, security headers
├── Dockerfile
├── .dockerignore           # keeps tests, docs and secrets out of the image
├── .gitignore
├── package.json            # test scripts only, zero dependencies
├── .github/
│   ├── config.env          # ECR_REPOSITORY, loaded into the workflow environment
│   └── workflows/
│       └── ci.yml          # test → security → build, scan and push to ECR
└── tests/
    ├── core.test.js        # unit tests for js/core.js
    ├── static.test.js      # markup / security / Nginx / Dockerfile checks
    ├── e2e.test.js         # real-browser tests (headless Chrome/Edge)
    └── helpers/browser.js  # minimal DevTools-protocol driver
```

## How the app is built

The code is split so the logic can be tested without a browser:

- **`js/core.js`** is a UMD-style module. In the browser it is loaded as a classic script and exposes `window.TodoCore`; under Node it is `require`d by the unit tests. It contains no DOM access. It provides:
  - validation and text cleaning (`validateTaskInput`, `cleanText`, date format check)
  - task operations (`createTask`, `updateTask`, `toggleTask`, `replaceTask`, `removeTask`)
  - `summarize` for the total / completed / pending counters
  - `filterTasks` (status + search) and `sortTasks` (newest, oldest, priority, due date)
  - `dueStatus` for the overdue / due-today badges
  - sample data helpers (`sampleTasks`, `addSampleTasks`, de-duplicated)
  - storage helpers (`loadTasks`, `saveTasks`, `sanitizeStoredTask`) that recover from missing, malformed or throwing storage
- **`js/app.js`** renders the UI and wires up events. It never uses `innerHTML`, `eval`, or inline event handlers (enforced by `static.test.js`), so user-entered text cannot become markup.
- **`index.html`** holds the markup, an inline SVG icon sprite and the dialogs. The strict CSP in `nginx.conf` (no inline scripts or styles) is why everything lives in separate `.js` / `.css` files.

## Run locally

### Without Docker

Any static file server works. From the repository root:

```bash
python -m http.server 8081
# or: npx --yes http-server -p 8081      (needs internet the first time)
```

Open <http://localhost:8081>.

> `/health` and the security headers exist **only in the Nginx container**. A plain static server returns 404 for `/health` and sends no CSP.

### With Docker

```bash
docker build -t todo-list:local .
docker run --rm -p 8081:8080 todo-list:local
```

- App: <http://localhost:8081>
- Health check: <http://localhost:8081/health>

```bash
curl -i http://localhost:8081/health    # HTTP/1.1 200 OK ... "ok"
```

For an AWS ALB target group use path `/health`, success code `200`, traffic port `8080`.

## Container image & Nginx

### Dockerfile

- Base: `nginxinc/nginx-unprivileged:1.30.6-alpine3.24-slim` (pinned, runs as uid **101**).
- Copies only what the browser needs: `index.html`, `css/`, `js/`, `assets/`, plus `nginx.conf`.
- `EXPOSE 8080`, `USER 101`.
- `HEALTHCHECK` calls `http://127.0.0.1:8080/health` with `wget`, every 30 s.
- The healthcheck uses **exec form** (no `sh -c`). This is deliberate: on the EC2 hosts in `prodpai_cloud`, Falco runs the rule *"Shell Spawned by Web User"*; a shell spawned as the nginx user would trigger it and get the instance quarantined.

### `nginx.conf`

| Setting | Value |
|---|---|
| Listen | `8080` (IPv4 + IPv6) |
| PID / temp paths | under `/tmp` so the non-root user can write |
| Logging | access log to stdout, error log to stderr (`warn`) |
| `server_tokens` | off |
| `client_max_body_size` | 1k |
| gzip | on for css, js, svg, text |
| `/health` | returns `200 ok`, no access log, no caching |
| `/index.html` | `expires -1` (always revalidated) |
| `*.css`, `*.js`, `*.svg` | `expires 1h` |
| dotfiles (`/\.…`) | `404` |
| other methods | only `GET` / `HEAD` allowed on `/` |

Security headers sent on every response:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none';
  base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

## Tests

Requires **Node.js 22 or newer**. Nothing has to be installed (`npm install` is not needed).

```bash
npm test               # everything (same as: node --test)
npm run test:unit      # core + static checks only
npm run test:e2e       # browser tests only
```

| File | What it covers |
|---|---|
| `tests/core.test.js` | Validation and trimming, create / edit / toggle / delete, counters, filters plus search, all sort modes, sample de-duplication, recovery from malformed or throwing storage |
| `tests/static.test.js` | Required UI elements exist; no `innerHTML`, `eval`, inline handlers or external URLs; Nginx listens on 8080 with `/health`; Dockerfile is pinned and non-root |
| `tests/e2e.test.js` | Starts a local server and drives headless Chrome/Edge over the DevTools protocol: create, edit, complete, delete, filters and search, persistence across reloads, and malformed `localStorage` not crashing the app |

The browser tests are **skipped automatically** when no Chromium-based browser is found. Set `CHROME_PATH` to point at one:

```bash
CHROME_PATH="/usr/bin/google-chrome" npm run test:e2e
```

## CI pipeline

`.github/workflows/ci.yml` runs on every **push** and **pull request** to `main`, and can be started by hand (`workflow_dispatch`).

**There is no CD workflow in this repository.** `Deploy` and `Patch` live in `prodpai_cloud` and are run by whoever owns the AWS account. This repository only produces an image.

```text
 test ───┐
         ├──► build-scan-push
 security┘
```

| Job | What it does |
|---|---|
| `test` | `npm test` on Node 22. `timeout-minutes: 10` so a stuck browser cannot hang the run. |
| `security` | **Semgrep** (`p/javascript`, `p/dockerfile`, `p/secrets`) and a **Trivy filesystem scan**. CRITICAL/HIGH findings fail the job. |
| `build-scan-push` | Needs `test` and `security`. Loads `.github/config.env` → configures AWS credentials → logs in to ECR → `docker build` → **smoke test** (`curl -f /health` and `/` against the running container) → **Trivy image scan** (CRITICAL/HIGH, unfixed ignored, reports only) → **push** to ECR. |

Details:

- The pushed image is the exact one that was built, smoke-tested and scanned — never a rebuild.
- Two tags are pushed: the **commit SHA** and **`latest`**.
- The repository name comes from `ECR_REPOSITORY` in `.github/config.env` (currently `prodpai_cloud`); the region is `us-east-1`.
- **Pull requests are tested and scanned but never push.** The push step carries `if: github.event_name != 'pull_request'`.
- A **manual run (`workflow_dispatch`) from any branch does push** and will move `latest` onto that branch's build. Run it from `main` unless that is what you want.

After a green run on `main`, the image reference that was pushed is `<account>.dkr.ecr.us-east-1.amazonaws.com/prodpai_cloud:<commit-sha>` — hand that tag to whoever runs `Deploy` in `prodpai_cloud`.

## Secrets & configuration

**Settings → Secrets and variables → Actions:**

| Secret | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` | ECR push credentials |
| `AWS_SECRET_ACCESS_KEY` | ECR push credentials |
| `AWS_SESSION_TOKEN` | Session token. **AWS Academy sessions expire roughly every 4 hours**, so all three must be replaced that often |

These credentials only need permission to push to the one ECR repository. Nothing in this repository touches infrastructure.

**`.github/config.env`** (read by the workflow, comments and blank lines ignored):

```env
ECR_REPOSITORY=prodpai_cloud
```

> The ECR repository must already exist. This repo does not create it.

## Deploying the image

1. Merge to `main` and wait for the **CI Pipeline** run to go green.
2. In `prodpai_cloud`, run **Terraform Deploy Infra** (first time) or **Patch & Rollout ASG** (to replace running instances with the new `latest` image).
3. Open the ALB URL printed by Terraform (`lb_domain_name_http`). The Todo app is served at `/`.

## Data storage & reset

Tasks are stored **only in the visitor's browser** in `localStorage`. They are not stored in Docker, AWS, or any database, and never leave the browser. Each browser and each origin (host + port) has its own separate list.

To reset:

- Click **Clear all tasks** in the app and confirm, or
- Run in the DevTools console: `localStorage.removeItem('prodpai.todo.tasks.v1')`, or
- Clear site data for the origin.

## Security notes

- Container runs as a **non-root** user on an unprivileged port with a pinned base image.
- **Strict CSP** and other headers (see above); no third-party requests at all.
- No `innerHTML` / `eval` / inline handlers — enforced by tests.
- Semgrep (including secrets rules) and Trivy gate every merge; Trivy also scans the built image.
- `.dockerignore` keeps tests, docs, `.env*`, `*.pem`, `*.key` out of the image; `.gitignore` excludes SBOM / Trivy outputs and local secrets.
- Nginx is the only place the security headers are set; a plain static server does not send them.

## Known limitations

- No sync between devices or browsers, and no accounts (by design).
- Data is lost if the user clears site data; private windows discard it on close.
- If storage is blocked, the app still works in memory and shows a warning.
- Dates use the browser's local time zone.
- The CSP and other security headers are sent by Nginx only.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| CI fails at *Configure AWS credentials* or *Login to Amazon ECR* | AWS Academy session expired — update all three AWS secrets |
| Push fails with "repository does not exist" | Create the ECR repository named in `.github/config.env` |
| E2E tests are skipped | No Chrome/Edge found — install one or set `CHROME_PATH` |
| `curl /health` returns 404 locally | You are using a plain static server; `/health` exists only in the Nginx container |
| `latest` points at an unexpected build | A manual run from a non-`main` branch pushed it — re-run CI on `main` |
| Instance quarantined by Falco after adding a healthcheck | Do not use `sh -c` / shell form in `HEALTHCHECK` or `CMD`; keep exec form |

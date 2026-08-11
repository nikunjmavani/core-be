# `core-rt` — Go setup, from an empty folder to live messages

> **Third document in the realtime set.**
> [`realtime-go-service-plan.md`](realtime-go-service-plan.md) owns the *why*.
> [`realtime-implementation-map.md`](realtime-implementation-map.md) owns the *core-be changes*.
> This one owns **the Go side, from nothing installed to a message on screen** — every tool, every
> dependency, every command, in order.
>
> Written for engineers who know TypeScript and have not written Go. §11 is a concept map between
> the two; read it first if Go is new to you.

---

## 1 · What you already have vs what is genuinely new

Most of the stack is already on your machine from `core-be`. The new surface is smaller than it looks.

| Thing | Status | Note |
| ----- | ------ | ---- |
| Docker + Docker Compose | ✅ have | `pnpm compose:up` already runs Postgres + Redis |
| Redis 8.6 | ✅ have | `core-be-redis` on `:6379`. `core-rt` connects to **the same instance** locally |
| Postgres | ✅ have | **`core-rt` never touches it.** No driver, no credentials, no migration |
| Node 24 / pnpm 11 | ✅ have | Unchanged — `core-be` and `core-fe` stay as they are |
| **Go toolchain** | 🆕 new | §2 |
| **golangci-lint, govulncheck, air** | 🆕 new | §3 |
| **A `core-rt` repository** | 🆕 new | §4 |

Nothing about your existing repos changes to make Go work. `core-rt` is additive.

---

## 2 · Install the Go toolchain

**Version:** Go **1.24 or newer**. The guide uses features from 1.21 (`log/slog`) and 1.22
(method-based HTTP routing), so anything ≥ 1.22 works; pick the current stable release from
<https://go.dev/dl/>. Go's compatibility promise means newer minor versions do not break old code.

### macOS

```sh
brew install go
```

### Linux (Debian/Ubuntu — do NOT use `apt install golang`, it ships badly outdated)

```sh
# Replace the version with the current stable from https://go.dev/dl/
curl -fsSLO https://go.dev/dl/go1.24.7.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.24.7.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.profile
source ~/.profile
```

### Windows

Use the MSI installer from <https://go.dev/dl/>, or `winget install GoLang.Go`.

### Verify

```sh
go version      # → go version go1.24.7 darwin/arm64  (or similar)
go env GOPATH   # → /Users/you/go   — where `go install` puts binaries
```

**Add `$(go env GOPATH)/bin` to your `PATH`.** Every tool in §3 installs there, and forgetting this
is the single most common "I installed it but `command not found`" moment.

*Time: ~5 minutes.*

---

## 3 · Install the dev tooling

Four tools. All are single static binaries; none needs a package manager or a lockfile.

```sh
# Linter — bundles staticcheck, errcheck, govet and ~50 others behind one command.
brew install golangci-lint          # macOS
# Linux/Windows: see https://golangci-lint.run/welcome/install/

# Official vulnerability scanner — reports CVEs that your code actually REACHES,
# not merely CVEs present in the dependency tree. Much lower noise than `pnpm audit`.
go install golang.org/x/vuln/cmd/govulncheck@latest

# Hot reload for local development (the `tsx watch` equivalent).
go install github.com/air-verse/air@latest

# Optional: the debugger, if you want breakpoints rather than print statements.
go install github.com/go-delve/delve/cmd/dlv@latest
```

Already in the toolchain, nothing to install: `go build`, `go test`, `go vet`, `gofmt`, and the race
detector (`go test -race`).

### Editor

- **VS Code** — install the official `golang.go` extension. It pulls in `gopls` (the language
  server) on first open and gives you format-on-save, jump-to-definition, and inline errors.
- **GoLand / IntelliJ** — works out of the box.

Formatting is **not** a debate in Go: `gofmt` is canonical and the editor applies it on save. There
is no Prettier/Biome config to argue about.

*Time: ~5 minutes.*

---

## 4 · Create the repository

From an empty directory:

```sh
mkdir core-rt && cd core-rt
git init

# Declares the module path — how other code would import this, and the identity in go.mod.
# Use your real GitHub path so tooling and future imports resolve correctly.
go mod init github.com/nikunjmavani/core-rt

mkdir -p cmd/realtime internal/{config,protocol,auth,hub,conn,ingest,policy,obs,health} contract/fixtures test/load
```

### 4.1 The layout, and what `internal/` means

```text
core-rt/
├── go.mod  go.sum                 ← dependency manifest + lockfile (both committed)
├── cmd/realtime/main.go           ← the ONE executable; wiring and shutdown only
├── internal/                      ← Go ENFORCES this: nothing outside core-rt can import it
│   ├── config/                    env → typed struct, validated at boot
│   ├── protocol/                  envelope + frame types, close codes
│   ├── auth/                      ticket redemption, JWT verify, revocation watch
│   ├── hub/                       the registry (sharded connection maps)
│   ├── conn/                      per-connection reader/writer/backpressure
│   ├── ingest/                    Redis Streams consumer
│   ├── policy/                    full-vs-summary tier selection
│   ├── obs/                       metrics, logging, Sentry
│   └── health/                    /healthz, /readyz, /metrics
├── contract/fixtures/             golden JSON, mirrored in core-be + core-fe
└── test/load/                     connection + fan-out load harness
```

`cmd/<name>/` and `internal/` are **compiler-enforced conventions**, not style preferences.
`internal/` is genuinely private — an import from another module is a compile error, not a lint
warning. It is the guarantee your `agent-os` rules provide in TypeScript, for free.

### 4.2 First runnable program

Create `cmd/realtime/main.go`:

```go
package main

import (
    "context"
    "errors"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

    mux := http.NewServeMux()
    mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
        w.WriteHeader(http.StatusOK)
        _, _ = w.Write([]byte("ok"))
    })

    server := &http.Server{
        Addr:              ":8080",
        Handler:           mux,
        ReadHeaderTimeout: 5 * time.Second, // slow-loris guard
    }

    go func() {
        slog.Info("realtime.listening", "addr", server.Addr)
        if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            slog.Error("realtime.listen_failed", "error", err)
            os.Exit(1)
        }
    }()

    // Graceful shutdown — the deploy-stampede story in the plan starts here.
    stop := make(chan os.Signal, 1)
    signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
    <-stop

    slog.Info("realtime.shutting_down")
    ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
    defer cancel()
    if err := server.Shutdown(ctx); err != nil {
        slog.Error("realtime.shutdown_failed", "error", err)
    }
}
```

Run it (the listing above shows spaces for readability — `gofmt` re-indents Go with tabs
on save, so paste it as-is and let your editor normalise it):

```sh
go run ./cmd/realtime
# another terminal:
curl localhost:8080/healthz    # → ok
```

> ### ✅ Checkpoint 1 — a Go service is running and answers HTTP
>
> No dependencies yet. Everything above is the standard library.

*Time: ~15 minutes.*

---

## 5 · Add the dependencies

Seven libraries for the whole service. Go's standard library covers HTTP, JSON, crypto,
concurrency, and structured logging, so the tree stays far smaller than an equivalent Node project.

```sh
go get github.com/coder/websocket           # WebSocket server
go get github.com/redis/go-redis/v9         # Redis client (Streams support)
go get github.com/oklog/ulid/v2             # ULID envelope ids
go get github.com/golang-jwt/jwt/v5         # RS256 verification on auth.refresh
go get github.com/prometheus/client_golang  # /metrics
go get github.com/getsentry/sentry-go       # error reporting (parity with core-be)

# test-only
go get -t go.uber.org/goleak                # goroutine-leak detection
go get -t github.com/alicebob/miniredis/v2  # in-memory Redis for tests
```

| Library | Why this one |
| ------- | ------------ |
| `coder/websocket` | Context-aware, no `unsafe`, small stdlib-shaped API. Formerly `nhooyr.io/websocket` — same library, renamed. (Plan D12.) |
| `redis/go-redis/v9` | The mainstream client; v9 has first-class `XADD`/`XREAD`. Mirrors what `ioredis` does in `core-be`. |
| `oklog/ulid/v2` | ULIDs are k-sortable and monotonic — the envelope `id` doubles as a dedupe key and a rough ordering. |
| `golang-jwt/jwt/v5` | Verifying one RS256 public key. You have a single `JWT_PUBLIC_KEY`, no keyring, so a JWKS library would be overkill. |
| `prometheus/client_golang` | Same metrics vocabulary as `core-be`, so one Grafana setup covers both. |
| `getsentry/sentry-go` | Same DSN and release tagging as the rest of the platform. |
| `go.uber.org/goleak` | **Do not skip this.** It fails a test that leaves a goroutine running. For a service whose entire job is spawning two goroutines per connection, a leak is the most likely production bug, and this catches it in CI. |
| `miniredis/v2` | Real Redis semantics in-process, so ingest and ticket tests need no container. |

`go get` writes both `go.mod` and `go.sum`. **Commit both** — same discipline as `pnpm-lock.yaml`,
and the same rule applies: a dependency change and its lockfile update are one atomic commit.

Then:

```sh
go mod tidy    # prunes unused, adds missing — run before every commit
```

*Time: ~5 minutes.*

---

## 6 · Point it at your existing Redis

No new infrastructure. `core-rt` uses the Redis that `pnpm compose:up` already starts.

```sh
cd ../core-be && pnpm compose:up      # if not already running
```

Create `core-rt/.env.local` (gitignored):

```sh
REALTIME_PORT=8080
REDIS_URL=redis://localhost:6379
REDIS_KEY_PREFIX=core:local:          # ← MUST match core-be exactly
CORE_BE_INTERNAL_URL=http://localhost:3000
REALTIME_INTERNAL_SECRET=dev-only-not-a-real-secret
ALLOWED_ORIGINS=http://localhost:5173
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
LOG_LEVEL=debug
```

> ### ⚠ The one setting that will silently break everything
>
> `REDIS_KEY_PREFIX` **must** equal what `core-be` computes in `resolveRedisKeyPrefix()` —
> `core:<NODE_ENV>:`, so `core:local:` on a developer machine. `ioredis` applies that prefix
> transparently; `go-redis` does **not** — you must prepend it yourself in every key you build.
>
> Get this wrong and there is no error anywhere: `core-be` writes to `core:local:rt:events:3`,
> `core-rt` blocks on `rt:events:3`, and you stare at a working system delivering nothing. Write
> the prefix helper once in `internal/config` and never build a raw key string outside it.

Read config at boot, validate, and **fail fast** on anything missing — the same contract as
`env-schema.ts`. A misconfigured realtime service must refuse to start, not start and stay silent.

*Time: ~10 minutes.*

---

## 7 · The Makefile

Go has no `package.json` scripts; a `Makefile` is the convention.

```makefile
.PHONY: run dev build test lint vuln check clean

run:                       ## Run once
    go run ./cmd/realtime

dev:                       ## Hot reload (tsx watch equivalent)
    air

build:                     ## Static binary → bin/realtime
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/realtime ./cmd/realtime

test:                      ## Race detector ON — non-negotiable for this service
    go test -race -count=1 ./...

lint:
    gofmt -l . && go vet ./... && golangci-lint run

vuln:
    govulncheck ./...

check: lint test vuln      ## What CI runs

clean:
    rm -rf bin/
```

> ### ⚠ Make requires literal TAB indentation
>
> The listing above is shown with spaces so it renders cleanly, but **Make only accepts tabs** —
> pasting it as-is fails with `Makefile:4: *** missing separator. Stop.` Most editors and browsers
> silently convert tabs to spaces on copy, so this bites nearly everyone once. After pasting:
>
> ```sh
> sed -i '' $'s/^    /\t/' Makefile     # macOS
> sed -i    $'s/^    /\t/' Makefile     # Linux
> ```

`make check` is your `pnpm ci:local`.

**`-race` is not optional here.** This service mutates shared maps from many goroutines; the race
detector is the only thing that reliably catches a missing lock. It slows tests ~5×, which at this
size is still seconds.

---

## 8 · The Docker image

```dockerfile
# ---- build ----
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/realtime ./cmd/realtime

# ---- runtime ----
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/realtime /realtime
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/realtime"]
```

Result: **~15 MB**, no shell, no package manager, no OS libraries — so effectively no CVE surface
from the base image. Boots in milliseconds, which is what lets a rolling deploy re-absorb 50 000
reconnects quickly.

Optionally add a `core-rt` service to `core-be/docker-compose.yml` under a profile, so
`docker compose --profile realtime up` brings up the whole stack for end-to-end work.

---

## 9 · CI

A single workflow. Roughly the `core-be` quality gate, minus everything Go gives you for free.

```yaml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.24', cache: true }
      - run: test -z "$(gofmt -l .)" || (gofmt -l . && exit 1)
      - run: go vet ./...
      - uses: golangci/golangci-lint-action@v6
      - run: go test -race -count=1 ./...
      - run: go build ./...
      - uses: golang/govulncheck-action@v1
```

Notably absent versus `core-be`: no formatter-vs-linter split (`gofmt` is canonical), no dead-code
gate (the compiler errors on unused imports and variables), no type-check step (compilation *is*
the type check).

---

## 10 · The walk — zero to a live message

Six checkpoints. Each is independently demonstrable; stop at any of them and you still have
something working.

| # | You build | You verify by | Roughly |
| - | --------- | ------------- | ------- |
| 1 | §4 skeleton | `curl localhost:8080/healthz` → `ok` | ½ day |
| 2 | Config + Redis connect + `/readyz` | Stop Redis → `/readyz` goes red; start it → green | ½ day |
| 3 | Envelope types + fixtures + tests | `make test` green; the same fixtures round-trip in `core-be` | 1 day |
| 4 | WebSocket upgrade + Origin check + hub + heartbeat | Browser console: `new WebSocket('ws://localhost:8080/v1/socket?ticket=x')` stays open; a foreign `Origin` is rejected | 2 days |
| 5 | Ingest loop + tiering + backpressure | `redis-cli XADD core:local:rt:events:0 '*' data '{...}'` → the frame appears in the browser | 2 days |
| 6 | Ticket + handshake against `core-be` | Real login → real ticket → real notification arrives live | 2 days |

> ### 🎯 Checkpoint 5 is the one that matters
>
> A hand-written `XADD` in `redis-cli` producing a frame in your browser proves the entire delivery
> path — stream → ingest → registry → tier → socket — with `core-be` not yet involved at all. Get
> here before wiring the real publisher, and every later bug has a much smaller haystack.

**Realistic total for a first-time Go engineer: 2–3 weeks** to a demoable end-to-end path, plus the
load testing and SLO work in plan milestone M5. An engineer who already knows Go: about half that.

---

## 11 · Go for TypeScript developers

The concepts you will actually meet in this codebase.

| Go | Closest TS | What is different |
| -- | ---------- | ----------------- |
| `go doWork()` | `void doWork()` | **Real** concurrency, not a microtask. Runs in parallel on another core. |
| `ch := make(chan T, 64)` | *(no equivalent)* | A typed, bounded queue between goroutines. The bounded outbound channel per connection **is** the backpressure design. |
| `defer f()` | `finally { f() }` | Runs when the function returns, on any path. Used for unlocks and closes. |
| `if err != nil { return err }` | `throw` / `try-catch` | Errors are ordinary return values. Verbose, but every failure path is visible at the call site. There is no invisible throw. |
| `ctx context.Context` | `AbortSignal` | Carries cancellation + deadlines, and is passed **explicitly** as the first argument to every blocking call. This is what makes shutdown deterministic. |
| `interface` | `interface` | **Implicitly** satisfied — a type implements it by having the methods, no `implements` keyword. Structural typing, same as TS. |
| `sync.RWMutex` | *(no equivalent)* | Explicit locks. Node is single-threaded so you never needed them; here they are how the registry stays correct. |
| Zero values | `undefined` | No null for most types: a missing `int` is `0`, a missing `string` is `""`. Fewer null checks, but be deliberate about "unset vs zero". |
| `*T` pointers | object references | Explicit. `nil` pointer dereference panics — the closest thing to a `TypeError: undefined`. |

**Three habits worth adopting on day one**

1. **Always pass `ctx` first and honour it.** `ctx context.Context` as the first parameter of any
   function that does I/O. It is how a `SIGTERM` reaches 50 000 goroutines and shuts them down in
   order instead of killing them mid-write.
2. **Never ignore an error.** `_ = doThing()` is occasionally right (a best-effort close) but must
   be a decision, not a reflex. `errcheck` inside `golangci-lint` enforces this.
3. **Run `-race` locally, not just in CI.** Data races are non-deterministic; the detector is the
   only reliable way to find them, and finding one in CI a week later is much more expensive.

**Worth reading, in order:** [A Tour of Go](https://go.dev/tour/) (~2 hours, browser-based),
[Effective Go](https://go.dev/doc/effective_go), then
[Go Concurrency Patterns](https://go.dev/blog/pipelines) when you reach checkpoint 4.

---

## 12 · Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `command not found: golangci-lint` / `air` | `$(go env GOPATH)/bin` not on `PATH` | Add it to your shell profile (§2) |
| Everything runs, **nothing is ever delivered** | `REDIS_KEY_PREFIX` mismatch | §6. Check with `redis-cli KEYS '*rt:events*'` — the prefix you see is the one `core-be` is writing |
| `missing go.sum entry` | Import added without `go get` | `go mod tidy` |
| `declared and not used` | Not a lint warning — a **compile error** | Delete it, or assign to `_` |
| Socket connects then closes ~30–60 s later | A proxy idle timeout below the heartbeat interval | Raise the proxy idle timeout above 25 s (plan §10.4) |
| `WARNING: DATA RACE` under `-race` | Shared state without a lock | Fix the lock. Never silence the detector |
| Test hangs forever | A goroutine blocked on an unbuffered channel or an un-cancelled `ctx` | Add `goleak.VerifyTestMain` and give every test a `context.WithTimeout` |

---

## 13 · Summary — the whole install

```sh
brew install go golangci-lint                              # 1 · toolchain
go install golang.org/x/vuln/cmd/govulncheck@latest        # 2 · scanner
go install github.com/air-verse/air@latest                 #     hot reload

mkdir core-rt && cd core-rt && git init                    # 3 · repo
go mod init github.com/nikunjmavani/core-rt

go get github.com/coder/websocket \
       github.com/redis/go-redis/v9 \
       github.com/oklog/ulid/v2 \
       github.com/golang-jwt/jwt/v5 \
       github.com/prometheus/client_golang \
       github.com/getsentry/sentry-go                      # 4 · dependencies

cd ../core-be && pnpm compose:up                           # 5 · reuse existing Redis
cd ../core-rt && make run                                  # 6 · go
```

Two `brew` packages, two `go install`s, six dependencies, and the Redis you already run. That is
the entire footprint of adding Go to the platform.

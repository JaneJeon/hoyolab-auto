# Agent Operations Guide

Operational knowledge for this **fork** of `torikushiii/hoyolab-auto`. Upstream's own docs are in [README.md](README.md) and still describe the app itself accurately.

## What is different about this fork

This fork exists to make failures visible. Upstream cannot report its own failures, and that let code redemption die unnoticed for twelve days in August 2026.

**Upstream is inspiration, not a merge source.** The health module and the notification changes diverge from upstream deliberately, so `git rebase` onto upstream is not the update path. To pick up upstream work, read what actually changed and port it by hand.

Deployment lives in a different repo: `JaneJeon/self-hosted`, under `services/hoyolab-auto/`. A change here reaches production only after its image is published and the `FROM` pin over there is bumped. See that repo's `AGENTS.md`.

## Golden rules

1. **Never log a credential.** Log key *names*, never values. `object/redact.js` strips bot tokens and `cdkey` values out of URLs before they reach a log line. Route new log lines that include a URL through it.
2. **Build and run the Docker image before pushing.** `docker build -t hoyolab-auto-test:local .` then run it against a scratch config. `npm test` alone does not exercise startup, config parsing, or cron registration.
3. **Never use `--no-verify` when committing.**
4. **One logical change per commit.**

## The two credential classes

A HoyoLab cookie holds two independent credentials that expire on different schedules:

- `ltoken_v2` / `ltuid_v2` / `ltmid_v2` drive check-in, Mimo, stamina and reminders.
- `cookie_token_v2` / `account_mid_v2` / `account_id_v2` drive **code redemption only**.

Redemption is the only feature using the second class, so it can be dead while everything else looks healthy. If a cookie arrives without those three fields, `#parseCookie` sets `codeRedeem: false` and redemption **disables itself**, which is why the failure was silent.

Full API reference, including the probe endpoints and their retcodes, is in the shared Craft memory: `Systems/HoYoverse account cookies`.

## The health cron

`crons/health/index.js` runs every 30 minutes and once at startup. It probes each credential class **separately** against HoYoverse's own passport API, then reports to **three separate Uptime Kuma push monitors**, one per independently-failing concern:

| Concern | Config key | Goes down when |
| --- | --- | --- |
| Liveness | `health.kuma.liveness` | the process dies or the cron stops running, whatever the credentials say |
| Login credential | `health.kuma.ltoken` | `ltoken_v2` is dead, so check-in, Mimo, stamina and reminders stop |
| Redemption credential | `health.kuma.cookieToken` | `cookie_token_v2` is dead, so code redemption stops |

**Do not collapse these into one monitor.** An aggregate cannot say which thing broke, lets one failure hide behind another's success, and destroys the per-concern "down since" and duration. Liveness in particular must stay independent: it answers "did this process run at all", which no credential probe can see.

Per monitor, each cycle:

- Healthy: pushes `status=up`.
- Dead: pushes `status=down` naming the credential and what stops working.
- The probe itself failed (timeout, DNS): pushes **nothing**. A missed heartbeat is the right signal for an undecided check, and Kuma tolerates a couple before paging. Reporting an instrument fault as a dead credential sends you to fix something that was never broken.

Each probe is sent one class's fields alone. This is load-bearing: `verifyLToken` accepts a `cookie_token` and returns OK, so a probe handed the whole cookie would report health it never tested.

Leave a URL empty to log that concern only, which is the right setting for local runs. A URL that still looks like `$KUMA_...` means someone added it to the config template but not to the Dockerfile's `envsubst` list, and it is treated as unconfigured rather than fetched.

**Set each Kuma monitor's heartbeat interval above the cron's cadence.** Do not copy another monitor's interval, because that decides how hard this hits HoYoverse's API.

## Testing

```bash
npm test     # node:test, no dependencies
npm run lint # needs devDependencies installed
```

Unit tests cover the pure logic: cookie parsing, URL redaction, probe classification, and the health cron's up/down/silent decision. There is no test that talks to HoYoverse. To check the real credential, run a probe inside the deployed container (recipe in `Systems/hoyolab-auto` in Craft), never with the cookie on your own machine.

## Running shell commands on Jane's machine

**Use `builtin cd`, never bare `cd`.** Her zsh config redefines `cd` as a
function that runs `eza -g` afterwards:

```
builtin cd "$@" && eza -g
```

`eza` wedges when the Bash tool runs it, and it takes the whole shell with it,
forever. The command produces no output and never exits. Five commands hung this
way in one session, sharing nothing but a `cd`: a `python3` heredoc, a `prettier`
run, a `railway ssh`, and two subagent commands. Absolute paths avoid it
entirely; `builtin cd` bypasses the function and returns instantly.

The symptom is worth knowing because it misleads: the wedged command looks like
whatever it was *trying* to do, so it reads as "the heredoc hung" or "railway ssh
hung". Check the process tree before theorising. `pgrep -P <pid>` on the stuck
shell shows `eza -g` sitting there.

**`railway logs` streams forever** unless you pass `--lines`, `--since` or
`--until`. Without one of those it never exits either.

## Gotchas

- `index.js` shadows the global `Error` with the project's custom class at the top of the file. An `instanceof Error` check therefore excludes native `TypeError` and `SyntaxError`. This is what silently swallowed every crashed cron.
- `crons/index.js` registers jobs as `() => cron.code(cron)` and drops the returned promise, so a rejected cron never fails visibly. The process-level handlers are the only net, and they are registered at the very end of startup, so a failure *during* startup bypasses them and crashes.
- Cookie values are base64-ish and can contain `=`. Split pairs on the **first** `=` only. `object/cookie.js` does this for both callers.
- `hoyolab-modules/template.js` has two cookie parsers: the static `parseCookie` and the private `#parseCookie`. They had drifted apart, which is how a single leading space in a pasted secret disabled redemption.
- The cookie-refresh cron (`crons/update-cookie/`) can never succeed. Its endpoint, `fetch_cookie_accountinfo`, was retired by HoYoverse and now returns `-707` for every input. Its failure path is fixed so it reports rather than throwing, but the cron itself is dead weight pending a decision to remove it.

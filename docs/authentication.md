# Password access

omp-web drives a coding agent that reads and writes files, runs shell commands,
and spends provider credits. Anything that can reach the port can do all of
that. On loopback that is exactly the intent; the moment omp-web listens on a
LAN address or sits behind a tunnel, it needs a lock.

The lock is HTTP Basic Auth over every page and every API route. The username is
always `omp`; the password is the only secret.

## Turning it on

Three ways in, in the order most people reach for them:

**From the browser.** Settings → **Access**. Set a password, and password access
turns on with it. The same panel switches the lock off without forgetting the
password, and removes the password entirely.

**From the command line.**

```bash
omp-web --authenticated
```

Turns password access on for this run and for every later one. If no password
has ever been set, omp-web asks for one on the terminal before the server
starts, so a run that was told to be locked can never come up unlocked. If a
password is already stored, the flag just switches the lock back on.

`OMP_WEB_AUTHENTICATED=1` does the same thing from the environment.

Non-interactive launches — systemd, Docker, `omp-web &` — cannot answer a
prompt, so `--authenticated` fails there with a message instead of hanging. Set
the password once interactively, or use the environment variable below.

**From the environment.**

```bash
OMP_WEB_PASSWORD='a-long-random-password' omp-web
```

The variable overrides the stored credential completely: while it is set, the
settings panel is read-only and recovery has nothing to reset. Leaving it unset
or empty hands control back to the stored credential.

## How the password is stored

In `<agentDir>/omp-web-auth.json` — normally `~/.omp/agent/omp-web-auth.json` —
created with mode `0600` and replaced atomically. The file holds a `scrypt`
digest, the random salt that produced it, and the cost parameters. **The
password itself is never written anywhere.**

That is the whole reason recovery exists rather than a "show password" button:
nothing on the machine can turn the file back into the password.

`OMP_WEB_AUTH_FILE` overrides the location. Set it if you have migrated omp's
state to XDG directories, or if you want the credential somewhere else entirely;
`bin/omp-web.js` resolves the path once and passes it to the server, so the two
halves can never disagree.

Verification is timing-safe. Because `proxy.ts` checks credentials on every
request and scrypt is deliberately slow, successful verifications are cached in
memory for five minutes, keyed by the digest that accepted them — changing or
clearing the password invalidates the cache immediately.

If the credential file exists but cannot be parsed while the lock is on, omp-web
answers `503` to everything rather than assuming it should unlock. Use
`--reset-password` to get out of that state.

## Recovering a forgotten password

Both paths prove access to the machine running the server. Neither can hand the
old password back.

**From a shell on that machine:**

```bash
omp-web --reset-password
```

Asks for a new password, stores it, and starts the server.

**From a browser**, when you have a terminal but not a shell prompt on the
server — a tmux pane, a service log, a Docker `logs` stream:

1. Open `/recover`. The page is reachable without credentials; it is the only
   thing that is.
2. Ask for a recovery code. omp-web prints it **on its own console** — the
   terminal running the server — and never returns it over HTTP.
3. Type the code and a new password into the page.

Recovery codes carry 60 bits of entropy, expire after 10 minutes, allow five
wrong attempts before being discarded, are single-use, and are themselves stored
only as a digest. A new code can be minted at most once every 30 seconds.

This means an unauthenticated caller who finds `/recover` on a scan can make the
server print codes on a console they cannot see. That is the entire extent of
what they gain.

## What this does not protect

Basic Auth authenticates; it does not encrypt. The password crosses the network
in a reversible encoding, so on plain HTTP over an untrusted path it can be read
in transit — and a password read in transit is a password lost.

Put omp-web behind HTTPS through a trusted reverse proxy, or inside a trusted
VPN, before exposing it beyond loopback. The password stops a port scanner. It
does not stop someone reading the wire.

Separately from the password, API requests are accepted only for loopback names,
IP literals, the bind hostname, and the exact names listed in
`OMP_WEB_ALLOWED_HOSTS`; cross-site browser requests are rejected outright.
Those checks run before authentication and apply to `/recover` too.

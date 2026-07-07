# Security

Figemite is local-first software. This document describes its trust model
honestly, including the tradeoffs that are intentional design, not bugs.

## Default: loopback only

The server binds to `127.0.0.1` by default (`ServerConfig.host`, and the
same default Vite's dev server uses for `npm run dev`). In this mode the
board is reachable only from the machine it's running on — other devices on
your network cannot see or touch it, even if they're on the same Wi-Fi.

mDNS advertisement (LAN discovery of your server by name) is also **off by
default**. Nothing announces your board's presence on the network unless you
turn it on.

## LAN collaboration is an explicit opt-in

Sharing a board with other devices on your network — so a teammate on
another machine can open it, or so an AI agent running elsewhere can reach
it — requires you to explicitly opt in, by setting `FIGEMITE_HOST` (e.g. to
`0.0.0.0`) for the standalone server, or the equivalent `--host` option for
the Vite dev server. mDNS advertisement is a separate opt-in
(`FIGEMITE_MDNS=1`).

**Understand what this grants before you turn it on:** figemite has no
authentication or authorization layer. Once the server is bound to a
LAN-reachable address, **any peer that can reach that address and port has
full read, write, and delete access to every board the server hosts** — the
same access you have. There are no per-board permissions, no read-only
guests, and no audit log of who changed what.

This is a deliberate local-first tradeoff: the server is designed to be a
single user's (or a small, trusted group's) own instance, not a
multi-tenant service. Adding auth would add real complexity for a threat
model this project isn't targeting. If you opt into LAN mode, treat it the
way you'd treat sharing a folder over SMB or NFS on your home network — fine
among machines and people you trust, not something to expose beyond that.

## Out of scope

Running figemite on a public, untrusted, or hostile network (e.g. binding
to `0.0.0.0` on a machine with a public IP, or on shared/hostile Wi-Fi) is
out of scope for this project's threat model. Don't do that. If you need
multi-tenant access control, TLS termination, or exposure beyond a trusted
LAN, put a reverse proxy with real authentication in front of it — figemite
itself won't provide that.

## Static builds

`npm run build:static` produces a read-only bundle with no backend at all —
there's no write path to attack, so the tradeoffs above don't apply to
statically hosted boards (e.g. on GitHub Pages).

## Reporting a vulnerability

If you find a security issue, please open a GitHub issue on this
repository, or reach out via the contact listed in the repository's profile
(TBD — update this line with a maintained security contact before wider
distribution). Please don't include board contents or other sensitive data
in a public report.

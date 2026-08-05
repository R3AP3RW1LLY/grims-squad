# GMSD AI: the tunnel

How the website reaches the models running on the owner's PC.

## Why there is no dynamic-DNS worker

The tunnel dials **outward**, from the GPU machine to Vultr, and asks the server to forward two of
its own ports back down. The server never connects to us.

So a changing home IP address is irrelevant. No dynamic DNS, no port forwarding on the router, no
daily IP-updating job, and nothing on the home network is exposed. This was a deliberate choice over
having the server call in, which would have needed all four.

## What runs where

| | |
|---|---|
| `tools/start-ai.cmd` | text model, RTX 3060 — screening and the assistant |
| `tools/start-ai-image.cmd` | image service, RTX 5070 Ti — banners and fan art |
| `tools/gmsd-tunnel.cmd` | the tunnel |

The last two are registered as scheduled tasks (`GMSD AI Tunnel`, `GMSD AI Image`) that start at
logon and restart if they die. Without that they are processes somebody remembered to launch, and
the first reboot silently takes the AI offline.

## The addresses, and why they are what they are

    server 172.18.0.1:11434  ->  PC 127.0.0.1:11434
    server 172.18.0.1:8188   ->  PC 127.0.0.1:8188

`172.18.0.1` is the **docker bridge gateway** on the server — reachable by containers on that host
and by nothing else.

It was `127.0.0.1` first, and that failed in a way worth remembering: the host reached it perfectly,
but the API runs in a **container**, and `127.0.0.1` inside a container is the container. Three
separate things had to be right before it worked:

1. bind the bridge gateway, not host loopback
2. `extra_hosts: host.docker.internal:host-gateway` on the api service — that mapping is not
   automatic on Linux
3. a ufw rule — the INPUT policy is `DROP`, so container-to-host packets were silently discarded

Only the third produced no error anywhere. The host could reach the tunnel the entire time.

## Security

The key is dedicated, is **not** the deployment key, and belongs to a shell-less account:

    restrict,port-forwarding,permitlisten="172.18.0.1:11434",permitlisten="172.18.0.1:8188",...

`restrict` removes every permission; port forwarding is granted back and confined to those ports.
If the key leaks it forwards two ports to a machine that must already be trusted — no shell, no
files, no other port.

`GatewayPorts clientspecified` — not `yes` — so the client may name a bind address but can never
bind `0.0.0.0`. Publishing an unauthenticated model endpoint to the internet is the one mistake here
that would actually matter.

`ClientAliveInterval 30` was `0`. A sleeping laptop left the forwarded port bound, and the
reconnecting tunnel could never rebind it — the classic way a reverse tunnel works fine until the
first network blip.

## Turning it on in production

**The tunnel must be proven before the config is set.** Screening treats *unconfigured* as "publish
normally" and *configured-but-unreachable* as "hold for review" — so setting `AI_BASE_URL` without a
working tunnel holds **every post on the forum**.

Verify first:

    docker exec grims-api-1 node -e "fetch('http://172.18.0.1:11434/api/tags').then(r=>console.log(r.status))"

Then add to `/srv/grims/.env`:

    AI_BASE_URL=http://172.18.0.1:11434/v1
    AI_MODEL=<model>
    IMAGE_BASE_URL=http://172.18.0.1:8188

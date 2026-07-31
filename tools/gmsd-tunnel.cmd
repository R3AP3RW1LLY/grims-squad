@echo off
REM ============================================================================
REM  The reverse tunnel that lets the website reach GMSD AI.
REM
REM  * WHAT IT DOES *
REM
REM  Opens an SSH connection OUT to the Vultr box and asks it to forward two of
REM  its own loopback ports back down to this machine:
REM
REM    server 172.18.0.1:11434  ->  this PC 127.0.0.1:11434   text  (screening, assistant)
REM    server 172.18.0.1:8188   ->  this PC 127.0.0.1:8188    image (banners, fan art)
REM
REM  172.18.0.1 is the DOCKER BRIDGE GATEWAY on the server, not the internet. It
REM  was 127.0.0.1 first, and that failed for a reason worth writing down: the API
REM  runs in a container, and 127.0.0.1 inside a container is the CONTAINER. A
REM  tunnel on the host's loopback is invisible from in there. The bridge gateway
REM  is reachable by containers on that host and by nothing else.
REM
REM  So the API's AI_BASE_URL is `http://127.0.0.1:11434/v1` in BOTH places. On a
REM  development machine that is the model server running locally; on the server
REM  it is the near end of this tunnel. One value, one code path, no environment
REM  branching -- which is what makes "it worked locally" mean something.
REM
REM  * WHY OUT AND NOT IN *
REM
REM  This PC is on a home connection with no fixed address and no open ports. A
REM  tunnel dialled outwards needs no router configuration, no dynamic DNS, and
REM  exposes nothing on this network. The server never connects to us.
REM
REM  * THE KEY CAN DO NOTHING ELSE *
REM
REM  gmsd_tunnel_ed25519 is a dedicated key for a dedicated account that has no
REM  shell. Its authorized_keys entry is:
REM
REM    restrict,port-forwarding,permitlisten="172.18.0.1:11434",permitlisten="172.18.0.1:8188",...
REM
REM  `restrict` removes every permission; port forwarding is granted back, and
REM  `permitlisten` limits it to those two loopback ports. If this key leaks, it
REM  forwards two ports to a machine that must already be trusted, and nothing
REM  more -- no shell, no file access, no other port.
REM
REM  Deliberately NOT the deployment key. That one is root.
REM ============================================================================

setlocal

set REMOTE=gmsd-tunnel@45.63.35.93
set KEY=%USERPROFILE%\.ssh\gmsd_tunnel_ed25519

if not exist "%KEY%" (
  echo Tunnel key missing: %KEY%
  echo See docs/ai-tunnel.md.
  exit /b 1
)

:loop
echo [%date% %time%] connecting...

REM  -N            no remote command; this is a tunnel, not a session
REM  -T            no pty, matching the restricted key
REM  -R            the two forwards. 127.0.0.1 on the SERVER side, so the model
REM                endpoints are reachable only from the server itself and never
REM                published to the internet.
REM
REM  ServerAliveInterval / CountMax
REM                THIS is what makes the tunnel survive a home connection. Without
REM                it a dropped link leaves this process believing it is connected
REM                forever, and the website sees a dead endpoint while the script
REM                looks healthy. 30s x 3 means a dead link is noticed in ninety
REM                seconds and the loop below reconnects.
REM
REM  ExitOnForwardFailure
REM                Refuse to sit there connected but NOT forwarding. Without it, a
REM                port still held by a previous session produces a warning and an
REM                otherwise-normal connection -- the worst possible state, because
REM                everything looks fine and nothing works.
ssh -N -T ^
  -i "%KEY%" ^
  -o IdentitiesOnly=yes ^
  -o ExitOnForwardFailure=yes ^
  -o ServerAliveInterval=30 ^
  -o ServerAliveCountMax=3 ^
  -o StrictHostKeyChecking=accept-new ^
  -R 172.18.0.1:11434:127.0.0.1:11434 ^
  -R 172.18.0.1:8188:127.0.0.1:8188 ^
  %REMOTE%

REM  Reached only when ssh EXITS -- dropped link, server reboot, laptop waking.
REM  Five seconds so a hard-down server is retried steadily rather than hammered.
echo [%date% %time%] disconnected, retrying in 5s...
timeout /t 5 /nobreak >nul
goto loop

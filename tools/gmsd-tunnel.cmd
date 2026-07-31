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

REM  Starting backoff. Doubles on each consecutive failure, capped at five minutes.
REM  See the note further down for the lockout that made this necessary.
set DELAY=5

:loop
echo [%date% %time%] connecting...

ssh -N -T ^
  -i "%KEY%" ^
  -o IdentitiesOnly=yes ^
  -o ExitOnForwardFailure=yes ^
  -o ServerAliveInterval=30 ^
  -o ServerAliveCountMax=3 ^
  -o StrictHostKeyChecking=accept-new ^
  -o ConnectTimeout=15 ^
  -R 172.18.0.1:11434:127.0.0.1:11434 ^
  -R 172.18.0.1:8188:127.0.0.1:8188 ^
  %REMOTE%

REM  A connection that LASTED is a healthy one, so the next failure starts from
REM  five seconds again rather than from wherever the last outage climbed to.
REM  Without this, one bad night would leave the tunnel reconnecting every five
REM  minutes for the rest of the week.
if %ERRORLEVEL% EQU 0 set DELAY=5

echo [%date% %time%] disconnected, retrying in %DELAY%s...
timeout /t %DELAY% /nobreak >nul

set /a DELAY=%DELAY%*2
if %DELAY% GTR 300 set DELAY=300
goto loop

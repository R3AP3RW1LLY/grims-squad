@echo off
setlocal

REM  GRIM'S SQUAD -- THE EMBEDDING MODEL, PINNED TO THE 3060
REM
REM  * SQUADRON OWNER, 2026-08-06 *
REM
REM  "this must 100%% run only on my 3060TI! not the 5070!"
REM
REM  * WHY A SECOND OLLAMA AND NOT A SETTING *
REM
REM  Ollama picks its GPU per PROCESS, not per request: CUDA_VISIBLE_DEVICES is read once at
REM  startup and applies to everything that server does. One instance therefore cannot put the
REM  chat model on one card and the embedder on another.
REM
REM  So there are two. The one the Ollama app starts keeps 11434 and the 5070 Ti, where the 7B
REM  chat model that answers screening and the assistant already lives. This one takes 11435 and
REM  sees ONLY the 3060 -- CUDA_VISIBLE_DEVICES=1 hides the other card completely, so there is no
REM  path by which a busy embedding run can land on the card the game is using.
REM
REM  Verified on 2026-08-06: this instance reports
REM    inference compute ... name=CUDA0 description="NVIDIA GeForce RTX 3060" total="12.0 GiB"
REM  and an embedding call left the 5070 Ti's memory untouched at 14,309 MiB while the 3060 rose
REM  from 0 to 427 MiB.
REM
REM  * THE MODELS ARE SHARED *
REM
REM  Both instances read the same model directory, so nothing is downloaded twice. Only the GPU
REM  and the port differ.

REM  Index 1 is the 3060. Index 0 is the 5070 Ti and must never be visible to this process.
REM  If cards are ever added or reseated, check `nvidia-smi --query-gpu=index,name --format=csv`
REM  before assuming this is still right -- the index is a position, not a name.
set CUDA_VISIBLE_DEVICES=1

REM  11434 belongs to the chat instance. This one must not collide with it.
set OLLAMA_HOST=127.0.0.1:11435

REM  Keep the embedder resident. It is small (a few hundred MB) and the alternative is paying a
REM  cold load on the first vector of every sweep, several times an hour.
set OLLAMA_KEEP_ALIVE=-1

title GMSD embedding model (3060)

:loop
echo [%date% %time%] starting embedding server on 11435, GPU 1 only...
"%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve

echo [%date% %time%] embedding server exited, restarting in 10s...
timeout /t 10 /nobreak >nul
goto loop

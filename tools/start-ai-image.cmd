@echo off
REM ============================================================================
REM  Starts ComfyUI (image generation), pinned to the RTX 5070 Ti.
REM
REM  * WHY THIS IS A SECOND SCRIPT AND A SECOND CARD *
REM
REM  Squadron owner, 2026-07-30: "can we run the text on the 3060 and the imaging
REM  on the 5070?"
REM
REM  Yes, and it is the better arrangement. The two jobs have opposite shapes:
REM  screening is small, constant and latency-critical (a member is watching a
REM  post button), while image generation is large, rare and can afford to be
REM  slow. Putting them on one card means every banner request evicts the
REM  screening model, and the next person to post waits for a 5GB reload.
REM
REM  Split across two cards, neither ever waits for the other.
REM
REM    tools\start-ai.cmd        -> Ollama, text,  RTX 3060    (12GB)
REM    tools\start-ai-image.cmd  -> ComfyUI, image, RTX 5070 Ti (16GB)
REM
REM  * BUT THE 5070 Ti IS THE GAME'S CARD *
REM
REM  It is, and that constraint drives every flag below. Squadron owner: "we need
REM  to limit it so that i can still play Elite Dangerous."
REM
REM  Measured with Elite running: the 5070 Ti sits at roughly 9.4GB of 16.3GB,
REM  which is the game plus every desktop application using GPU acceleration.
REM  That leaves about 7GB. FLUX at full fp8 wants ~11GB and would not fit, so
REM  this uses a quantised model and streams weights from system RAM -- see
REM  --lowvram below. Slower, and it does not take the card away from the game.
REM
REM  * WHAT WAS ACTUALLY MEASURED, 2026-07-30 *
REM
REM  Numbers, not assumptions, because two of the assumptions were wrong:
REM
REM    Generation, 1200x320, 4 steps    ~24-30s typical, one outlier at 66s
REM    Generation at a QUARTER the size ~19s -- only ~30% faster
REM    Resident VRAM while idle          ~5.7GB with --cache-none, ~6.8GB without
REM    POST /free                        does NOT give the memory back
REM
REM  The second line killed a planned optimisation: generating small previews and
REM  re-rendering the chosen one would have added a second endpoint and a state
REM  machine to save about five seconds. Time here is dominated by streaming
REM  weights per step under --lowvram, which barely depends on resolution.
REM
REM  The fourth line matters more. ComfyUI allocates through cudaMallocAsync,
REM  which POOLS memory and does not return it to the driver, so /free frees it
REM  INSIDE the process and nvidia-smi never moves. The only thing that truly
REM  releases the card is the process exiting.
REM
REM  Consequence, and it is the honest one: while this is running it holds ~5.7GB
REM  of the game's card whether or not anybody is generating. With Elite at ~6GB
REM  and the desktop at ~3GB that is close to the 16GB limit. If frames matter
REM  more than banners in a given evening, stop this script -- generation then
REM  reports "busy or offline" to members, which is a state the API expects and
REM  handles.
REM ============================================================================

REM  * BY UUID, NOT BY INDEX -- THE SAME TRAP AS THE TEXT SIDE *
REM
REM  CUDA does not order devices the way nvidia-smi does. nvidia-smi lists by PCI
REM  bus; CUDA defaults to FASTEST_FIRST. On this machine "0" means a different
REM  card to each of them, and which one is anybody's guess after a driver update.
REM
REM  This cost three failed attempts on the text side before the UUID fixed it.
REM  Not repeating that here. A UUID cannot be reordered.
REM
REM  This one is the 5070 Ti. The 3060 is GPU-5612e762-... and belongs to Ollama.
set CUDA_DEVICE_ORDER=PCI_BUS_ID
set CUDA_VISIBLE_DEVICES=GPU-2eba79a0-a13b-f145-f19c-0cd348f24db5

REM  Windows can page GPU memory to system RAM instead of failing an allocation.
REM  That turns "Elite Dangerous crashed to desktop" into "the banner took a few
REM  seconds longer", which is the trade we want on the card somebody is playing on.
set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

REM  ComfyUI lives outside the repo: it is ~12GB of model weights plus a checkout of somebody
REM  else's project, and neither belongs in git. D: because C: has under 60GB free.
REM  Override COMFY_HOME to put it elsewhere.
if "%COMFY_HOME%"=="" set COMFY_HOME=D:\ai\ComfyUI
if not exist "%COMFY_HOME%\main.py" (
  echo ComfyUI not found at %COMFY_HOME%. Set COMFY_HOME or see docs/ai-setup.md.
  exit /b 1
)
cd /d "%COMFY_HOME%"

REM  --lowvram        Keeps only the layers in flight on the card and streams the
REM                   rest from system RAM. This is the flag that lets a ~12GB
REM                   model pipeline run in the ~7GB the game leaves behind.
REM                   Without it, generating while flying is an out-of-memory
REM                   crash -- and it would crash the GAME, not just this.
REM
REM  --cache-none     Frees models after each generation instead of holding them
REM                   resident. Measured: ~5.7GB idle with this, ~6.8GB without,
REM                   and it costs about six seconds per image.
REM
REM                   That is a worse trade than it looks and it is still the
REM                   right one. Six seconds on a ~25s generation is real, but
REM                   the gigabyte it returns is a gigabyte the game gets on
REM                   every evening somebody is NOT generating banners -- which
REM                   is nearly all of them.
REM
REM  --preview-method none
REM                   No live denoising preview. Nobody is watching the ComfyUI
REM                   window -- the hub polls the API -- and previews cost VRAM
REM                   and a VAE decode per step.
REM
REM  --listen 127.0.0.1
REM                   Loopback only. The tunnel is what exposes this to the
REM                   server, so binding wider would publish an unauthenticated
REM                   image generator to the local network for no benefit. Same
REM                   reasoning as OLLAMA_HOST in start-ai.cmd.
REM
REM  --disable-auto-launch
REM                   Do not open a browser. This runs as a service, not a tool.
echo Starting ComfyUI on the RTX 5070 Ti (port 8188)...
venv\Scripts\python.exe main.py ^
  --listen 127.0.0.1 ^
  --port 8188 ^
  --lowvram ^
  --cache-none ^
  --preview-method none ^
  --disable-auto-launch

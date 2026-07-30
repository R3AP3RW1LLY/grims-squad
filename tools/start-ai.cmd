@echo off
REM ============================================================================
REM  Starts the AI stack, pinned to the RTX 3060.
REM
REM  * WHY THIS SCRIPT EXISTS AT ALL *
REM
REM  This machine has two GPUs: an RTX 5070 Ti (16GB) that drives the display and
REM  is usually busy, and an RTX 3060 (12GB) that sits idle. Ollama with no
REM  configuration takes the FIRST CUDA device it finds -- the 5070 Ti -- so the
REM  squadron's AI would compete with whatever the owner is actually doing.
REM
REM  Squadron owner, 2026-07-30: "is this service pegged only to use my 3060? if
REM  not we need to do that now".
REM
REM  * WHY CUDA_VISIBLE_DEVICES AND NOT AN OLLAMA SETTING *
REM
REM  Ollama has no GPU selector of its own; it honours the CUDA convention. Set
REM  HERE, in one process, rather than as a user environment variable -- a global
REM  setting would silently redirect every other CUDA program on the machine,
REM  which is a surprising thing to discover months later while debugging
REM  something unrelated.
REM
REM  * THE 3060 ONLY -- AND THIS WAS TESTED, NOT ASSUMED *
REM
REM  Squadron owner, 2026-07-30: "we can use the 5070 if we need too but we need
REM  to limit it so that i can still play Elite Dangerous. 3060 primary GPU but
REM  use the 5070 too".
REM
REM  That was tried, with `CUDA_VISIBLE_DEVICES=1,0` -- both cards visible, the
REM  3060 listed first. Ollama put the model on the 5070 Ti anyway. Measured with
REM  Elite Dangerous actually running: GPU 0 went to 15.3GB of 16.3GB while the
REM  3060 sat at zero. Ollama does not simply take the first device in the list;
REM  it makes its own choice, and on this machine it chooses the newer card.
REM
REM  So the list is one card. The good news is that this costs nothing: qwen2.5:7b
REM  is 4.7GB and even 14b is 9GB, and the 3060 has 12GB -- every model in use
REM  fits with room to spare, so the 5070 Ti was never going to be needed. Making
REM  it AVAILABLE only created a way for the game's card to be taken.
REM
REM  If a model ever genuinely needs more than 12GB, this is the one line to
REM  change -- deliberately, and ideally not while somebody is flying.
REM
REM  Verify with:  nvidia-smi   (memory must appear against GPU 1, NOT GPU 0)
REM  and  ollama ps  (should read 100% GPU, not a CPU split).
REM ============================================================================

REM  * BY UUID, NOT BY INDEX -- AND THIS IS WHY *
REM
REM  `CUDA_VISIBLE_DEVICES=1` was tried first and did NOT work: the model kept
REM  loading onto the 5070 Ti while the 3060 sat at zero.
REM
REM  The reason is that CUDA does not order devices the way nvidia-smi does.
REM  nvidia-smi lists by PCI bus; CUDA defaults to FASTEST_FIRST, so "1" means a
REM  different card to each of them, and which one is anybody's guess after a
REM  driver update or a hardware change.
REM
REM  A UUID cannot be reordered. This is the 3060 and nothing else can become it.
REM  PCI_BUS_ID is set as well so that anything else reading the ordering agrees
REM  with what nvidia-smi prints.
set CUDA_DEVICE_ORDER=PCI_BUS_ID
set CUDA_VISIBLE_DEVICES=GPU-5612e762-42fc-f272-2350-a477ed53878d

REM Loopback only. The tunnel is what exposes this to the server, so binding to
REM 0.0.0.0 would publish an unauthenticated model endpoint to the local network
REM for no benefit.
set OLLAMA_HOST=127.0.0.1:11434

REM How long a model stays resident after its last request.
REM
REM Five minutes, not the default. Screening runs in bursts when people post, and
REM the image model needs the same 12GB when somebody generates a banner -- a
REM text model camped on the card for thirty minutes would make every artwork
REM request wait for an eviction it could have avoided.
set OLLAMA_KEEP_ALIVE=5m

REM One model resident at a time, and one request at a time.
REM
REM 12GB holds qwen2.5:7b (4.7GB) comfortably and 14b (9GB) with little to spare.
REM Letting Ollama load two at once means an out-of-memory failure mid-screening,
REM which surfaces to members as posts being held for no visible reason.
REM
REM This is also what protects the game. Without a cap, a second model could be
REM loaded onto the 5070 Ti while Elite is running on it -- and the first anybody
REM would know is the frame rate.
set OLLAMA_MAX_LOADED_MODELS=1
set OLLAMA_NUM_PARALLEL=1

REM Do NOT spread one model across cards. Belt and braces alongside the single
REM visible device above -- if that line is ever widened, this still keeps a
REM model on one card rather than straddling the PCIe link, which is slower and
REM would put part of every request on the game's GPU.
set OLLAMA_SCHED_SPREAD=0

REM Context window.
REM
REM 8k, not the 32k default. Screening reads one post and the assistant answers
REM one question, so 32k buys nothing and costs real VRAM -- it is why the same
REM 4.7GB model reported 6.6GB resident. Smaller context means more room on the
REM card for the image model to share it.
set OLLAMA_CONTEXT_LENGTH=8192

echo Starting Ollama on GPU 1 (RTX 3060)...
"%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve

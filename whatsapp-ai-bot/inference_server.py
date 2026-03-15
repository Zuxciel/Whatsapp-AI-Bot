"""
inference_server.py
-------------------
Python FastAPI server untuk Qwen3-1.7B.
- Download model otomatis ke Models/Qwen/ jika belum ada
- Tidak re-download jika sudah ada (cek .downloaded marker)
- Serve /inference, /health, /reload endpoints
- Support LoRA adapter jika fine-tuning sudah berjalan
"""

import os
import sys
import json
import time
import asyncio
import logging
import types
from pathlib import Path
from typing import Optional, List, Dict, Any

# ── Patch: Inject dummy torchvision ke sys.modules SEBELUM import transformers
# ──────────────────────────────────────────────────────────────────────────────
# Masalah: torchvision yang terinstall tidak kompatibel dengan versi torch saat
# ini → RuntimeError: operator torchvision::nms does not exist
# Qwen3-1.7B adalah model teks murni, torchvision SAMA SEKALI tidak dibutuhkan.
# Solusi: inject modul dummy ke sys.modules agar transformers tidak crash saat
# mencoba import torchvision lewat image_utils.py
# ──────────────────────────────────────────────────────────────────────────────

import enum as _enum
import importlib.util as _ilu
import importlib.machinery as _ilm

def _make_dummy_module(name: str) -> types.ModuleType:
    """
    Buat modul dummy yang sepenuhnya valid di mata importlib.
    Kunci: __spec__ harus berupa ModuleSpec yang nyata, bukan None.
    transformers memanggil importlib.util.find_spec("torchvision") yang akan
    crash dengan ValueError jika __spec__ is None.
    """
    mod = types.ModuleType(name)

    # Buat ModuleSpec yang valid — ini yang membuat find_spec() tidak crash
    spec = _ilm.ModuleSpec(
        name=name,
        loader=None,      # tidak ada loader nyata
        origin=f"<dummy {name}>",
        is_package=True
    )
    mod.__spec__    = spec
    mod.__file__    = f"<dummy {name}>"
    mod.__package__ = name.split(".")[0]
    mod.__path__    = []       # wajib ada untuk package
    mod.__loader__  = None
    mod.__version__ = "0.0.0"  # agar version-check tidak crash

    class _Dummy:
        def __init__(self, *a, **kw):  pass
        def __call__(self, *a, **kw):  return _Dummy()
        def __getattr__(self, n):      return _Dummy()
        def __iter__(self):            return iter([])
        def __repr__(self):            return f"<Dummy:{name}>"
        # Agar bisa dipakai sebagai decorator, base-class, dll
        def __class_getitem__(cls, _): return cls
        def register(self, *a, **kw):  return lambda f: f
        def __set_name__(self, *a):    pass

    # __getattr__ di level modul: setiap atribut yang tidak ada → _Dummy()
    def _mod_getattr(attr):
        d = _Dummy()
        setattr(mod, attr, d)   # cache supaya tidak dipanggil berulang
        return d

    mod.__getattr__ = _mod_getattr
    sys.modules[name] = mod
    return mod

# ── Hapus dulu jika ada (mungkin sudah di-import sebelumnya dan rusak)
_TV_MODS = [
    "torchvision",
    "torchvision.transforms",
    "torchvision.transforms.functional",
    "torchvision.transforms.InterpolationMode",
    "torchvision._meta_registrations",
    "torchvision.datasets",
    "torchvision.io",
    "torchvision.models",
    "torchvision.ops",
    "torchvision.utils",
]
for _m in _TV_MODS:
    sys.modules.pop(_m, None)   # hapus entry lama (yang mungkin rusak)
    _make_dummy_module(_m)

# ── InterpolationMode: replika torchvision dengan metaclass dinamis ───────────
# transformers/image_utils.py pakai string values ("nearest", "bilinear", dsb)
# dan banyak attribute termasuk NEAREST_EXACT (torchvision >= 0.11).
# Metaclass __getattr__ memastikan attribute APAPUN tidak crash.
# ─────────────────────────────────────────────────────────────────────────────

class _InterpolationMeta(type):
    def __getattr__(cls, name: str):
        val = name.lower().replace("_", "-")
        setattr(cls, name, val)
        return val

class _InterpolationMode(metaclass=_InterpolationMeta):
    NEAREST       = "nearest"
    NEAREST_EXACT = "nearest-exact"
    BILINEAR      = "bilinear"
    BICUBIC       = "bicubic"
    BOX           = "box"
    HAMMING       = "hamming"
    LANCZOS       = "lanczos"
    ANTIALIAS     = "lanczos"
    def __init__(self, value=None): self.value = value

_tv_tf = sys.modules["torchvision.transforms"]
_tv_tf.InterpolationMode                               = _InterpolationMode  # type: ignore
sys.modules["torchvision.transforms.InterpolationMode"] = _InterpolationMode  # type: ignore
sys.modules["torchvision"].InterpolationMode           = _InterpolationMode  # type: ignore

import torch
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer

# ─────────────── CONFIG ───────────────
BASE_DIR      = Path(__file__).parent
MODEL_DIR     = BASE_DIR / "Models" / "Qwen"
ADAPTER_DIR   = MODEL_DIR / "adapter"
DOWNLOAD_MARKER = MODEL_DIR / ".downloaded"
MODEL_NAME    = "Qwen/Qwen3-1.7B"
HOST          = "0.0.0.0"
PORT          = 8000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("inference_server")

# ─────────────── MODEL DOWNLOAD ───────────────
def download_model_if_needed():
    """Download model hanya jika belum ada marker .downloaded"""
    if DOWNLOAD_MARKER.exists():
        log.info(f"[Model] Sudah terdownload di {MODEL_DIR}, skip download.")
        return

    log.info(f"[Model] Memulai download {MODEL_NAME} ke {MODEL_DIR} ...")
    log.info("[Model] Proses ini bisa memakan waktu 10-30 menit tergantung koneksi.")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=MODEL_NAME,
            local_dir=str(MODEL_DIR),
            local_dir_use_symlinks=False,
            ignore_patterns=[
                "*.msgpack", "*.h5", "flax_model*",
                "tf_model*", "rust_model*", "onnx*"
            ]
        )
        DOWNLOAD_MARKER.touch()
        log.info("[Model] ✅ Download selesai!")
    except Exception as e:
        log.error(f"[Model] ❌ Download gagal: {e}")
        sys.exit(1)

# ─────────────── GLOBAL MODEL STATE ───────────────
model_state: Dict[str, Any] = {
    "model": None,
    "tokenizer": None,
    "device": None,
    "loaded_at": None,
    "adapter_loaded": False
}

def get_device() -> str:
    if torch.cuda.is_available():
        log.info(f"[Model] GPU terdeteksi: {torch.cuda.get_device_name(0)}")
        return "cuda"
    log.info("[Model] GPU tidak terdeteksi, menggunakan CPU.")
    return "cpu"

def load_model():
    """Load model dan tokenizer dari local directory"""
    global model_state
    device = get_device()

    log.info(f"[Model] Loading tokenizer dari {MODEL_DIR} ...")
    tokenizer = AutoTokenizer.from_pretrained(
        str(MODEL_DIR),
        trust_remote_code=True
    )

    log.info(f"[Model] Loading model ke {device} ...")
    # Gunakan 'dtype' bukan 'torch_dtype' (sudah deprecated di transformers terbaru)
    dtype = torch.float16 if device == "cuda" else torch.float32

    model = AutoModelForCausalLM.from_pretrained(
        str(MODEL_DIR),
        dtype=dtype,             # ← FIXED: pakai 'dtype' bukan 'torch_dtype'
        device_map=device,
        trust_remote_code=True,
        low_cpu_mem_usage=True
    )
    model.eval()

    # Load LoRA adapter jika ada
    adapter_loaded = False
    if ADAPTER_DIR.exists() and (ADAPTER_DIR / "adapter_config.json").exists():
        try:
            from peft import PeftModel
            log.info("[Model] Menemukan LoRA adapter, loading...")
            model = PeftModel.from_pretrained(model, str(ADAPTER_DIR))
            adapter_loaded = True
            log.info("[Model] ✅ LoRA adapter berhasil dimuat!")
        except Exception as e:
            log.warning(f"[Model] Gagal load adapter: {e}")

    model_state.update({
        "model": model,
        "tokenizer": tokenizer,
        "device": device,
        "loaded_at": time.time(),
        "adapter_loaded": adapter_loaded
    })
    log.info(f"[Model] ✅ Model siap! (adapter={'Ya' if adapter_loaded else 'Tidak'})")

# ─────────────── FASTAPI APP (lifespan modern) ────────────────────────────────
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(application: FastAPI):
    """Ganti on_event('startup') yang deprecated."""
    download_model_if_needed()
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, load_model)
    yield
    log.info("[Server] Shutdown.")

app = FastAPI(
    title="Qwen3-1.7B Inference Server",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# ─────────────── SCHEMAS ───────────────
class Message(BaseModel):
    role: str   # "system" | "user" | "assistant"
    content: str

class InferenceRequest(BaseModel):
    messages: List[Message]
    max_tokens: int = 600
    temperature: float = 0.75
    top_p: float = 0.9
    enable_thinking: bool = True

class InferenceResponse(BaseModel):
    text: str
    thinking: Optional[str] = None
    tokens_used: int
    inference_time_ms: float

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    device: Optional[str]
    adapter_loaded: bool
    loaded_at: Optional[float]
    uptime_seconds: Optional[float]

# ─────────────── ENDPOINTS ───────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    ms = model_state
    loaded = ms["model"] is not None
    uptime = (time.time() - ms["loaded_at"]) if ms["loaded_at"] else None
    return HealthResponse(
        status="ok" if loaded else "loading",
        model_loaded=loaded,
        device=ms["device"],
        adapter_loaded=ms["adapter_loaded"],
        loaded_at=ms["loaded_at"],
        uptime_seconds=uptime
    )

@app.post("/inference", response_model=InferenceResponse)
async def inference(req: InferenceRequest):
    ms = model_state
    if ms["model"] is None:
        raise HTTPException(503, "Model belum siap. Coba lagi sebentar.")

    model     = ms["model"]
    tokenizer = ms["tokenizer"]
    device    = ms["device"]

    start_ts = time.time()

    try:
        messages_dicts = [{"role": m.role, "content": m.content} for m in req.messages]

        text = tokenizer.apply_chat_template(
            messages_dicts,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=req.enable_thinking
        )

        inputs = tokenizer(text, return_tensors="pt").to(device)
        input_len = inputs["input_ids"].shape[1]

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=req.max_tokens,
                temperature=req.temperature if req.temperature > 0 else 1.0,
                do_sample=req.temperature > 0,
                top_p=req.top_p,
                pad_token_id=tokenizer.eos_token_id,
                eos_token_id=tokenizer.eos_token_id,
                repetition_penalty=1.1
            )

        new_tokens  = outputs[0][input_len:]
        full_output = tokenizer.decode(new_tokens, skip_special_tokens=True)

        thinking_text = None
        clean_text    = full_output

        if req.enable_thinking and "<think>" in full_output:
            import re
            think_match = re.search(r"<think>(.*?)</think>", full_output, re.DOTALL)
            if think_match:
                thinking_text = think_match.group(1).strip()
                clean_text    = full_output[think_match.end():].strip()

        elapsed_ms = (time.time() - start_ts) * 1000

        return InferenceResponse(
            text=clean_text,
            thinking=thinking_text,
            tokens_used=len(new_tokens),
            inference_time_ms=round(elapsed_ms, 1)
        )

    except Exception as e:
        log.error(f"[Inference] Error: {e}", exc_info=True)
        raise HTTPException(500, f"Inference error: {str(e)}")

@app.post("/reload")
async def reload_model(background_tasks: BackgroundTasks):
    """Reload model (berguna setelah fine-tuning selesai)"""
    background_tasks.add_task(load_model)
    return {"message": "Reload model dijadwalkan."}

# ─────────────── MAIN ───────────────
if __name__ == "__main__":
    log.info("=" * 60)
    log.info("  Qwen3-1.7B WhatsApp AI — Inference Server")
    log.info("=" * 60)
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
        timeout_keep_alive=300
    )


# ─────────────── CONFIG ───────────────
BASE_DIR      = Path(__file__).parent
MODEL_DIR     = BASE_DIR / "Models" / "Qwen"
ADAPTER_DIR   = MODEL_DIR / "adapter"
DOWNLOAD_MARKER = MODEL_DIR / ".downloaded"
MODEL_NAME    = "Qwen/Qwen3-1.7B"
HOST          = "0.0.0.0"
PORT          = 8000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("inference_server")

# ─────────────── MODEL DOWNLOAD ───────────────
def download_model_if_needed():
    """Download model hanya jika belum ada marker .downloaded"""
    if DOWNLOAD_MARKER.exists():
        log.info(f"[Model] Sudah terdownload di {MODEL_DIR}, skip download.")
        return

    log.info(f"[Model] Memulai download {MODEL_NAME} ke {MODEL_DIR} ...")
    log.info("[Model] Proses ini bisa memakan waktu 10-30 menit tergantung koneksi.")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=MODEL_NAME,
            local_dir=str(MODEL_DIR),
            local_dir_use_symlinks=False,
            ignore_patterns=[
                "*.msgpack", "*.h5", "flax_model*",
                "tf_model*", "rust_model*", "onnx*"
            ]
        )
        DOWNLOAD_MARKER.touch()
        log.info("[Model] ✅ Download selesai!")
    except Exception as e:
        log.error(f"[Model] ❌ Download gagal: {e}")
        sys.exit(1)

# ─────────────── GLOBAL MODEL STATE ───────────────
model_state: Dict[str, Any] = {
    "model": None,
    "tokenizer": None,
    "device": None,
    "loaded_at": None,
    "adapter_loaded": False
}

def get_device() -> str:
    if torch.cuda.is_available():
        log.info(f"[Model] GPU terdeteksi: {torch.cuda.get_device_name(0)}")
        return "cuda"
    log.info("[Model] GPU tidak terdeteksi, menggunakan CPU.")
    return "cpu"

def load_model():
    """Load model dan tokenizer dari local directory"""
    global model_state
    device = get_device()

    log.info(f"[Model] Loading tokenizer dari {MODEL_DIR} ...")
    tokenizer = AutoTokenizer.from_pretrained(
        str(MODEL_DIR),
        trust_remote_code=True
    )

    log.info(f"[Model] Loading model ke {device} ...")
    dtype = torch.float16 if device == "cuda" else torch.float32

    model = AutoModelForCausalLM.from_pretrained(
        str(MODEL_DIR),
        torch_dtype=dtype,
        device_map=device,
        trust_remote_code=True,
        low_cpu_mem_usage=True
    )
    model.eval()

    # Load LoRA adapter jika ada
    adapter_loaded = False
    if ADAPTER_DIR.exists() and (ADAPTER_DIR / "adapter_config.json").exists():
        try:
            from peft import PeftModel
            log.info("[Model] Menemukan LoRA adapter, loading...")
            model = PeftModel.from_pretrained(model, str(ADAPTER_DIR))
            adapter_loaded = True
            log.info("[Model] ✅ LoRA adapter berhasil dimuat!")
        except Exception as e:
            log.warning(f"[Model] Gagal load adapter: {e}")

    model_state.update({
        "model": model,
        "tokenizer": tokenizer,
        "device": device,
        "loaded_at": time.time(),
        "adapter_loaded": adapter_loaded
    })
    log.info(f"[Model] ✅ Model siap! (adapter={'Ya' if adapter_loaded else 'Tidak'})")

# ─────────────── FASTAPI APP ───────────────
app = FastAPI(
    title="Qwen3-1.7B Inference Server",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# ─────────────── SCHEMAS ───────────────
class Message(BaseModel):
    role: str   # "system" | "user" | "assistant"
    content: str

class InferenceRequest(BaseModel):
    messages: List[Message]
    max_tokens: int = 600
    temperature: float = 0.75
    top_p: float = 0.9
    enable_thinking: bool = True

class InferenceResponse(BaseModel):
    text: str
    thinking: Optional[str] = None
    tokens_used: int
    inference_time_ms: float

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    device: Optional[str]
    adapter_loaded: bool
    loaded_at: Optional[float]
    uptime_seconds: Optional[float]

# ─────────────── ENDPOINTS ───────────────
@app.on_event("startup")
async def startup_event():
    """Download model jika perlu, lalu load."""
    download_model_if_needed()
    # Load model di thread terpisah agar tidak block event loop
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_model)

@app.get("/health", response_model=HealthResponse)
async def health():
    ms = model_state
    loaded = ms["model"] is not None
    uptime = (time.time() - ms["loaded_at"]) if ms["loaded_at"] else None
    return HealthResponse(
        status="ok" if loaded else "loading",
        model_loaded=loaded,
        device=ms["device"],
        adapter_loaded=ms["adapter_loaded"],
        loaded_at=ms["loaded_at"],
        uptime_seconds=uptime
    )

@app.post("/inference", response_model=InferenceResponse)
async def inference(req: InferenceRequest):
    ms = model_state
    if ms["model"] is None:
        raise HTTPException(503, "Model belum siap. Coba lagi sebentar.")

    model     = ms["model"]
    tokenizer = ms["tokenizer"]
    device    = ms["device"]

    start_ts = time.time()

    try:
        messages_dicts = [{"role": m.role, "content": m.content} for m in req.messages]

        # Apply Qwen3 chat template
        text = tokenizer.apply_chat_template(
            messages_dicts,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=req.enable_thinking
        )

        inputs = tokenizer(text, return_tensors="pt").to(device)
        input_len = inputs["input_ids"].shape[1]

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=req.max_tokens,
                temperature=req.temperature if req.temperature > 0 else 1.0,
                do_sample=req.temperature > 0,
                top_p=req.top_p,
                pad_token_id=tokenizer.eos_token_id,
                eos_token_id=tokenizer.eos_token_id,
                repetition_penalty=1.1
            )

        new_tokens  = outputs[0][input_len:]
        full_output = tokenizer.decode(new_tokens, skip_special_tokens=True)

        # Pisahkan <think>...</think> dari response utama
        thinking_text = None
        clean_text    = full_output

        if req.enable_thinking and "<think>" in full_output:
            import re
            think_match = re.search(r"<think>(.*?)</think>", full_output, re.DOTALL)
            if think_match:
                thinking_text = think_match.group(1).strip()
                clean_text    = full_output[think_match.end():].strip()

        elapsed_ms = (time.time() - start_ts) * 1000

        return InferenceResponse(
            text=clean_text,
            thinking=thinking_text,
            tokens_used=len(new_tokens),
            inference_time_ms=round(elapsed_ms, 1)
        )

    except Exception as e:
        log.error(f"[Inference] Error: {e}", exc_info=True)
        raise HTTPException(500, f"Inference error: {str(e)}")

@app.post("/reload")
async def reload_model(background_tasks: BackgroundTasks):
    """Reload model (berguna setelah fine-tuning selesai)"""
    background_tasks.add_task(load_model)
    return {"message": "Reload model dijadwalkan."}

# ─────────────── MAIN ───────────────
if __name__ == "__main__":
    log.info("=" * 60)
    log.info("  Qwen3-1.7B WhatsApp AI — Inference Server")
    log.info("=" * 60)
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
        timeout_keep_alive=300
    )
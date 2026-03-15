"""
finetune.py
-----------
Script fine-tuning efisien dengan LoRA/QLoRA untuk Qwen3-1.7B.
- Membaca data dari database JSON
- Format sebagai chat instruction tuning
- Simpan adapter ke Models/Qwen/adapter/
- Bisa dipanggil manual atau dari bot secara otomatis
- Otomatis reload inference server setelah selesai
"""

import os
import sys
import json
import logging
import argparse
import requests
from pathlib import Path
from datetime import datetime

BASE_DIR    = Path(__file__).parent
MODEL_DIR   = BASE_DIR / "Models" / "Qwen"
ADAPTER_DIR = MODEL_DIR / "adapter"
DB_DIR      = BASE_DIR / "database"
LOG_DIR     = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_DIR / "finetune.log")
    ]
)
log = logging.getLogger("finetune")

# ─────────────── DATA LOADING ───────────────
def load_training_data(min_examples: int = 10):
    """
    Kumpulkan conversation pairs dari semua file JSON di database/.
    Format: [{messages: [{role, content}, ...]}, ...]
    """
    examples = []
    seen_hashes = set()

    if not DB_DIR.exists():
        log.warning(f"[Data] Folder database tidak ditemukan: {DB_DIR}")
        return examples

    for db_file in DB_DIR.glob("contact_*.json"):
        try:
            with open(db_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            log.warning(f"[Data] Skip {db_file.name}: {e}")
            continue

        messages = data.get("messages", [])
        persona_name = data.get("personaName", "Aria")
        persona_desc = data.get("personaPersonality", "")

        # Build system prompt
        system_prompt = (
            f"Kamu adalah {persona_name}. {persona_desc}"
            if persona_desc else f"Kamu adalah {persona_name}, AI asisten yang helpful."
        )

        # Sliding window conversation pairs (context + response)
        window_size = 6  # 3 turns context
        filtered_msgs = [
            m for m in messages
            if m.get("role") in ("user", "assistant")
            and m.get("content", "").strip()
            and len(m.get("content", "")) > 3
        ]

        for i in range(len(filtered_msgs)):
            if filtered_msgs[i]["role"] != "assistant":
                continue

            # Ambil konteks sebelumnya (max window_size pesan)
            context_start = max(0, i - window_size)
            context_msgs  = filtered_msgs[context_start:i + 1]

            # Minimal harus ada 1 user + 1 assistant
            if len(context_msgs) < 2:
                continue

            # Deduplicate
            key = hash(context_msgs[-1]["content"])
            if key in seen_hashes:
                continue
            seen_hashes.add(key)

            # Skip response yang terlalu pendek/panjang
            response = context_msgs[-1]["content"]
            if len(response) < 5 or len(response) > 2000:
                continue

            conv = [{"role": "system", "content": system_prompt}]
            conv.extend([
                {"role": m["role"], "content": m["content"]}
                for m in context_msgs
            ])
            examples.append({"messages": conv})

    log.info(f"[Data] Total training examples: {len(examples)}")
    if len(examples) < min_examples:
        log.warning(f"[Data] Data terlalu sedikit ({len(examples)} < {min_examples}). Skip finetune.")
        return []

    return examples

# ─────────────── DATASET FORMATTING ───────────────
def format_for_training(examples, tokenizer):
    """Format conversation ke string menggunakan chat template Qwen3"""
    formatted = []
    for ex in examples:
        try:
            text = tokenizer.apply_chat_template(
                ex["messages"],
                tokenize=False,
                add_generation_prompt=False
            )
            formatted.append({"text": text})
        except Exception as e:
            log.warning(f"[Format] Skip example: {e}")
    return formatted

# ─────────────── FINE-TUNING ───────────────
def run_finetune(config: dict):
    """Main fine-tuning routine dengan LoRA"""
    try:
        import torch
        from transformers import (
            AutoModelForCausalLM, AutoTokenizer,
            TrainingArguments, DataCollatorForSeq2Seq
        )
        from peft import LoraConfig, get_peft_model, TaskType, PeftModel
        from trl import SFTTrainer, SFTConfig
        from datasets import Dataset
    except ImportError as e:
        log.error(f"[FineTune] Dependency tidak ditemukan: {e}")
        log.error("[FineTune] Jalankan: pip install -r requirements.txt")
        sys.exit(1)

    ft_cfg = config.get("finetuning", {})
    min_examples = ft_cfg.get("minExamplesBeforeTrain", 30)
    lora_r       = ft_cfg.get("loraRank", 16)
    lora_alpha   = ft_cfg.get("loraAlpha", 32)
    lr           = ft_cfg.get("learningRate", 2e-4)
    num_epochs   = ft_cfg.get("numEpochs", 2)
    batch_size   = ft_cfg.get("batchSize", 2)

    # ── Load data ──
    examples = load_training_data(min_examples)
    if not examples:
        return False

    # ── Load tokenizer ──
    log.info("[FineTune] Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # ── Format dataset ──
    formatted = format_for_training(examples, tokenizer)
    dataset   = Dataset.from_list(formatted)
    log.info(f"[FineTune] Dataset siap: {len(dataset)} examples")

    # ── Load base model ──
    device = "cuda" if torch.cuda.is_available() else "cpu"
    log.info(f"[FineTune] Loading model ke {device}...")

    load_kwargs = {
        "torch_dtype": torch.float16 if device == "cuda" else torch.float32,
        "device_map": device,
        "trust_remote_code": True,
        "low_cpu_mem_usage": True
    }
    # QLoRA jika ada bitsandbytes + CUDA
    use_qlora = device == "cuda"
    if use_qlora:
        try:
            from transformers import BitsAndBytesConfig
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.float16
            )
            load_kwargs["quantization_config"] = bnb_config
            load_kwargs.pop("torch_dtype", None)
            load_kwargs.pop("device_map", None)
            log.info("[FineTune] QLoRA (4-bit) aktif.")
        except Exception:
            use_qlora = False

    model = AutoModelForCausalLM.from_pretrained(str(MODEL_DIR), **load_kwargs)

    # ── LoRA Config ──
    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=lora_r,
        lora_alpha=lora_alpha,
        lora_dropout=0.05,
        bias="none",
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj",
                         "gate_proj", "up_proj", "down_proj"]
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # ── Training Args ──
    output_dir = MODEL_DIR / "finetune_checkpoints"
    training_args = SFTConfig(
        output_dir=str(output_dir),
        num_train_epochs=num_epochs,
        per_device_train_batch_size=batch_size,
        gradient_accumulation_steps=4,
        learning_rate=lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        logging_steps=10,
        save_steps=50,
        fp16=(device == "cuda"),
        report_to="none",
        max_seq_length=1024,
        dataset_text_field="text",
        remove_unused_columns=True
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset
    )

    log.info("[FineTune] 🚀 Memulai training...")
    start = datetime.now()
    trainer.train()
    elapsed = (datetime.now() - start).total_seconds()
    log.info(f"[FineTune] ✅ Training selesai dalam {elapsed:.0f} detik.")

    # ── Save adapter ──
    ADAPTER_DIR.mkdir(parents=True, exist_ok=True)
    trainer.model.save_pretrained(str(ADAPTER_DIR))
    tokenizer.save_pretrained(str(ADAPTER_DIR))
    log.info(f"[FineTune] Adapter disimpan ke {ADAPTER_DIR}")

    # ── Catat waktu training ──
    meta_file = ADAPTER_DIR / "training_meta.json"
    meta = {
        "trained_at": datetime.now().isoformat(),
        "num_examples": len(dataset),
        "epochs": num_epochs,
        "elapsed_seconds": elapsed
    }
    with open(meta_file, "w") as f:
        json.dump(meta, f, indent=2)

    # ── Reload inference server ──
    try:
        resp = requests.post("http://localhost:8000/reload", timeout=5)
        log.info("[FineTune] Inference server direload.")
    except Exception:
        log.warning("[FineTune] Gagal reload inference server (mungkin belum running).")

    return True

# ─────────────── ENTRY POINT ───────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fine-tune Qwen3-1.7B dengan data percakapan")
    parser.add_argument("--force", action="store_true", help="Paksa finetune meski data sedikit")
    parser.add_argument("--min-examples", type=int, default=None)
    args = parser.parse_args()

    config_path = BASE_DIR / "config.json"
    config = {}
    if config_path.exists():
        with open(config_path) as f:
            config = json.load(f)

    if args.min_examples is not None:
        config.setdefault("finetuning", {})["minExamplesBeforeTrain"] = args.min_examples
    if args.force:
        config.setdefault("finetuning", {})["minExamplesBeforeTrain"] = 1

    log.info("=" * 60)
    log.info("  Qwen3-1.7B Fine-Tuning Script")
    log.info("=" * 60)

    success = run_finetune(config)
    sys.exit(0 if success else 1)

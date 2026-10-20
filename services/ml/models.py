"""The models ALT's ML service runs, pinned to exact revisions so results can be reproduced.

Each is a pretrained, open-licence model exported to ONNX (CPU, int8 quantized), downloaded once into MODEL_DIR.
"""
import os
import urllib.request
from pathlib import Path

HF = 'https://huggingface.co/{repo}/resolve/{rev}/{file}'

MODELS = {
    # Toxicity / hate speech (Module 16). unitary/toxic-bert (Apache-2.0), a BERT model fine-tuned on the Jigsaw
    # Toxic Comment Classification data (six labels, multi-label), ONNX export by Xenova.
    'toxicity': {
        'repo': 'Xenova/toxic-bert',
        'rev': '65cbc2607cb7fad64f98d1e8a5a3d1f8577895fd',
        'files': {'model.onnx': 'onnx/model_quantized.onnx', 'tokenizer.json': 'tokenizer.json', 'config.json': 'config.json'},
        'source': 'unitary/toxic-bert (Apache-2.0)',
    },
    # Sentence embeddings (Modules 10, 11, 9): BAAI/bge-small-en-v1.5 (MIT), 384 dimensions, ONNX export by Xenova.
    'embeddings': {
        'repo': 'Xenova/bge-small-en-v1.5',
        'rev': 'ea104dacec62c0de699686887e3f920caeb4f3e3',
        'files': {'model.onnx': 'onnx/model_quantized.onnx', 'tokenizer.json': 'tokenizer.json', 'config.json': 'config.json'},
        'source': 'BAAI/bge-small-en-v1.5 (MIT)',
    },
}


def model_dir() -> Path:
    return Path(os.environ.get('ML_MODEL_DIR') or Path(__file__).parent / '.models')


def ensure(name: str, log=print) -> Path:
    """Downloads a model's files once (pinned revision) and returns its folder."""
    spec = MODELS[name]
    folder = model_dir() / name / spec['rev'][:12]
    folder.mkdir(parents=True, exist_ok=True)
    for local, remote in spec['files'].items():
        target = folder / local
        if target.exists() and target.stat().st_size > 0:
            continue
        url = HF.format(repo=spec['repo'], rev=spec['rev'], file=remote)
        log(f'downloading {name}: {remote}')
        tmp = target.with_suffix(target.suffix + '.part')
        with urllib.request.urlopen(url, timeout=120) as r, open(tmp, 'wb') as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        tmp.replace(target)
    return folder


if __name__ == '__main__':  # python models.py  -> download everything (used by setup and deploy)
    for n in MODELS:
        print(n, ensure(n))

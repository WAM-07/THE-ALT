"""Tests that need no GPU or ML library: run with `python -m unittest discover -s tests` in services/trainer."""
from __future__ import annotations

import json
import os
import struct
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from adapter_file import pack, sha256_file, unpack  # noqa: E402
from alt_client import AltTrainerClient  # noqa: E402
from dataset import build_examples, passages, system_prompt  # noqa: E402
from qlora import TrainConfig  # noqa: E402
from trainer import run_once  # noqa: E402

KEY = "test-key-0123456789abcdef0123456789"
DATA = {
    "trainingJobId": "job-1",
    "ai": {"name": "Tutor", "handle": "tutor"},
    "persona": {"about": "A patient teacher.", "traits": ["Calm"], "interests": ["Graphs"]},
    "documents": [{"title": "Graphs", "text": "BFS visits level by level.\n\nDFS goes deep first."}],
    "memories": ["I teach on Mondays."],
    "samples": ["Honestly, BFS is the easiest search to explain.", "  "],
}


def safetensors_dir(folder: str) -> None:
    """A tiny but valid PEFT output folder."""
    os.makedirs(folder, exist_ok=True)
    header = json.dumps({"base_model.lora_A.weight": {"dtype": "F32", "shape": [2], "data_offsets": [0, 8]}}).encode()
    with open(os.path.join(folder, "adapter_model.safetensors"), "wb") as f:
        f.write(struct.pack("<Q", len(header)) + header + b"\x00" * 8)
    with open(os.path.join(folder, "adapter_config.json"), "w") as f:
        json.dump({"r": 16, "peft_type": "LORA"}, f)


class DatasetTests(unittest.TestCase):
    def test_examples_teach_voice_knowledge_and_memories(self):
        ex = build_examples(DATA)
        answers = [e[-1]["content"] for e in ex]
        self.assertIn("Honestly, BFS is the easiest search to explain.", answers)
        self.assertIn("I teach on Mondays.", answers)
        self.assertTrue(any("BFS visits level by level." in a for a in answers))
        self.assertEqual(len(ex), 3)  # the blank sample is skipped
        for e in ex:
            self.assertEqual([m["role"] for m in e], ["system", "user", "assistant"])
        self.assertIn("You are Tutor", system_prompt(DATA))
        self.assertIn("You are an AI, not a human.", system_prompt(DATA))

    def test_passages_stay_within_size(self):
        text = ("word " * 500).strip()
        parts = passages(text, 200)
        self.assertTrue(all(len(p) <= 200 for p in parts))
        self.assertEqual(" ".join(parts).split(), text.split())


class AdapterFileTests(unittest.TestCase):
    def test_pack_and_unpack_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            safetensors_dir(os.path.join(tmp, "a"))
            sha = pack(os.path.join(tmp, "a"), os.path.join(tmp, "a.safetensors"))
            self.assertEqual(sha, sha256_file(os.path.join(tmp, "a.safetensors")))
            with open(os.path.join(tmp, "a.safetensors"), "rb") as f:
                (n,) = struct.unpack("<Q", f.read(8))
                self.assertEqual(n % 8, 0)
                self.assertIn("adapter_config", json.loads(f.read(n))["__metadata__"])
            unpack(os.path.join(tmp, "a.safetensors"), os.path.join(tmp, "b"))
            with open(os.path.join(tmp, "b", "adapter_config.json")) as f:
                self.assertEqual(json.load(f)["r"], 16)
            with open(os.path.join(tmp, "a", "adapter_model.safetensors"), "rb") as x, open(os.path.join(tmp, "b", "adapter_model.safetensors"), "rb") as y:
                self.assertEqual(x.read()[-8:], y.read()[-8:])  # same tensor bytes


class FakeCore(BaseHTTPRequestHandler):
    """Just enough of ALT Core's trainer socket, recording what the trainer sent."""

    calls: list = []
    waiting = True

    def log_message(self, *args):
        pass

    def _reply(self, status: int, body=None):
        raw = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(raw)

    def _handle(self):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b""
        FakeCore.calls.append((self.command, self.path, self.headers.get("x-alt-service-key"), body))
        if self.headers.get("x-alt-service-key") != KEY:
            return self._reply(401, {"error": {"code": "SERVICE_UNAUTHORIZED", "message": "no"}})
        if self.path == "/internal/trainer/claim":
            if not FakeCore.waiting:
                return self._reply(204)
            FakeCore.waiting = False
            return self._reply(200, {"id": "job-1", "aiId": "ai-1", "dataUrl": "/internal/trainer/jobs/job-1/data"})
        if self.path.endswith("/data"):
            return self._reply(200, DATA)
        if self.path.endswith("/checkpoints"):
            return self._reply(200, {"ok": True})
        if self.path.endswith("/adapter"):
            return self._reply(201, {"adapterSha256": "f" * 64, "adapterUri": f"alt://adapters/{'f' * 64}.safetensors", "sizeBytes": len(body)})
        if self.path.endswith("/complete"):
            return self._reply(200, {"versionId": "v-1", "version": 2})
        return self._reply(404, {"error": {"code": "NOT_FOUND", "message": self.path}})

    do_GET = do_POST = _handle


class LoopTests(unittest.TestCase):
    def setUp(self):
        FakeCore.calls, FakeCore.waiting = [], True
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCore)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.client = AltTrainerClient(f"http://127.0.0.1:{self.server.server_address[1]}", KEY, "test-trainer")

    def tearDown(self):
        self.server.shutdown()

    def test_claims_trains_uploads_and_completes_then_deletes_the_data(self):
        seen = {}

        def fake_train(examples, out_dir, cfg, progress):
            seen["examples"], seen["dir"] = len(examples), out_dir
            progress(10, 10, 0.5)
            safetensors_dir(out_dir)
            return {"loss": 0.5}

        self.assertEqual(run_once(self.client, TrainConfig(base_model="Qwen/Qwen2.5-3B-Instruct"), fake_train, log=lambda *_: None), "job-1")
        paths = [p for _, p, _, _ in FakeCore.calls]
        self.assertEqual(paths[0], "/internal/trainer/claim")
        self.assertIn("/internal/trainer/jobs/job-1/data", paths)
        self.assertIn("/internal/trainer/jobs/job-1/adapter", paths)
        self.assertEqual(paths[-1], "/internal/trainer/jobs/job-1/complete")
        self.assertTrue(all(k == KEY for _, _, k, _ in FakeCore.calls))
        complete = json.loads(FakeCore.calls[-1][3])
        self.assertEqual(complete, {"adapterSha256": "f" * 64, "adapterUri": f"alt://adapters/{'f' * 64}.safetensors", "baseModel": "Qwen/Qwen2.5-3B-Instruct", "dataDeleted": True, "scores": {"loss": 0.5}})
        self.assertEqual(seen["examples"], 3)
        self.assertFalse(os.path.exists(os.path.dirname(seen["dir"])))  # the work folder (and the data) are gone
        # Nothing else waiting.
        self.assertIsNone(run_once(self.client, TrainConfig(), fake_train, log=lambda *_: None))

    def test_a_failed_training_is_reported(self):
        def broken(*_):
            raise RuntimeError("CUDA out of memory")

        run_once(self.client, TrainConfig(), broken, log=lambda *_: None)
        fail = [c for c in FakeCore.calls if c[1].endswith("/fail")]
        self.assertEqual(len(fail), 1)
        self.assertEqual(json.loads(fail[0][3]), {"code": "RUNTIMEERROR", "message": "CUDA out of memory"})


if __name__ == "__main__":
    unittest.main()

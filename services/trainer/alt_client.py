"""The trainer socket, from the trainer's side (ALT Core: services/core/src/http/routes/trainer.ts).

Claim a training -> fetch the owner's consented data -> report checkpoints -> upload the adapter ->
complete it (stating the training data was deleted). Standard library only, so it is easy to test.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass


class AltError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message = status, code, message


@dataclass
class Claim:
    id: str
    ai_id: str
    data_url: str


class AltTrainerClient:
    def __init__(self, core_url: str, service_key: str, name: str = "alt-trainer", timeout: float = 120):
        self.core_url = core_url.rstrip("/")
        self.headers = {"x-alt-service-key": service_key, "x-alt-service": name}
        self.timeout = timeout

    def _send(self, method: str, path: str, body: bytes | None = None, content_type: str = "application/json"):
        headers = dict(self.headers)
        if body is not None:
            headers["content-type"] = content_type
        req = urllib.request.Request(f"{self.core_url}{path}", data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read()
                return res.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read()).get("error", {})
            except Exception:  # noqa: BLE001 - any unreadable body
                err = {}
            raise AltError(e.code, err.get("code", "HTTP_ERROR"), err.get("message", str(e))) from None

    def _json(self, method: str, path: str, payload: dict | None = None):
        return self._send(method, path, None if payload is None else json.dumps(payload).encode())

    def claim(self) -> Claim | None:
        status, body = self._json("POST", "/internal/trainer/claim")
        if status == 204 or not body:
            return None
        return Claim(id=body["id"], ai_id=body["aiId"], data_url=body["dataUrl"])

    def data(self, claim: Claim) -> dict:
        return self._json("GET", claim.data_url)[1]

    def checkpoint(self, claim: Claim, stage: str, progress: int, step: int | None = None, loss: float | None = None):
        payload: dict = {"stage": stage[:80], "progress": max(0, min(99, int(progress)))}
        if step is not None:
            payload["step"] = int(step)
        if loss is not None:
            payload["loss"] = float(loss)
        self._json("POST", f"/internal/trainer/jobs/{claim.id}/checkpoints", payload)

    def upload_adapter(self, claim: Claim, path: str) -> dict:
        with open(path, "rb") as f:
            return self._send("POST", f"/internal/trainer/jobs/{claim.id}/adapter", f.read(), "application/octet-stream")[1]

    def complete(self, claim: Claim, adapter_sha256: str, adapter_uri: str, base_model: str, scores: dict | None = None) -> dict:
        payload = {"adapterSha256": adapter_sha256, "adapterUri": adapter_uri, "baseModel": base_model, "dataDeleted": True}
        if scores:
            payload["scores"] = {k: float(v) for k, v in scores.items()}
        return self._json("POST", f"/internal/trainer/jobs/{claim.id}/complete", payload)[1]

    def fail(self, claim: Claim, code: str, message: str):
        self._json("POST", f"/internal/trainer/jobs/{claim.id}/fail", {"code": code[:60], "message": message[:500]})

    def download_adapter(self, file_name: str) -> bytes:
        req = urllib.request.Request(f"{self.core_url}/internal/trainer/adapters/{file_name}", headers=self.headers)
        with urllib.request.urlopen(req, timeout=self.timeout) as res:
            return res.read()

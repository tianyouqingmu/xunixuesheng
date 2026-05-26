from __future__ import annotations

from typing import Any
import ast
import json

import requests

from .config import LLMConfig


def normalize_base_url(base_url: str) -> str:
    stripped = base_url.rstrip("/")
    if stripped.endswith("/chat/completions"):
        return stripped
    if stripped.endswith("/v1"):
        return stripped + "/chat/completions"
    return stripped + "/chat/completions"


def _collect_text_parts(content: Any) -> list[str]:
    if content is None:
        return []
    if isinstance(content, str):
        text = content.strip()
        if not text:
            return []
        for loader in (json.loads, ast.literal_eval):
            try:
                parsed = loader(text)
            except Exception:
                continue
            if parsed != content:
                parts = _collect_text_parts(parsed)
                if parts:
                    return parts
        return [text]
    if isinstance(content, dict):
        if str(content.get("type", "")).lower() == "text" and "text" in content:
            return _collect_text_parts(content.get("text"))
        parts: list[str] = []
        for key in ("text", "content", "value", "output_text"):
            if key in content:
                parts.extend(_collect_text_parts(content.get(key)))
        return parts
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            parts.extend(_collect_text_parts(item))
        return parts
    return [str(content).strip()]


def normalize_message_content(content: Any) -> str:
    return "".join(part.strip() for part in _collect_text_parts(content) if part and part.strip())


class OpenAICompatibleLLMClient:
    def __init__(self, config: LLMConfig) -> None:
        self.config = config
        self.endpoint = normalize_base_url(config.base_url)

    @property
    def ready(self) -> bool:
        return self.config.ready

    def chat(self, messages: list[dict[str, str]]) -> str:
        if not self.ready:
            raise RuntimeError("大模型未配置，请先填写 LLM_API_KEY、LLM_MODEL 和 LLM_BASE_URL。")
        payload = {
            "model": self.config.model,
            "messages": messages,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
        }
        response = requests.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=self.config.timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError(f"大模型没有返回候选结果：{data}")
        content = choices[0].get("message", {}).get("content", "")
        text = normalize_message_content(content)
        if not text:
            raise RuntimeError("大模型返回为空。")
        return text

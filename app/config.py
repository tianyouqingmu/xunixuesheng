from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os


ENV_KEY_ORDER = [
    "APP_HOST",
    "APP_PORT",
    "APP_OPEN_BROWSER",
    "KNOWLEDGE_FILES",
    "TENCENT_APP_ID",
    "TENCENT_SECRET_ID",
    "TENCENT_SECRET_KEY",
    "TENCENT_REGION",
    "TENCENT_ASR_ENGINE_TYPE",
    "TENCENT_ASR_HOTWORD_ID",
    "TENCENT_TTS_VOICE_TYPE",
    "TENCENT_TTS_SAMPLE_RATE",
    "TENCENT_TTS_CODEC",
    "TENCENT_TTS_SPEED",
    "TENCENT_TTS_VOLUME",
    "TENCENT_TTS_MODEL_TYPE",
    "LLM_API_KEY",
    "LLM_MODEL",
    "LLM_BASE_URL",
    "LLM_TEMPERATURE",
    "LLM_MAX_TOKENS",
    "LLM_TIMEOUT_SECONDS",
]


def read_env_values(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_env_file(env_path: Path) -> None:
    for key, value in read_env_values(env_path).items():
        os.environ[key] = value


def write_env_values(env_path: Path, updates: dict[str, str]) -> None:
    env_path.parent.mkdir(parents=True, exist_ok=True)
    merged = read_env_values(env_path)
    for key, value in updates.items():
        merged[key] = str(value).strip()

    ordered_lines: list[str] = []
    consumed: set[str] = set()
    for key in ENV_KEY_ORDER:
        if key in merged:
            ordered_lines.append(f"{key}={merged[key]}")
            consumed.add(key)

    for key in sorted(merged.keys()):
        if key not in consumed:
            ordered_lines.append(f"{key}={merged[key]}")

    env_path.write_text("\n".join(ordered_lines) + "\n", encoding="utf-8")


@dataclass(frozen=True, slots=True)
class LLMConfig:
    api_key: str
    model: str
    base_url: str
    temperature: float = 0.45
    max_tokens: int = 1800
    timeout_seconds: int = 60

    @property
    def ready(self) -> bool:
        return all([self.api_key, self.model, self.base_url])


@dataclass(frozen=True, slots=True)
class TencentConfig:
    app_id: str
    secret_id: str
    secret_key: str
    region: str
    asr_engine_type: str
    asr_hotword_id: str = ""
    voice_type: int = 1001
    sample_rate: int = 16000
    codec: str = "wav"
    speed: float = 0.0
    volume: float = 0.0
    model_type: int = 1

    @property
    def asr_ready(self) -> bool:
        return all([self.app_id, self.secret_id, self.secret_key])

    @property
    def tts_ready(self) -> bool:
        return all([self.app_id, self.secret_id, self.secret_key])


@dataclass(frozen=True, slots=True)
class AppConfig:
    repo_root: Path
    web_dir: Path
    host: str
    port: int
    open_browser: bool
    knowledge_files: tuple[Path, ...]
    tencent: TencentConfig
    llm: LLMConfig

    @property
    def env_path(self) -> Path:
        return self.repo_root / ".env"

    @classmethod
    def load(cls, repo_root: Path) -> "AppConfig":
        repo_root = repo_root.resolve()
        env_path = repo_root / ".env"
        if not env_path.exists() and (repo_root / ".env.example").exists():
            env_path.write_text((repo_root / ".env.example").read_text(encoding="utf-8"), encoding="utf-8")
        load_env_file(env_path)

        knowledge_value = os.getenv("KNOWLEDGE_FILES", "").strip()
        if knowledge_value:
            names = [item.strip() for item in knowledge_value.replace("|", ";").split(";") if item.strip()]
            knowledge_files = tuple((repo_root / name).resolve() for name in names)
        else:
            knowledge_files = tuple(sorted(repo_root.glob("知识库*.docx")))

        llm = LLMConfig(
            api_key=os.getenv("LLM_API_KEY", "").strip(),
            model=os.getenv("LLM_MODEL", "").strip(),
            base_url=os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip(),
            temperature=float(os.getenv("LLM_TEMPERATURE", "0.45")),
            max_tokens=int(os.getenv("LLM_MAX_TOKENS", "1800")),
            timeout_seconds=int(os.getenv("LLM_TIMEOUT_SECONDS", "60")),
        )
        tencent = TencentConfig(
            app_id=os.getenv("TENCENT_APP_ID", "").strip(),
            secret_id=os.getenv("TENCENT_SECRET_ID", "").strip(),
            secret_key=os.getenv("TENCENT_SECRET_KEY", "").strip(),
            region=os.getenv("TENCENT_REGION", "ap-shanghai").strip() or "ap-shanghai",
            asr_engine_type=os.getenv("TENCENT_ASR_ENGINE_TYPE", "16k_zh").strip() or "16k_zh",
            asr_hotword_id=os.getenv("TENCENT_ASR_HOTWORD_ID", "").strip(),
            voice_type=int(os.getenv("TENCENT_TTS_VOICE_TYPE", "1001")),
            sample_rate=int(os.getenv("TENCENT_TTS_SAMPLE_RATE", "16000")),
            codec=os.getenv("TENCENT_TTS_CODEC", "wav").strip().lower() or "wav",
            speed=float(os.getenv("TENCENT_TTS_SPEED", "0")),
            volume=float(os.getenv("TENCENT_TTS_VOLUME", "0")),
            model_type=int(os.getenv("TENCENT_TTS_MODEL_TYPE", "1")),
        )

        return cls(
            repo_root=repo_root,
            web_dir=(repo_root / "web").resolve(),
            host=os.getenv("APP_HOST", "127.0.0.1").strip() or "127.0.0.1",
            port=int(os.getenv("APP_PORT", "8000")),
            open_browser=os.getenv("APP_OPEN_BROWSER", "true").strip().lower() in {"1", "true", "yes", "y"},
            knowledge_files=knowledge_files,
            tencent=tencent,
            llm=llm,
        )

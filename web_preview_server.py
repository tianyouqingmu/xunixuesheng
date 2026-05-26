from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import base64
import json
import os
import re
import socket
import subprocess

from app.config import AppConfig, write_env_values
from app.knowledge import knowledge_context, load_knowledge
from app.llm_client import OpenAICompatibleLLMClient
from app.speech.tencent_voice import recognize_wav, synthesize_tts, verify_tencent


ROOT = Path(__file__).resolve().parent


def find_free_port(start: int, attempts: int = 40) -> int:
    for port in range(start, start + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"No free port found: {start}-{start + attempts - 1}")


def open_in_browser(url: str) -> None:
    candidates = [
        Path(os.environ.get("ProgramFiles", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LocalAppData", "")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("ProgramFiles", "")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("LocalAppData", "")) / "Microsoft/Edge/Application/msedge.exe",
    ]
    for browser in candidates:
        if browser.exists():
            subprocess.Popen([str(browser), url])
            return
    os.startfile(url)


def parse_json_object(text: str) -> dict:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?", "", stripped, flags=re.IGNORECASE).strip()
        stripped = re.sub(r"```$", "", stripped).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", stripped, flags=re.S)
        if not match:
            raise
        return json.loads(match.group(0))


def normalize_scenario(data: dict) -> dict:
    required = ["title", "lesson", "mistake", "code", "terminal", "why", "fix", "correctCode", "warning"]
    missing = [key for key in required if not str(data.get(key, "")).strip()]
    if missing:
        raise RuntimeError("大模型生成结果缺少字段：" + "、".join(missing))
    scenario = {
        "id": "llm-" + os.urandom(4).hex(),
        "studentName": str(data.get("studentName") or "虚拟学生"),
        "title": str(data["title"]).strip(),
        "lesson": str(data["lesson"]).strip(),
        "mistake": str(data["mistake"]).strip(),
        "code": str(data["code"]).strip(),
        "terminal": str(data["terminal"]).strip(),
        "why": str(data["why"]).strip(),
        "mindset": str(data.get("mindset") or "这类错误通常来自急着运行、默认输入一定正确，忽略了返回值和边界检查。").strip(),
        "fix": str(data["fix"]).strip(),
        "correctCode": str(data["correctCode"]).strip(),
        "warning": str(data["warning"]).strip(),
        "tags": data.get("tags") if isinstance(data.get("tags"), list) else [],
    }
    return scenario


class VirtualStudentHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs) -> None:
        config = AppConfig.load(ROOT)
        super().__init__(*args, directory=str(config.web_dir), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/settings":
            self._handle_get_settings()
            return
        if parsed.path == "/api/knowledge":
            self._handle_knowledge()
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/settings":
                self._handle_save_settings()
                return
            if parsed.path == "/api/verify-tencent":
                self._handle_verify_tencent()
                return
            if parsed.path == "/api/asr":
                self._handle_asr()
                return
            if parsed.path == "/api/tts":
                self._handle_tts()
                return
            if parsed.path == "/api/generate-scenario":
                self._handle_generate_scenario()
                return
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=500)
            return
        self.send_error(404)

    def _handle_get_settings(self) -> None:
        config = AppConfig.load(ROOT)
        chunks, files = load_knowledge(config.knowledge_files)
        self._send_json(
            {
                "ok": True,
                "llm": {
                    "ready": config.llm.ready,
                    "baseUrl": config.llm.base_url,
                    "model": config.llm.model,
                    "apiKeySet": bool(config.llm.api_key),
                    "temperature": config.llm.temperature,
                    "maxTokens": config.llm.max_tokens,
                    "timeoutSeconds": config.llm.timeout_seconds,
                },
                "knowledge": {
                    "files": files,
                    "chunks": len(chunks),
                },
                "tencent": {
                    "appId": config.tencent.app_id,
                    "secretId": config.tencent.secret_id,
                    "secretKeySet": bool(config.tencent.secret_key),
                    "region": config.tencent.region,
                    "asrEngineType": config.tencent.asr_engine_type,
                    "asrHotwordId": config.tencent.asr_hotword_id,
                    "ttsVoiceType": config.tencent.voice_type,
                    "ttsSampleRate": config.tencent.sample_rate,
                    "ttsCodec": config.tencent.codec,
                    "ttsSpeed": config.tencent.speed,
                    "ttsVolume": config.tencent.volume,
                    "asrReady": config.tencent.asr_ready,
                    "ttsReady": config.tencent.tts_ready,
                },
            }
        )

    def _handle_knowledge(self) -> None:
        config = AppConfig.load(ROOT)
        chunks, files = load_knowledge(config.knowledge_files)
        preview = knowledge_context(chunks, "", limit=4, max_chars=1800)
        self._send_json({"ok": True, "files": files, "chunks": len(chunks), "preview": preview})

    def _handle_save_settings(self) -> None:
        payload = self._read_json()
        llm = payload.get("llm", {})
        tencent = payload.get("tencent", {})
        config = AppConfig.load(ROOT)
        updates = {
            "LLM_BASE_URL": str(llm.get("baseUrl", "")).strip() or "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "LLM_MODEL": str(llm.get("model", "")).strip(),
            "LLM_TEMPERATURE": str(llm.get("temperature", "")).strip() or "0.45",
            "LLM_MAX_TOKENS": str(llm.get("maxTokens", "")).strip() or "1800",
            "LLM_TIMEOUT_SECONDS": str(llm.get("timeoutSeconds", "")).strip() or "60",
        }
        api_key = str(llm.get("apiKey", "")).strip()
        if api_key:
            updates["LLM_API_KEY"] = api_key
        elif config.llm.api_key:
            updates["LLM_API_KEY"] = config.llm.api_key
        if tencent:
            updates.update(
                {
                    "TENCENT_APP_ID": str(tencent.get("appId", "")).strip(),
                    "TENCENT_SECRET_ID": str(tencent.get("secretId", "")).strip(),
                    "TENCENT_REGION": str(tencent.get("region", "")).strip() or "ap-shanghai",
                    "TENCENT_ASR_ENGINE_TYPE": str(tencent.get("asrEngineType", "")).strip() or "16k_zh",
                    "TENCENT_ASR_HOTWORD_ID": str(tencent.get("asrHotwordId", "")).strip(),
                    "TENCENT_TTS_VOICE_TYPE": str(tencent.get("ttsVoiceType", "")).strip() or "1001",
                    "TENCENT_TTS_SAMPLE_RATE": str(tencent.get("ttsSampleRate", "")).strip() or "16000",
                    "TENCENT_TTS_CODEC": str(tencent.get("ttsCodec", "")).strip() or "wav",
                    "TENCENT_TTS_SPEED": str(tencent.get("ttsSpeed", "")).strip() or "0",
                    "TENCENT_TTS_VOLUME": str(tencent.get("ttsVolume", "")).strip() or "0",
                }
            )
            secret_key = str(tencent.get("secretKey", "")).strip()
            if secret_key:
                updates["TENCENT_SECRET_KEY"] = secret_key
            elif config.tencent.secret_key:
                updates["TENCENT_SECRET_KEY"] = config.tencent.secret_key
        write_env_values(config.env_path, updates)
        refreshed = AppConfig.load(ROOT)
        self._send_json(
            {
                "ok": True,
                "ready": refreshed.llm.ready,
                "apiKeySet": bool(refreshed.llm.api_key),
                "asrReady": refreshed.tencent.asr_ready,
                "ttsReady": refreshed.tencent.tts_ready,
                "tencentSecretKeySet": bool(refreshed.tencent.secret_key),
            }
        )

    def _handle_verify_tencent(self) -> None:
        config = AppConfig.load(ROOT)
        verification = verify_tencent(config.tencent)
        self._send_json({"ok": bool(verification["asr"]["ok"] and verification["tts"]["ok"]), "verification": verification})

    def _handle_asr(self) -> None:
        config = AppConfig.load(ROOT)
        audio_bytes = self._read_multipart_file("audio")
        if not audio_bytes:
            raise RuntimeError("没有收到录音文件。")
        transcript = recognize_wav(config.tencent, audio_bytes)
        self._send_json({"ok": True, "transcript": transcript})

    def _handle_tts(self) -> None:
        config = AppConfig.load(ROOT)
        payload = self._read_json()
        text = str(payload.get("text", "")).strip()
        if not text:
            raise RuntimeError("没有可朗读的文本。")
        audio_bytes, content_type = synthesize_tts(config.tencent, text)
        self._send_json(
            {
                "ok": True,
                "audioBase64": base64.b64encode(audio_bytes).decode("utf-8"),
                "contentType": content_type,
                "voiceLabel": f"VoiceType {config.tencent.voice_type}",
            }
        )

    def _handle_generate_scenario(self) -> None:
        config = AppConfig.load(ROOT)
        chunks, _files = load_knowledge(config.knowledge_files)
        payload = self._read_json()
        lesson_goal = str(payload.get("lessonGoal", "")).strip()
        selected = payload.get("selectedScenario") if isinstance(payload.get("selectedScenario"), dict) else {}
        query = " ".join(
            [
                lesson_goal,
                str(selected.get("lesson", "")),
                str(selected.get("mistake", "")),
                str(selected.get("title", "")),
            ]
        )
        context = knowledge_context(chunks, query)
        if not context:
            raise RuntimeError("没有读取到知识库内容，请确认知识库1.docx、知识库2.docx存在。")

        messages = [
            {
                "role": "system",
                "content": (
                    "你是计算机视觉课堂的虚拟学生编剧。"
                    "你要基于给定知识库，设计一个课堂投屏演示：虚拟学生故意写出一个小白常见错误，"
                    "运行后出现报错或明显异常，再给现实学生一个精准警示。"
                    "只输出 JSON，不要 Markdown，不要解释 JSON 之外的内容。"
                ),
            },
            {
                "role": "user",
                "content": (
                    "知识库摘录：\n"
                    f"{context}\n\n"
                    "教师刚讲完的内容：\n"
                    f"{lesson_goal or 'OpenCV-Python 易错点'}\n\n"
                    "当前参考案例：\n"
                    f"{json.dumps(selected, ensure_ascii=False)[:1800]}\n\n"
                    "请输出这个 JSON 对象，字段必须齐全：\n"
                    "{\n"
                    '  "studentName": "虚拟学生姓名",\n'
                    '  "title": "演示标题",\n'
                    '  "lesson": "知识点",\n'
                    '  "mistake": "粗心错误",\n'
                    '  "code": "带错误的 Python/OpenCV 代码",\n'
                    '  "terminal": "运行后的报错或异常现象，像终端输出一样",\n'
                    '  "why": "错误原因，2到4句",\n'
                    '  "mindset": "学习心理或认知误区，2到3句，不做医学式诊断",\n'
                    '  "fix": "纠正要点，1到3句",\n'
                    '  "correctCode": "修正后的代码",\n'
                    '  "warning": "给真实学生的一句话警示",\n'
                    '  "tags": ["标签1", "标签2"]\n'
                    "}\n"
                    "要求：错误必须真实、常见、可教学；错误代码不要执行危险操作；"
                    "代码尽量 12 到 28 行；终端输出必须和错误代码对应。"
                ),
            },
        ]
        text = OpenAICompatibleLLMClient(config.llm).chat(messages)
        scenario = normalize_scenario(parse_json_object(text))
        self._send_json({"ok": True, "scenario": scenario, "source": "知识库 + 大模型"})

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _read_multipart_file(self, field_name: str) -> bytes:
        content_type = self.headers.get("Content-Type", "")
        marker = "boundary="
        if marker not in content_type:
            raise RuntimeError("录音上传格式错误：缺少 multipart boundary。")
        boundary = content_type.split(marker, 1)[1].strip().strip('"')
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length)
        delimiter = ("--" + boundary).encode("utf-8")
        for part in body.split(delimiter):
            if not part or part in {b"--\r\n", b"--"}:
                continue
            part = part.strip(b"\r\n")
            if not part or part == b"--":
                continue
            header_blob, separator, content = part.partition(b"\r\n\r\n")
            if not separator:
                continue
            headers = header_blob.decode("utf-8", errors="ignore")
            if f'name="{field_name}"' not in headers:
                continue
            return content.rstrip(b"\r\n")
        return b""

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    config = AppConfig.load(ROOT)
    index_path = config.web_dir / "index.html"
    if not index_path.exists():
        raise FileNotFoundError(f"Web entry not found: {index_path}")

    port = find_free_port(config.port)
    url = f"http://127.0.0.1:{port}"
    server = ThreadingHTTPServer((config.host, port), VirtualStudentHandler)
    print("")
    print("Virtual Student preview is running:")
    print(f"  {url}")
    print("")
    print("Knowledge base and LLM generation are handled by this local backend.")
    print("Keep this window open. Close it to stop the server.")
    print("")
    if config.open_browser:
        open_in_browser(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

import base64
import hashlib
import hmac
import io
import json
import os
import ssl
import time
import uuid
import wave
import struct
from urllib.parse import quote

import requests
import websocket
from flask import Flask, jsonify, make_response, request
from tencentcloud.asr.v20190614 import asr_client, models
from tencentcloud.common import credential
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile


app = Flask(__name__)

TTS_HOST = "tts.cloud.tencent.com"
TTS_PATH = "/stream_ws"
TTS_ACTION = "TextToStreamAudioWS"


def env(name, default=""):
    return os.environ.get(name, default).strip()


def allowed_origin():
    origin = request.headers.get("Origin", "")
    raw_allowed = env("ALLOWED_ORIGIN")
    allowed = [item.strip().rstrip("/") for item in raw_allowed.split(",") if item.strip()]
    if not allowed:
        return "*"
    if origin in allowed:
        return origin
    if origin.startswith("http://127.0.0.1") or origin.startswith("http://localhost"):
        return origin
    return allowed[0]


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = allowed_origin()
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Max-Age"] = "86400"
    return response


@app.route("/", defaults={"path": ""}, methods=["OPTIONS"])
@app.route("/<path:path>", methods=["OPTIONS"])
def options_handler(path):
    return make_response("", 204)


def json_error(message, status=400):
    return jsonify({"ok": False, "error": str(message)}), status


def target_asr_sample_rate():
    engine_type = env("TENCENT_ASR_ENGINE_TYPE", "16k_zh")
    return 8000 if engine_type.startswith("8k_") else 16000


def wav_to_mono_pcm(wav_bytes, target_rate):
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frames = wav_file.readframes(wav_file.getnframes())

    if sample_width == 1:
        samples = [(byte - 128) * 256 for byte in frames]
    elif sample_width == 2:
        samples = list(struct.unpack("<" + "h" * (len(frames) // 2), frames))
    elif sample_width == 4:
        values = struct.unpack("<" + "i" * (len(frames) // 4), frames)
        samples = [value // 65536 for value in values]
    else:
        raise RuntimeError(f"暂不支持 {sample_width * 8} bit WAV 录音。")

    if channels > 1:
        mono_samples = []
        for index in range(0, len(samples), channels):
            frame = samples[index:index + channels]
            if frame:
                mono_samples.append(int(sum(frame) / len(frame)))
        samples = mono_samples

    if sample_rate != target_rate and len(samples) > 1:
        target_length = max(int(round(len(samples) * target_rate / sample_rate)), 1)
        last = len(samples) - 1
        resampled = []
        for index in range(target_length):
            source_pos = index * last / max(target_length - 1, 1)
            left = int(source_pos)
            right = min(left + 1, last)
            ratio = source_pos - left
            value = samples[left] * (1 - ratio) + samples[right] * ratio
            resampled.append(int(value))
        samples = resampled

    clipped = [max(-32768, min(32767, int(sample))) for sample in samples]
    return struct.pack("<" + "h" * len(clipped), *clipped)


def build_asr_client():
    secret_id = env("TENCENT_SECRET_ID")
    secret_key = env("TENCENT_SECRET_KEY")
    if not secret_id or not secret_key:
        raise RuntimeError("腾讯云 SecretId 或 SecretKey 未配置。")

    http_profile = HttpProfile()
    http_profile.endpoint = "asr.tencentcloudapi.com"
    client_profile = ClientProfile()
    client_profile.httpProfile = http_profile
    cred = credential.Credential(secret_id, secret_key)
    return asr_client.AsrClient(cred, env("TENCENT_REGION", "ap-shanghai"), client_profile)


def recognize_pcm(pcm_bytes):
    if not env("TENCENT_APP_ID"):
        raise RuntimeError("腾讯云 AppID 未配置。")
    client = build_asr_client()
    request_model = models.SentenceRecognitionRequest()
    request_model.EngSerViceType = env("TENCENT_ASR_ENGINE_TYPE", "16k_zh")
    request_model.SourceType = 1
    request_model.VoiceFormat = "pcm"
    request_model.ProjectId = 0
    request_model.SubServiceType = 2
    request_model.UsrAudioKey = uuid.uuid4().hex
    request_model.Data = base64.b64encode(pcm_bytes).decode("utf-8")
    request_model.DataLen = len(pcm_bytes)
    request_model.WordInfo = 0
    request_model.FilterDirty = 0
    request_model.FilterModal = 0
    request_model.FilterPunc = 0
    request_model.ConvertNumMode = 1
    hotword_id = env("TENCENT_ASR_HOTWORD_ID")
    if hotword_id:
        request_model.HotwordId = hotword_id
    response = client.SentenceRecognition(request_model)
    return str(response.Result or "").strip()


def request_tts_codec():
    return "mp3" if env("TENCENT_TTS_CODEC", "wav").lower() == "mp3" else "pcm"


def build_tts_url(text, session_id, codec):
    app_id = env("TENCENT_APP_ID")
    secret_id = env("TENCENT_SECRET_ID")
    secret_key = env("TENCENT_SECRET_KEY")
    if not app_id or not secret_id or not secret_key:
        raise RuntimeError("腾讯云 AppID、SecretId 或 SecretKey 未配置。")

    timestamp = int(time.time())
    params = {
        "Action": TTS_ACTION,
        "AppId": int(app_id),
        "SecretId": secret_id,
        "ModelType": int(env("TENCENT_TTS_MODEL_TYPE", "1")),
        "VoiceType": int(env("TENCENT_TTS_VOICE_TYPE", "1001")),
        "Codec": codec,
        "SampleRate": int(env("TENCENT_TTS_SAMPLE_RATE", "16000")),
        "Speed": float(env("TENCENT_TTS_SPEED", "0")),
        "Volume": float(env("TENCENT_TTS_VOLUME", "0")),
        "SessionId": session_id,
        "Text": text,
        "EnableSubtitle": False,
        "Timestamp": timestamp,
        "Expired": timestamp + 24 * 60 * 60,
    }
    sign_source = "GET" + TTS_HOST + TTS_PATH + "?" + "&".join(
        f"{key}={value}" for key, value in sorted(params.items())
    )
    signature = base64.b64encode(
        hmac.new(secret_key.encode("utf-8"), sign_source.encode("utf-8"), hashlib.sha1).digest()
    ).decode("utf-8")
    query = "&".join(
        f"{key}={quote(str(value), safe='') if key == 'Text' else value}"
        for key, value in sorted(params.items())
    )
    return f"wss://{TTS_HOST}{TTS_PATH}?{query}&Signature={quote(signature, safe='')}"


def collect_tts_audio(signed_url):
    chunks = []
    ws = websocket.create_connection(signed_url, timeout=25, sslopt={"cert_reqs": ssl.CERT_REQUIRED})
    try:
        deadline = time.time() + 45
        while time.time() < deadline:
            message = ws.recv()
            if isinstance(message, bytes):
                chunks.append(message)
                continue
            if not message:
                continue
            payload = json.loads(message)
            code = int(payload.get("code", 0))
            if code != 0:
                raise RuntimeError(f"{payload.get('message', 'TencentTTSError')} (code={code})")
            if int(payload.get("final", 0)) == 1:
                break
        else:
            raise RuntimeError("腾讯云实时语音合成超时。")
    finally:
        try:
            ws.close()
        except Exception:
            pass
    return b"".join(chunks)


def synthesize_tts(text):
    speech_text = str(text or "").strip()
    if not speech_text:
        raise RuntimeError("没有可用于语音合成的文本。")
    speech_text = speech_text[:250]
    session_id = uuid.uuid4().hex
    codec = request_tts_codec()
    audio_bytes = collect_tts_audio(build_tts_url(speech_text, session_id, codec))
    if not audio_bytes:
        raise RuntimeError("腾讯云实时语音合成没有返回音频。")

    if codec == "mp3":
        return audio_bytes, "audio/mpeg"

    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(int(env("TENCENT_TTS_SAMPLE_RATE", "16000")))
        wav_file.writeframes(audio_bytes)
    return wav_buffer.getvalue(), "audio/wav"


def normalize_base_url(base_url):
    stripped = str(base_url or "").rstrip("/")
    if stripped.endswith("/chat/completions"):
        return stripped
    if stripped.endswith("/v1"):
        return stripped + "/chat/completions"
    return stripped + "/chat/completions"


def collect_text_parts(content):
    if content is None:
        return []
    if isinstance(content, str):
        return [content.strip()] if content.strip() else []
    if isinstance(content, list):
        parts = []
        for item in content:
            parts.extend(collect_text_parts(item))
        return parts
    if isinstance(content, dict):
        parts = []
        for key in ("text", "content", "value", "output_text"):
            if key in content:
                parts.extend(collect_text_parts(content[key]))
        return parts
    return [str(content).strip()]


@app.route("/", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "virtual-student-proxy"})


@app.route("/verify", methods=["POST"])
def verify():
    verification = {
        "asr": {"ok": False, "message": "未验证"},
        "tts": {"ok": False, "message": "未验证"},
    }
    try:
        silence = b"\x00\x00" * target_asr_sample_rate()
        recognize_pcm(silence)
        verification["asr"] = {"ok": True, "message": "腾讯云一句话识别连接成功"}
    except Exception as exc:
        verification["asr"] = {"ok": False, "message": str(exc)}

    try:
        audio_bytes, content_type = synthesize_tts("连接测试")
        verification["tts"] = {
            "ok": True,
            "message": "腾讯云实时语音合成连接成功",
            "audioBase64": base64.b64encode(audio_bytes).decode("utf-8"),
            "contentType": content_type,
        }
    except Exception as exc:
        verification["tts"] = {"ok": False, "message": str(exc)}

    return jsonify({"ok": bool(verification["asr"]["ok"] and verification["tts"]["ok"]), "verification": verification})


@app.route("/asr", methods=["POST"])
def asr():
    try:
        uploaded = request.files.get("audio")
        if uploaded is None:
            return json_error("请上传 audio 文件。")
        pcm_bytes = wav_to_mono_pcm(uploaded.read(), target_asr_sample_rate())
        transcript = recognize_pcm(pcm_bytes)
        if not transcript:
            return json_error("腾讯云没有返回有效识别结果，请再说一遍。", 502)
        return jsonify({"ok": True, "transcript": transcript})
    except TencentCloudSDKException as exc:
        return json_error(f"腾讯云一句话识别失败：{exc}", 502)
    except Exception as exc:
        return json_error(exc, 500)


@app.route("/tts", methods=["POST"])
def tts():
    try:
        payload = request.get_json(silent=True) or {}
        audio_bytes, content_type = synthesize_tts(payload.get("text", ""))
        return jsonify({
            "ok": True,
            "audioBase64": base64.b64encode(audio_bytes).decode("utf-8"),
            "contentType": content_type,
            "voiceLabel": f"VoiceType {env('TENCENT_TTS_VOICE_TYPE', '1001')}",
        })
    except Exception as exc:
        return json_error(exc, 500)


@app.route("/llm", methods=["POST"])
def llm():
    try:
        payload = request.get_json(silent=True) or {}
        api_key = env("DASHSCOPE_API_KEY") or env("LLM_API_KEY")
        if not api_key:
            return json_error("DASHSCOPE_API_KEY 未配置。")
        body = {
            "model": env("LLM_MODEL") or payload.get("model") or "qwen-plus",
            "messages": payload.get("messages") or [],
            "temperature": float(payload.get("temperature", env("LLM_TEMPERATURE", "0.55"))),
            "max_tokens": int(payload.get("max_tokens", env("LLM_MAX_TOKENS", "420"))),
        }
        response = requests.post(
            normalize_base_url(env("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=int(env("LLM_TIMEOUT_SECONDS", "45")),
        )
        if response.status_code >= 400:
            return json_error(f"大模型请求失败：HTTP {response.status_code} {response.text[:300]}", 502)
        data = response.json()
        choices = data.get("choices", [])
        content = choices[0].get("message", {}).get("content", "") if choices else ""
        answer = "".join(collect_text_parts(content)).strip()
        if not answer:
            return json_error("大模型返回为空。", 502)
        return jsonify({"ok": True, "answer": answer, "raw": data})
    except Exception as exc:
        return json_error(exc, 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "9000")))

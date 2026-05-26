from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import ssl
import time
import uuid
import wave
import struct
from urllib.parse import quote

import websocket

from app.config import TencentConfig


TTS_HOST = "tts.cloud.tencent.com"
TTS_PATH = "/stream_ws"
TTS_ACTION = "TextToStreamAudioWS"


def target_asr_sample_rate(config: TencentConfig) -> int:
    return 8000 if config.asr_engine_type.startswith("8k_") else 16000


def wav_to_mono_pcm(wav_bytes: bytes, target_rate: int) -> bytes:
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
            frame = samples[index : index + channels]
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


def build_asr_client(config: TencentConfig):
    if not config.secret_id or not config.secret_key:
        raise RuntimeError("腾讯云 SecretId 或 SecretKey 未配置。")
    try:
        from tencentcloud.asr.v20190614 import asr_client
        from tencentcloud.common import credential
        from tencentcloud.common.profile.client_profile import ClientProfile
        from tencentcloud.common.profile.http_profile import HttpProfile
    except ModuleNotFoundError as exc:
        raise RuntimeError("未安装腾讯云 ASR SDK，请先运行 python -m pip install -r requirements.txt。") from exc
    http_profile = HttpProfile()
    http_profile.endpoint = "asr.tencentcloudapi.com"
    client_profile = ClientProfile()
    client_profile.httpProfile = http_profile
    cred = credential.Credential(config.secret_id, config.secret_key)
    return asr_client.AsrClient(cred, config.region or "ap-shanghai", client_profile)


def recognize_pcm(config: TencentConfig, pcm_bytes: bytes) -> str:
    if not config.app_id:
        raise RuntimeError("腾讯云 AppID 未配置。")
    try:
        from tencentcloud.asr.v20190614 import models
    except ModuleNotFoundError as exc:
        raise RuntimeError("未安装腾讯云 ASR SDK，请先运行 python -m pip install -r requirements.txt。") from exc
    client = build_asr_client(config)
    request_model = models.SentenceRecognitionRequest()
    request_model.EngSerViceType = config.asr_engine_type
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
    if config.asr_hotword_id:
        request_model.HotwordId = config.asr_hotword_id
    response = client.SentenceRecognition(request_model)
    return str(response.Result or "").strip()


def recognize_wav(config: TencentConfig, wav_bytes: bytes) -> str:
    if not config.asr_ready:
        raise RuntimeError("腾讯云一句话识别未配置完整，请先填写 AppID、SecretId 和 SecretKey。")
    pcm_bytes = wav_to_mono_pcm(wav_bytes, target_asr_sample_rate(config))
    if not pcm_bytes:
        raise RuntimeError("录音文件为空，无法进行语音识别。")
    transcript = recognize_pcm(config, pcm_bytes)
    if not transcript:
        raise RuntimeError("腾讯云没有返回有效识别结果，请再说一遍。")
    return transcript


def request_tts_codec(config: TencentConfig) -> str:
    return "mp3" if config.codec.lower() == "mp3" else "pcm"


def build_tts_url(config: TencentConfig, text: str, session_id: str, codec: str) -> str:
    if not config.tts_ready:
        raise RuntimeError("腾讯云实时语音合成未配置完整，请先填写 AppID、SecretId 和 SecretKey。")
    timestamp = int(time.time())
    params = {
        "Action": TTS_ACTION,
        "AppId": int(config.app_id),
        "SecretId": config.secret_id,
        "ModelType": config.model_type,
        "VoiceType": config.voice_type,
        "Codec": codec,
        "SampleRate": config.sample_rate,
        "Speed": config.speed,
        "Volume": config.volume,
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
        hmac.new(config.secret_key.encode("utf-8"), sign_source.encode("utf-8"), hashlib.sha1).digest()
    ).decode("utf-8")
    query = "&".join(
        f"{key}={quote(str(value), safe='') if key == 'Text' else value}"
        for key, value in sorted(params.items())
    )
    return f"wss://{TTS_HOST}{TTS_PATH}?{query}&Signature={quote(signature, safe='')}"


def collect_tts_audio(signed_url: str) -> bytes:
    chunks: list[bytes] = []
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


def synthesize_tts(config: TencentConfig, text: str) -> tuple[bytes, str]:
    speech_text = str(text or "").strip()
    if not speech_text:
        raise RuntimeError("没有可用于语音合成的文本。")
    speech_text = speech_text[:250]
    session_id = uuid.uuid4().hex
    codec = request_tts_codec(config)
    audio_bytes = collect_tts_audio(build_tts_url(config, speech_text, session_id, codec))
    if not audio_bytes:
        raise RuntimeError("腾讯云实时语音合成没有返回音频。")
    if codec == "mp3":
        return audio_bytes, "audio/mpeg"

    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(config.sample_rate)
        wav_file.writeframes(audio_bytes)
    return wav_buffer.getvalue(), "audio/wav"


def verify_tencent(config: TencentConfig) -> dict:
    verification = {
        "asr": {"ok": False, "message": "未验证"},
        "tts": {"ok": False, "message": "未验证"},
    }
    try:
        silence = b"\x00\x00" * target_asr_sample_rate(config)
        recognize_pcm(config, silence)
        verification["asr"] = {"ok": True, "message": "腾讯云一句话识别连接成功"}
    except Exception as exc:
        verification["asr"] = {"ok": False, "message": str(exc)}

    try:
        audio_bytes, content_type = synthesize_tts(config, "连接测试")
        verification["tts"] = {
            "ok": True,
            "message": "腾讯云实时语音合成连接成功",
            "audioBase64": base64.b64encode(audio_bytes).decode("utf-8"),
            "contentType": content_type,
        }
    except Exception as exc:
        verification["tts"] = {"ok": False, "message": str(exc)}
    return verification

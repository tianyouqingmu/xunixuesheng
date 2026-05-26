# AI-VS 虚拟学生腾讯云函数代理

这个目录用于部署 GitHub Pages 公开版的后端代理，结构参照 `xunibingren1`。云函数提供：

- `POST /verify` 验证腾讯云 ASR/TTS
- `POST /asr` 接收网页上传的 WAV 录音并调用腾讯云一句话识别
- `POST /tts` 接收文字并调用腾讯云实时语音合成，返回 base64 音频
- `POST /llm` 调用阿里云百炼 OpenAI 兼容接口，用于生成虚拟学生易错代码、错误原因、学习心理和课堂警示

## 环境变量

在腾讯云函数配置页添加：

```text
TENCENT_APP_ID=你的腾讯云 AppID
TENCENT_SECRET_ID=你的腾讯云 SecretId
TENCENT_SECRET_KEY=你的腾讯云 SecretKey
TENCENT_REGION=ap-shanghai
TENCENT_ASR_ENGINE_TYPE=16k_zh
TENCENT_TTS_VOICE_TYPE=1001
TENCENT_TTS_SAMPLE_RATE=16000
TENCENT_TTS_CODEC=wav
DASHSCOPE_API_KEY=你的阿里云百炼 API Key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
ALLOWED_ORIGIN=https://tianyouqingmu.github.io
```

## 前端填写

GitHub Pages 网页配置里填写：

```text
云函数代理地址：https://1419220094-exb9f6nfqz.ap-nanjing.tencentscf.com
大模型 Base URL：https://dashscope.aliyuncs.com/compatible-mode/v1
大模型 Model：qwen-plus
```

公开网页不会保存任何密钥。腾讯云 SecretKey 和百炼 API Key 只放在云函数环境变量里。

# AI-VS 虚拟学生

这是一个面向 OpenCV-Python 课堂的虚拟学生演示项目。教师讲完现实学生后，可以让虚拟学生现场“敲”一段带有粗心错误的代码，再展示运行报错、错误原因和正确写法，用来提醒真实学生避坑。

## 功能

- 复用 `F:\cx\xunibingren` 的本地网页预览框架：`web/` 前端 + `web_preview_server.py` 本地后端。
- 使用 `1.png` 作为课堂背景。
- 读取项目根目录下的 `知识库1.docx`、`知识库2.docx`。
- 内置 OpenCV 小白高频错误案例，无大模型也可课堂演示。
- 配置 OpenAI 兼容大模型后，可结合知识库动态生成新的虚拟学生易错案例，包含技术原因、学习心理和课堂警示。
- 支持腾讯云一句话识别 ASR：教师可以用语音输入课堂指令。
- 支持腾讯云实时语音合成 TTS：虚拟学生可以朗读警示内容。
- 错误代码只做模拟运行展示，不在本机真实执行。

## 启动

```powershell
cd /d F:\cx\aijiaoxue
python -m pip install -r requirements.txt
python web_preview_server.py
```

也可以双击运行：

```text
start_web_preview.bat
```

启动后打开终端显示的本地地址，通常是：

```text
http://127.0.0.1:8000
```

## 大模型与语音配置

首次运行会自动从 `.env.example` 创建 `.env`。也可以直接在网页右上角配置面板填写：

```text
LLM_API_KEY=
LLM_MODEL=qwen-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
TENCENT_APP_ID=
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
```

百炼大模型可直接使用 OpenAI 兼容接口，`LLM_BASE_URL` 填 `https://dashscope.aliyuncs.com/compatible-mode/v1`，`LLM_MODEL` 可填 `qwen-plus` 等百炼模型名。

API Key 和腾讯云密钥只保存到本机 `.env`，不会写入前端代码。

## 发布到 GitHub Pages

公开版不能把密钥写进网页。推荐方式和 `xunibingren1` 一样：

1. 将 `web/` 目录内容发布到 GitHub Pages。
2. 将 `cloud-function/` 部署到腾讯云函数。
3. 在腾讯云函数环境变量里配置 `TENCENT_*` 和 `DASHSCOPE_API_KEY`。
4. 在公开网页右上角配置里填写云函数代理地址。

`web/data/knowledge.json` 是由 `知识库1.docx`、`知识库2.docx` 生成的公开知识库数据。公开前请确认这些内容适合开源发布。

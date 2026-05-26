(function () {
  const $ = (id) => document.getElementById(id);
  const localSettingsKey = "virtualStudentSettings";
  let scenarios = StudentEngine.scenarios.map(StudentEngine.normalizeScenario);
  let currentScenario = scenarios[0];
  let typingTimer = null;
  let terminalTimer = null;
  let typedLength = 0;
  let terminalLength = 0;
  let backendAvailable = false;
  let asrAvailable = false;
  let ttsAvailable = false;
  let publicKnowledgeText = "";
  let recording = false;
  let audioContext = null;
  let mediaStream = null;
  let recorderSource = null;
  let recorderNode = null;
  let recordedBuffers = [];
  let recordedSampleRate = 16000;
  let browserRecognition = null;
  let activeAudio = null;
  let activeAudioUrl = "";
  let speechPlaying = false;
  let quizState = {
    items: [],
    fills: [],
    selected: 0,
  };

  const defaultSettings = {
    scfProxyUrl: "",
    llmBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    llmModel: "",
    llmApiKey: "",
    llmTemperature: "0.45",
    llmMaxTokens: "1800",
    autoSpeak: true,
    tencentAppId: "",
    tencentSecretId: "",
    tencentSecretKey: "",
    tencentRegion: "ap-shanghai",
    tencentAsrEngineType: "16k_zh",
    tencentAsrHotwordId: "",
    tencentTtsVoiceType: "1001",
    tencentTtsSampleRate: "16000",
    tencentTtsCodec: "wav",
    tencentTtsSpeed: "0",
    tencentTtsVolume: "0",
  };

  function html(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (item) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[item]));
  }

  function loadLocalSettings() {
    try {
      return Object.assign({}, defaultSettings, JSON.parse(localStorage.getItem(localSettingsKey) || "{}"));
    } catch (error) {
      return Object.assign({}, defaultSettings);
    }
  }

  function saveLocalSettings(settings) {
    localStorage.setItem(localSettingsKey, JSON.stringify(Object.assign({}, settings, { llmApiKey: "", tencentSecretKey: "" })));
  }

  function readSettingsForm() {
    return {
      scfProxyUrl: $("scfProxyUrl").value.trim(),
      llmBaseUrl: $("llmBaseUrl").value.trim(),
      llmModel: $("llmModel").value.trim(),
      llmApiKey: $("llmApiKey").value.trim(),
      llmTemperature: $("llmTemperature").value || "0.45",
      llmMaxTokens: $("llmMaxTokens").value || "1800",
      autoSpeak: $("autoSpeak").checked,
      tencentAppId: $("tencentAppId").value.trim(),
      tencentSecretId: $("tencentSecretId").value.trim(),
      tencentSecretKey: $("tencentSecretKey").value.trim(),
      tencentRegion: $("tencentRegion").value.trim() || "ap-shanghai",
      tencentAsrEngineType: $("tencentAsrEngineType").value.trim() || "16k_zh",
      tencentAsrHotwordId: $("tencentAsrHotwordId").value.trim(),
      tencentTtsVoiceType: $("tencentTtsVoiceType").value.trim() || "1001",
      tencentTtsSampleRate: $("tencentTtsSampleRate").value.trim() || "16000",
      tencentTtsCodec: $("tencentTtsCodec").value || "wav",
      tencentTtsSpeed: $("tencentTtsSpeed").value || "0",
      tencentTtsVolume: $("tencentTtsVolume").value || "0",
    };
  }

  function applySettings(settings) {
    $("scfProxyUrl").value = settings.scfProxyUrl || "";
    $("llmBaseUrl").value = settings.llmBaseUrl || defaultSettings.llmBaseUrl;
    $("llmModel").value = settings.llmModel || "";
    $("llmApiKey").value = settings.llmApiKey || "";
    $("llmTemperature").value = settings.llmTemperature || "0.45";
    $("llmMaxTokens").value = settings.llmMaxTokens || "1800";
    $("autoSpeak").checked = settings.autoSpeak !== false;
    $("tencentAppId").value = settings.tencentAppId || "";
    $("tencentSecretId").value = settings.tencentSecretId || "";
    $("tencentSecretKey").value = settings.tencentSecretKey || "";
    $("tencentRegion").value = settings.tencentRegion || "ap-shanghai";
    $("tencentAsrEngineType").value = settings.tencentAsrEngineType || "16k_zh";
    $("tencentAsrHotwordId").value = settings.tencentAsrHotwordId || "";
    $("tencentTtsVoiceType").value = settings.tencentTtsVoiceType || "1001";
    $("tencentTtsSampleRate").value = settings.tencentTtsSampleRate || "16000";
    $("tencentTtsCodec").value = settings.tencentTtsCodec || "wav";
    $("tencentTtsSpeed").value = settings.tencentTtsSpeed || "0";
    $("tencentTtsVolume").value = settings.tencentTtsVolume || "0";
  }

  function normalizeProxyUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function proxyEndpoint(path, settings = null) {
    const base = normalizeProxyUrl((settings || readSettingsForm()).scfProxyUrl);
    if (!base) return "";
    return `${base}/${String(path || "").replace(/^\/+/, "")}`;
  }

  function isLocalEndpoint(endpoint) {
    return String(endpoint || "").startsWith("/");
  }

  function setStatus(text) {
    $("statusText").textContent = text;
  }

  function setRunState(text, mode = "") {
    const element = $("runState");
    element.textContent = text;
    element.className = `run-state ${mode}`.trim();
  }

  function setSpeechControlsPlaying(playing) {
    speechPlaying = Boolean(playing);
    ["stopSpeakButton", "teacherStopSpeakButton", "stopWarningVoice"].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = !speechPlaying;
    });
  }

  function stopSpeech(showStatus = true) {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
    if (activeAudioUrl) {
      URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = "";
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeechControlsPlaying(false);
    if (showStatus) setStatus("朗读已停止。");
  }

  function setVerifyStatus(text, ok = null) {
    const element = $("verifyStatus");
    element.textContent = text;
    element.classList.toggle("ok", ok === true);
    element.classList.toggle("error", ok === false);
  }

  function stopTimers() {
    if (typingTimer) window.clearTimeout(typingTimer);
    if (terminalTimer) window.clearTimeout(terminalTimer);
    typingTimer = null;
    terminalTimer = null;
    $("studentFigure").classList.remove("typing");
  }

  function scenarioOptions(lessonValue = $("lessonSelect").value) {
    const lesson = lessonValue;
    return scenarios.filter((item) => item.lesson === lesson);
  }

  function renderLessonSelect() {
    const lessons = Array.from(new Set(scenarios.map((item) => item.lesson)));
    const markup = lessons.map((lesson) => `<option value="${html(lesson)}">${html(lesson)}</option>`).join("");
    $("lessonSelect").innerHTML = markup;
  }

  function renderMistakeSelect(selectedId = "") {
    const options = scenarioOptions();
    const markup = options.map((item) => (
      `<option value="${html(item.id)}">${html(item.mistake)}</option>`
    )).join("");
    $("mistakeSelect").innerHTML = markup;
    if (selectedId && options.some((item) => item.id === selectedId)) {
      $("mistakeSelect").value = selectedId;
    }
  }

  function renderScenario(scenario) {
    currentScenario = StudentEngine.normalizeScenario(scenario);
    stopTimers();
    stopSpeech(false);
    typedLength = 0;
    terminalLength = 0;
    $("codeText").textContent = "";
    $("terminalOutput").textContent = "";
    $("correctCode").textContent = currentScenario.correctCode || "";
    $("scenarioTitle").textContent = currentScenario.title;
    $("studentBadge").textContent = currentScenario.studentName;
    $("lessonBrief").textContent = currentScenario.lesson;
    $("mistakeBrief").textContent = currentScenario.mistake;
    $("tagRow").innerHTML = (currentScenario.tags || []).map((tag) => `<span>${html(tag)}</span>`).join("");
    $("warningText").textContent = "演示运行后显示。";
    $("whyText").textContent = "-";
    $("mindsetText").textContent = "-";
    $("fixText").textContent = "-";
    setRunState("待开始");
    setStatus(`${currentScenario.lesson} · ${currentScenario.mistake}`);
  }

  function selectCurrentFromControls() {
    const selected = scenarios.find((item) => item.id === $("mistakeSelect").value) || scenarioOptions()[0] || scenarios[0];
    renderScenario(selected);
  }

  function typeCode() {
    stopTimers();
    typedLength = 0;
    $("codeText").textContent = "";
    $("terminalOutput").textContent = "";
    $("studentFigure").classList.add("typing");
    setRunState("敲代码中", "busy");
    setStatus(`${currentScenario.studentName} 正在敲代码...`);

    const code = currentScenario.code || "";
    const tick = () => {
      const step = Math.max(1, Math.min(5, Math.ceil(code.length / 120)));
      typedLength = Math.min(code.length, typedLength + step);
      $("codeText").textContent = code.slice(0, typedLength);
      if (typedLength < code.length) {
        typingTimer = window.setTimeout(tick, 18);
      } else {
        typingTimer = null;
        $("studentFigure").classList.remove("typing");
        setRunState("可运行", "ready");
        setStatus("代码已敲完，准备运行。");
      }
    };
    tick();
  }

  function typeTerminal() {
    if ((currentScenario.code || "") && $("codeText").textContent.length < currentScenario.code.length) {
      $("codeText").textContent = currentScenario.code;
      typedLength = currentScenario.code.length;
    }
    if (terminalTimer) window.clearTimeout(terminalTimer);
    terminalLength = 0;
    $("terminalOutput").textContent = "";
    setRunState("运行中", "busy");
    setStatus("正在运行 student_demo.py...");

    const output = currentScenario.terminal || "";
    const tick = () => {
      const step = Math.max(1, Math.min(8, Math.ceil(output.length / 80)));
      terminalLength = Math.min(output.length, terminalLength + step);
      $("terminalOutput").textContent = output.slice(0, terminalLength);
      if (terminalLength < output.length) {
        terminalTimer = window.setTimeout(tick, 24);
      } else {
        terminalTimer = null;
        setRunState("已暴露错误", "error");
        setStatus("错误已经出现，可以切换到警示。");
      }
    };
    tick();
  }

  function revealExplanation() {
    $("warningText").textContent = currentScenario.warning || "请核对知识库中的正确写法。";
    $("whyText").textContent = currentScenario.why || "-";
    $("mindsetText").textContent = currentScenario.mindset || "这类错误通常来自急着运行、默认输入一定正确，忽略了返回值和边界检查。";
    $("fixText").textContent = currentScenario.fix || "-";
    $("correctCode").textContent = currentScenario.correctCode || "";
    setRunState("已警示", "ready");
    setStatus("课堂警示已显示。");
    if (readSettingsForm().autoSpeak) {
      speakCurrentWarning();
    }
  }

  function clearTerminal() {
    if (terminalTimer) window.clearTimeout(terminalTimer);
    terminalTimer = null;
    $("terminalOutput").textContent = "";
    setRunState($("codeText").textContent ? "可运行" : "待开始", $("codeText").textContent ? "ready" : "");
  }

  async function loadPublicKnowledge() {
    try {
      const response = await fetch("./data/knowledge.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const chunks = data.chunks || [];
      publicKnowledgeText = chunks.slice(0, 8).map((chunk) => `【${chunk.source}】\n${chunk.text}`).join("\n\n");
      const files = data.files || [];
      $("knowledgeStatus").textContent = files.length ? `${files.map((item) => `${item.name}(${item.paragraphs})`).join("、")} · ${chunks.length} 个片段` : "已加载公开知识库";
    } catch (error) {
      publicKnowledgeText = "";
      $("knowledgeStatus").textContent = `公开知识库读取失败：${error.message}`;
    }
  }

  function scenarioMessages() {
    const knowledge = publicKnowledgeText || [
      "OpenCV-Python 小白常见错误：imread 读取失败返回 None、imshow 后漏 waitKey、坐标 x/y 与数组 y/x 混淆、calcHist 参数漏方括号、findContours 返回值版本差异。",
      "演示要包含错误代码、运行报错或异常现象、技术原因、学习心理/认知误区、正确写法和课堂警示。",
    ].join("\n");
    return [
      {
        role: "system",
        content: [
          "你是计算机视觉课堂的虚拟学生编剧。",
          "你要基于知识库设计一个课堂投屏演示：虚拟学生故意写出一个小白常见错误，运行后出现报错或明显异常，再给现实学生一个精准警示。",
          "输出必须是 JSON 对象，不要 Markdown，不要 JSON 之外的内容。",
          "学习心理只能写学习习惯、认知误区、注意力分配、照抄代码等课堂层面的分析，不要做医学或人格诊断。",
        ].join(""),
      },
      {
        role: "user",
        content: [
          `知识库摘录：\n${knowledge}`,
          `教师刚讲完的内容：\n${$("lessonPrompt").value || "OpenCV-Python 易错点"}`,
          `当前参考案例：\n${JSON.stringify(currentScenario, null, 2).slice(0, 1800)}`,
          "请输出字段：studentName,title,lesson,mistake,code,terminal,why,mindset,fix,correctCode,warning,tags。",
          "错误必须真实、常见、可教学；代码不要执行危险操作；代码尽量 12 到 28 行；terminal 必须与错误代码对应。",
        ].join("\n\n"),
      },
    ];
  }

  function parseScenarioText(text) {
    let raw = String(text || "").trim();
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    try {
      return JSON.parse(raw);
    } catch (error) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw error;
      return JSON.parse(match[0]);
    }
  }

  async function generateScenarioViaProxy(settings) {
    const endpoint = proxyEndpoint("llm", settings);
    if (!endpoint) {
      throw new Error("公开版需要先填写云函数代理地址。");
    }
    if (!publicKnowledgeText) await loadPublicKnowledge();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.llmModel || undefined,
        messages: scenarioMessages(),
        temperature: Number(settings.llmTemperature || 0.45),
        max_tokens: Number(settings.llmMaxTokens || 1800),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    const text = data.answer || data.text || data.content || "";
    if (!text) throw new Error("云函数大模型没有返回内容。");
    return StudentEngine.normalizeScenario(parseScenarioText(text));
  }

  async function loadBackendSettings() {
    applySettings(loadLocalSettings());
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      backendAvailable = true;
      const llm = data.llm || {};
      const tencent = data.tencent || {};
      asrAvailable = Boolean(tencent.asrReady);
      ttsAvailable = Boolean(tencent.ttsReady);
      applySettings(Object.assign(loadLocalSettings(), {
        llmBaseUrl: llm.baseUrl || defaultSettings.llmBaseUrl,
        llmModel: llm.model || "",
        llmApiKey: "",
        llmTemperature: String(llm.temperature || "0.45"),
        llmMaxTokens: String(llm.maxTokens || "1800"),
        tencentAppId: tencent.appId || "",
        tencentSecretId: tencent.secretId || "",
        tencentSecretKey: "",
        tencentRegion: tencent.region || "ap-shanghai",
        tencentAsrEngineType: tencent.asrEngineType || "16k_zh",
        tencentAsrHotwordId: tencent.asrHotwordId || "",
        tencentTtsVoiceType: String(tencent.ttsVoiceType || "1001"),
        tencentTtsSampleRate: String(tencent.ttsSampleRate || "16000"),
        tencentTtsCodec: tencent.ttsCodec || "wav",
        tencentTtsSpeed: String(tencent.ttsSpeed || "0"),
        tencentTtsVolume: String(tencent.ttsVolume || "0"),
      }));
      const knowledge = data.knowledge || {};
      const files = knowledge.files || [];
      const loaded = files.filter((item) => item.exists).map((item) => `${item.name}(${item.paragraphs})`);
      $("knowledgeStatus").textContent = loaded.length ? `${loaded.join("、")} · ${knowledge.chunks || 0} 个片段` : "未读取到知识库";
      $("cloudStatus").textContent = `${llm.ready ? "大模型已配置" : "大模型待配置"} · ${llm.apiKeySet ? "API Key 已保存" : "API Key 未保存"} · ${tencent.asrReady ? "ASR 已配置" : "ASR 待配置"} · ${tencent.ttsReady ? "TTS 已配置" : "TTS 待配置"}`;
      setVerifyStatus(llm.ready ? "可以从知识库动态生成案例。本地模式可直接调用语音接口。" : "未配置大模型时使用内置易错案例。", llm.ready ? true : null);
    } catch (error) {
      backendAvailable = false;
      asrAvailable = false;
      ttsAvailable = false;
      await loadPublicKnowledge();
      $("cloudStatus").textContent = proxyEndpoint("verify") ? "公开网页模式：将通过云函数代理调用语音和大模型" : "公开网页模式：未填写云函数代理地址";
      setVerifyStatus(proxyEndpoint("verify") ? "公开版配置已读取。语音和大模型请求会走云函数代理。" : `本地后端未连接：${error.message}。公开版请填写云函数代理地址。`, proxyEndpoint("verify") ? null : false);
    }
  }

  async function saveSettings() {
    const settings = readSettingsForm();
    saveLocalSettings(settings);
    setVerifyStatus("正在保存配置...", null);
    if (!backendAvailable) {
      $("llmApiKey").value = "";
      $("tencentSecretKey").value = "";
      $("cloudStatus").textContent = proxyEndpoint("verify", settings) ? "公开网页模式：已配置云函数代理" : "公开网页模式：未填写云函数代理地址";
      setVerifyStatus("配置已保存到本机浏览器。公开版不会保存 API Key 或腾讯云密钥，请把密钥配置在云函数环境变量中。", null);
      return;
    }
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        llm: {
          baseUrl: settings.llmBaseUrl,
          model: settings.llmModel,
          apiKey: settings.llmApiKey,
          temperature: settings.llmTemperature,
          maxTokens: settings.llmMaxTokens,
        },
        tencent: {
          appId: settings.tencentAppId,
          secretId: settings.tencentSecretId,
          secretKey: settings.tencentSecretKey,
          region: settings.tencentRegion,
          asrEngineType: settings.tencentAsrEngineType,
          asrHotwordId: settings.tencentAsrHotwordId,
          ttsVoiceType: settings.tencentTtsVoiceType,
          ttsSampleRate: settings.tencentTtsSampleRate,
          ttsCodec: settings.tencentTtsCodec,
          ttsSpeed: settings.tencentTtsSpeed,
          ttsVolume: settings.tencentTtsVolume,
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    $("llmApiKey").value = "";
    $("tencentSecretKey").value = "";
    setVerifyStatus(data.ready ? "配置已保存，大模型可用。" : "配置已保存，但模型名或 API Key 仍为空。", data.ready ? true : null);
    $("cloudStatus").textContent = `${data.ready ? "大模型已配置" : "大模型待配置"} · ${data.apiKeySet ? "API Key 已保存" : "API Key 未保存"} · ${data.asrReady ? "ASR 已配置" : "ASR 待配置"} · ${data.ttsReady ? "TTS 已配置" : "TTS 待配置"}`;
    asrAvailable = Boolean(data.asrReady);
    ttsAvailable = Boolean(data.ttsReady);
  }

  async function generateScenario() {
    const settings = readSettingsForm();
    $("generateScenario").disabled = true;
    setStatus("正在根据知识库生成易错案例...");
    setVerifyStatus("正在调用大模型生成案例...", null);
    try {
      let scenario;
      let source = "知识库 + 大模型";
      if (proxyEndpoint("llm", settings)) {
        scenario = await generateScenarioViaProxy(settings);
        source = "公开知识库 + 云函数大模型";
      } else if (backendAvailable) {
        const response = await fetch("/api/generate-scenario", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonGoal: $("lessonPrompt").value,
            selectedScenario: currentScenario,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        scenario = StudentEngine.normalizeScenario(data.scenario);
        source = data.source || source;
      } else {
        scenario = await generateScenarioViaProxy(settings);
        source = "公开知识库 + 云函数大模型";
      }
      scenarios = scenarios.filter((item) => item.id !== scenario.id).concat([scenario]);
      renderLessonSelect();
      $("lessonSelect").value = scenario.lesson;
      renderMistakeSelect(scenario.id);
      $("mistakeSelect").value = scenario.id;
      renderScenario(scenario);
      setVerifyStatus(`${source} 已生成案例。`, true);
    } catch (error) {
      setVerifyStatus(`生成失败：${error.message}`, false);
      setStatus("生成失败，已保留当前内置案例。");
    } finally {
      $("generateScenario").disabled = false;
    }
  }

  function playAudioBase64(base64Audio, contentType = "audio/wav") {
    stopSpeech(false);
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    const audio = new Audio(url);
    activeAudio = audio;
    activeAudioUrl = url;
    setSpeechControlsPlaying(true);
    const cleanup = () => {
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioUrl === url) activeAudioUrl = "";
      URL.revokeObjectURL(url);
      setSpeechControlsPlaying(false);
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  }

  function fallbackBrowserSpeak(text) {
    if (!("speechSynthesis" in window) || !text) return;
    stopSpeech(false);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeechControlsPlaying(false);
    utterance.onerror = () => setSpeechControlsPlaying(false);
    setSpeechControlsPlaying(true);
    window.speechSynthesis.speak(utterance);
  }

  async function speakText(text) {
    const speechText = String(text || "").trim();
    if (!speechText) return;
    const settings = readSettingsForm();
    const endpoint = proxyEndpoint("tts", settings) || (backendAvailable && ttsAvailable ? "/api/tts" : "");
    if (!endpoint) {
      setStatus("未配置语音代理，正在使用浏览器朗读。");
      fallbackBrowserSpeak(speechText);
      return;
    }
    try {
      setStatus(isLocalEndpoint(endpoint) ? "正在调用腾讯云 TTS..." : "正在通过云函数调用腾讯云 TTS...");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: speechText }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
      if (data.audioBase64) {
        playAudioBase64(data.audioBase64, data.contentType || "audio/wav");
      } else {
        fallbackBrowserSpeak(speechText);
      }
      setStatus(`语音合成完成 · ${data.voiceLabel || "TTS"}`);
    } catch (error) {
      setStatus(`腾讯云 TTS 未完成：${error.message}；已尝试浏览器朗读。`);
      fallbackBrowserSpeak(speechText);
    }
  }

  function speakCurrentWarning() {
    const text = [
      currentScenario.warning,
      currentScenario.why ? `错误原因：${currentScenario.why}` : "",
      currentScenario.mindset ? `学习心理：${currentScenario.mindset}` : "",
      currentScenario.fix ? `修改方法：${currentScenario.fix}` : "",
    ].filter(Boolean).join("。");
    speakText(text);
  }

  function getBrowserRecognitionConstructor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function startBrowserVoice() {
    const Recognition = getBrowserRecognitionConstructor();
    if (!Recognition) {
      throw new Error("当前浏览器不支持语音识别，请改用文字输入或配置腾讯云语音代理。");
    }
    browserRecognition = new Recognition();
    browserRecognition.lang = "zh-CN";
    browserRecognition.continuous = false;
    browserRecognition.interimResults = false;
    browserRecognition.onstart = () => {
      recording = true;
      $("voiceButton").classList.add("active");
      setStatus("正在使用浏览器语音识别，再点一次结束。");
    };
    browserRecognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0] && result[0].transcript ? result[0].transcript : "")
        .join("")
        .trim();
      if (!transcript) return;
      $("lessonPrompt").value = transcript;
      setStatus(`语音指令：${transcript}`);
    };
    browserRecognition.onerror = (event) => {
      setStatus(`浏览器语音识别失败：${event.error || "未知错误"}`);
    };
    browserRecognition.onend = () => {
      recording = false;
      browserRecognition = null;
      $("voiceButton").classList.remove("active");
    };
    browserRecognition.start();
  }

  function stopBrowserVoice() {
    if (browserRecognition) browserRecognition.stop();
  }

  function flattenBuffers(buffers) {
    const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const result = new Float32Array(length);
    let offset = 0;
    buffers.forEach((buffer) => {
      result.set(buffer, offset);
      offset += buffer.length;
    });
    return result;
  }

  function writeString(view, offset, value) {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  }

  function encodeWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, samples.length * bytesPerSample, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i += 1, offset += 2) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([view], { type: "audio/wav" });
  }

  async function startTencentRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风录音。");
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    recordedSampleRate = audioContext.sampleRate;
    recordedBuffers = [];
    recorderSource = audioContext.createMediaStreamSource(mediaStream);
    recorderNode = audioContext.createScriptProcessor(4096, 1, 1);
    recorderNode.onaudioprocess = (event) => {
      if (!recording) return;
      recordedBuffers.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    recorderSource.connect(recorderNode);
    recorderNode.connect(audioContext.destination);
    recording = true;
    $("voiceButton").classList.add("active");
    setStatus("正在录音，再点一次结束并识别。");
  }

  async function stopTencentRecording() {
    const settings = readSettingsForm();
    const endpoint = proxyEndpoint("asr", settings) || (backendAvailable && asrAvailable ? "/api/asr" : "");
    recording = false;
    $("voiceButton").classList.remove("active");
    try {
      if (recorderNode) recorderNode.disconnect();
      if (recorderSource) recorderSource.disconnect();
      if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
      if (audioContext) await audioContext.close();
      const wavBlob = encodeWav(flattenBuffers(recordedBuffers), recordedSampleRate);
      if (wavBlob.size <= 44) throw new Error("没有录到有效声音。");
      const form = new FormData();
      form.append("audio", wavBlob, "instruction.wav");
      setStatus(isLocalEndpoint(endpoint) ? "正在调用腾讯云 ASR..." : "正在通过云函数调用腾讯云 ASR...");
      const response = await fetch(endpoint, { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
      $("lessonPrompt").value = data.transcript || "";
      setStatus(`语音指令：${data.transcript}`);
    } finally {
      audioContext = null;
      mediaStream = null;
      recorderSource = null;
      recorderNode = null;
      recordedBuffers = [];
    }
  }

  async function toggleVoiceInput() {
    try {
      const settings = readSettingsForm();
      const hasTencentRoute = Boolean(proxyEndpoint("asr", settings) || (backendAvailable && asrAvailable));
      if (!hasTencentRoute) {
        if (recording) stopBrowserVoice();
        else startBrowserVoice();
        return;
      }
      if (recording) await stopTencentRecording();
      else await startTencentRecording();
    } catch (error) {
      recording = false;
      $("voiceButton").classList.remove("active");
      setStatus(`语音指令失败：${error.message}`);
    }
  }

  async function verifyTencentConnection() {
    const settings = readSettingsForm();
    const endpoint = proxyEndpoint("verify", settings) || (backendAvailable ? "/api/verify-tencent" : "");
    if (!endpoint) {
      setVerifyStatus("请先填写云函数代理地址，或在本地运行 Python 后端。", false);
      return;
    }
    setVerifyStatus("正在验证腾讯云语音连接...", null);
    const response = await fetch(endpoint, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      if (data.verification) renderVerification(data.verification);
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    renderVerification(data.verification);
  }

  function renderVerification(verification) {
    const asr = verification && verification.asr ? verification.asr : {};
    const tts = verification && verification.tts ? verification.tts : {};
    const ok = Boolean(asr.ok && tts.ok);
    setVerifyStatus(`ASR：${asr.message || "未验证"}\nTTS：${tts.message || "未验证"}`, ok);
    if (tts.audioBase64) playAudioBase64(tts.audioBase64, tts.contentType || "audio/wav");
  }

  function shuffle(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function currentQuizTemplate() {
    const scenarioText = [
      currentScenario.id,
      currentScenario.title,
      currentScenario.lesson,
      currentScenario.mistake,
      (currentScenario.tags || []).join(" "),
    ].join(" ").toLowerCase();

    if (scenarioText.includes("blur") || scenarioText.includes("均值模糊") || scenarioText.includes("destroyallwindows")) {
      return {
        title: "均值模糊 · 窗口函数填空",
        rule: "把 OpenCV 窗口函数补完整，别让引号、大小写和拼写偷袭你。",
        items: [
          { before: "显示原图：cv2.imshow(", answer: "\"img\", img", after: ")" },
          { before: "等待按键：cv2.", answer: "waitKey", after: "(0)" },
          { before: "关闭窗口：cv2.", answer: "destroyAllWindows", after: "()" },
        ],
        extras: ["\"img,img\"", "waitkey", "destoryAllWindow", "destroyAllWindow"],
      };
    }

    if (scenarioText.includes("imread") || scenarioText.includes("none")) {
      return {
        title: "图像读取 · 判空填空",
        rule: "读图失败先判空，不要等 shape 替你报错。",
        items: [
          { before: "读取图片：img = cv2.", answer: "imread", after: "(img_path)" },
          { before: "判空条件：if img is ", answer: "None", after: ":" },
          { before: "中文路径可优先：cv2.", answer: "imdecode", after: "(np.fromfile(...), cv2.IMREAD_COLOR)" },
        ],
        extras: ["shape", "imrode", "is not None", "imshow"],
      };
    }

    if (scenarioText.includes("findcontours") || scenarioText.includes("轮廓")) {
      return {
        title: "轮廓检测 · 返回值填空",
        rule: "OpenCV 4 的 findContours 返回两个值，旧代码要小心。",
        items: [
          { before: "OpenCV 4 返回：", answer: "contours, hierarchy", after: " = cv2.findContours(...)" },
          { before: "不要写成三个值：image, ", answer: "contours", after: ", hierarchy" },
          { before: "报错关键词：expected 3, got ", answer: "2", after: "" },
        ],
        extras: ["image, contours, hierarchy", "3", "result", "img"],
      };
    }

    if (scenarioText.includes("roi") || scenarioText.includes("coordinate")) {
      return {
        title: "ROI 坐标 · 顺序填空",
        rule: "数组切片先行后列，图像坐标先 x 后 y，两个体系别混。",
        items: [
          { before: "正确 ROI：roi = img[", answer: "y1:y2, x1:x2", after: "]" },
          { before: "数组第一维代表：", answer: "y / 行", after: "" },
          { before: "数组第二维代表：", answer: "x / 列", after: "" },
        ],
        extras: ["x1:x2, y1:y2", "x / 行", "y / 列", "w:h"],
      };
    }

    if (scenarioText.includes("calchist") || scenarioText.includes("直方图")) {
      return {
        title: "直方图 · 方括号填空",
        rule: "calcHist 的通道、bins 和范围都要用列表包起来。",
        items: [
          { before: "通道参数：", answer: "[0]", after: "" },
          { before: "bins 参数：", answer: "[256]", after: "" },
          { before: "范围参数：", answer: "[0, 256]", after: "" },
        ],
        extras: ["0", "256", "0, 256", "(0, 256)"],
      };
    }

    return {
      title: "当前案例 · 易错填空",
      rule: "根据当前课堂警示，把关键修正点补完整。",
      items: [
        { before: "错误原因要先看：", answer: "报错位置", after: "" },
        { before: "修正前先核对：", answer: "函数名和参数", after: "" },
        { before: "最后再运行：", answer: "正确写法", after: "" },
      ],
      extras: ["只看结果", "随便复制", "跳过检查", "猜一个参数"],
    };
  }

  function buildQuiz() {
    const template = currentQuizTemplate();
    const answers = template.items.map((item) => item.answer);
    const choices = shuffle(Array.from(new Set(answers.concat(template.extras || []))));
    quizState = {
      title: template.title,
      rule: template.rule,
      items: template.items,
      choices,
      fills: template.items.map(() => ""),
      selected: 0,
      checked: false,
    };
  }

  function setQuizMessage(text, mode = "") {
    const element = $("quizMessage");
    element.textContent = text;
    element.className = `quiz-message ${mode}`.trim();
  }

  function renderQuiz() {
    $("quizTitle").textContent = quizState.title || "易错填空挑战";
    $("quizRule").textContent = quizState.rule || "点一个空格，再点下方选项填入。";
    $("quizLines").innerHTML = quizState.items.map((item, index) => {
      const fill = quizState.fills[index] || "";
      const stateClass = quizState.checked
        ? (fill === item.answer ? "correct" : "wrong")
        : (quizState.selected === index ? "selected" : "");
      return [
        `<div class="quiz-line">`,
        `<span>${html(item.before)}</span>`,
        `<button class="quiz-blank ${fill ? "" : "empty"} ${stateClass}" type="button" data-quiz-blank="${index}">${html(fill || "点击填空")}</button>`,
        `<span>${html(item.after || "")}</span>`,
        `</div>`,
      ].join("");
    }).join("");
    $("quizChoices").innerHTML = quizState.choices.map((choice) => (
      `<button class="quiz-choice" type="button" data-quiz-choice="${html(choice)}">${html(choice)}</button>`
    )).join("");

    document.querySelectorAll("[data-quiz-blank]").forEach((button) => {
      button.addEventListener("click", () => {
        quizState.selected = Number(button.dataset.quizBlank || 0);
        quizState.checked = false;
        renderQuiz();
        setQuizMessage("已选中空格，点一个选项填进去。");
      });
    });
    document.querySelectorAll("[data-quiz-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        quizState.fills[quizState.selected] = button.dataset.quizChoice || "";
        quizState.checked = false;
        const nextEmpty = quizState.fills.findIndex((item) => !item);
        if (nextEmpty >= 0) quizState.selected = nextEmpty;
        renderQuiz();
        setQuizMessage(nextEmpty >= 0 ? "继续补下一个空。" : "都填完了，可以检查答案。", nextEmpty >= 0 ? "" : "good");
      });
    });
  }

  function openQuiz() {
    buildQuiz();
    $("quizOverlay").hidden = false;
    renderQuiz();
    setQuizMessage("先选中一个空格。");
  }

  function closeQuiz() {
    $("quizOverlay").hidden = true;
  }

  function resetQuiz() {
    quizState.fills = quizState.items.map(() => "");
    quizState.selected = 0;
    quizState.checked = false;
    renderQuiz();
    setQuizMessage("已重置，重新填一遍。");
  }

  function checkQuiz() {
    quizState.checked = true;
    renderQuiz();
    const emptyCount = quizState.fills.filter((item) => !item).length;
    const wrongCount = quizState.items.filter((item, index) => quizState.fills[index] !== item.answer).length;
    if (emptyCount) {
      setQuizMessage(`还有 ${emptyCount} 个空没填。`, "bad");
    } else if (wrongCount) {
      setQuizMessage(`还有 ${wrongCount} 个地方不对，看看红色空格。`, "bad");
    } else {
      setQuizMessage("全部正确，可以开始敲代码了。", "good");
    }
  }

  function initControls() {
    renderLessonSelect();
    $("lessonSelect").value = scenarios[0].lesson;
    renderMistakeSelect(scenarios[0].id);
    renderScenario(scenarios[0]);

    $("lessonSelect").addEventListener("change", () => {
      renderMistakeSelect();
      selectCurrentFromControls();
    });
    $("mistakeSelect").addEventListener("change", selectCurrentFromControls);
    $("typeButton").addEventListener("click", typeCode);
    $("runButton").addEventListener("click", typeTerminal);
    $("explainButton").addEventListener("click", revealExplanation);
    $("quizButton").addEventListener("click", openQuiz);
    $("voiceButton").addEventListener("click", toggleVoiceInput);
    $("speakButton").addEventListener("click", speakCurrentWarning);
    $("stopSpeakButton").addEventListener("click", () => stopSpeech());
    $("stopWarningVoice").addEventListener("click", () => stopSpeech());
    $("resetButton").addEventListener("click", () => renderScenario(currentScenario));
    $("clearTerminal").addEventListener("click", clearTerminal);
    $("quizClose").addEventListener("click", closeQuiz);
    $("quizReset").addEventListener("click", resetQuiz);
    $("quizCheck").addEventListener("click", checkQuiz);
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("quizOverlay").hidden) closeQuiz();
    });
    $("copyCorrect").addEventListener("click", () => {
      stopTimers();
      $("codeText").textContent = currentScenario.correctCode || "";
      setRunState("已替换为正确写法", "ready");
      setStatus("正确写法已放入编辑器。");
    });
    $("settingsToggle").addEventListener("click", () => {
      $("settingsPanel").hidden = !$("settingsPanel").hidden;
    });
    $("settingsClose").addEventListener("click", () => {
      $("settingsPanel").hidden = true;
    });
    $("saveSettings").addEventListener("click", async () => {
      try {
        await saveSettings();
      } catch (error) {
        setVerifyStatus(`保存失败：${error.message}`, false);
      }
    });
    $("verifyTencent").addEventListener("click", async () => {
      try {
        await verifyTencentConnection();
      } catch (error) {
        setVerifyStatus(`验证失败：${error.message}`, false);
      }
    });
    $("generateScenario").addEventListener("click", generateScenario);
  }

  initControls();
  loadBackendSettings();
})();

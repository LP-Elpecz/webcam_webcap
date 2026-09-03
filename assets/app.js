"use strict";

const elements = {
  cameraStatus: document.querySelector("#cameraStatus"),
  cameraSelect: document.querySelector("#cameraSelect"),
  resolutionSelect: document.querySelector("#resolutionSelect"),
  fpsSelect: document.querySelector("#fpsSelect"),
  refreshDevicesButton: document.querySelector("#refreshDevicesButton"),
  openCameraButton: document.querySelector("#openCameraButton"),
  closeCameraButton: document.querySelector("#closeCameraButton"),
  sourceVideo: document.querySelector("#sourceVideo"),
  previewCanvas: document.querySelector("#previewCanvas"),
  emptyState: document.querySelector("#emptyState"),
  resolutionStat: document.querySelector("#resolutionStat"),
  fpsStat: document.querySelector("#fpsStat"),
  zoomStat: document.querySelector("#zoomStat"),
  codecStat: document.querySelector("#codecStat"),
  zoomModeInputs: [...document.querySelectorAll('input[name="zoomMode"]')],
  driverZoomField: document.querySelector("#driverZoomField"),
  softwareZoomField: document.querySelector("#softwareZoomField"),
  driverZoom: document.querySelector("#driverZoom"),
  driverZoomValue: document.querySelector("#driverZoomValue"),
  softwareZoom: document.querySelector("#softwareZoom"),
  softwareZoomValue: document.querySelector("#softwareZoomValue"),
  zoomHelp: document.querySelector("#zoomHelp"),
  filenameInput: document.querySelector("#filenameInput"),
  filenameExtension: document.querySelector("#filenameExtension"),
  startRecordingButton: document.querySelector("#startRecordingButton"),
  stopRecordingButton: document.querySelector("#stopRecordingButton"),
  saveRecordingButton: document.querySelector("#saveRecordingButton"),
  recordIndicator: document.querySelector("#recordIndicator"),
  recordTimer: document.querySelector("#recordTimer"),
  playbackPanel: document.querySelector("#playbackPanel"),
  playbackVideo: document.querySelector("#playbackVideo"),
  recordingSize: document.querySelector("#recordingSize"),
  toast: document.querySelector("#toast"),
};

const state = {
  cameraStream: null,
  cameraTrack: null,
  renderFrameId: null,
  zoomMode: "driver",
  driverZoomSupported: false,
  driverZoomNeutral: 1,
  mediaRecorder: null,
  recordingStream: null,
  recordingChunks: [],
  recordingBlob: null,
  recordingUrl: null,
  recordingStartedAt: 0,
  timerId: null,
  mimeType: "",
  extension: "",
  toastTimerId: null,
  zoomRequestId: 0,
};

function setCameraStatus(message, kind = "idle") {
  elements.cameraStatus.dataset.state = kind;
  elements.cameraStatus.lastElementChild.textContent = message;
}

function showToast(message, kind = "info") {
  window.clearTimeout(state.toastTimerId);
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.hidden = false;
  state.toastTimerId = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 4200);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function timestampName() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `webcam_${parts.join("")}`;
}

function safeFilename(value) {
  const cleaned = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/[. ]+$/g, "");
  return cleaned || timestampName();
}

function selectedResolution() {
  const [width, height] = elements.resolutionSelect.value.split("x").map(Number);
  return { width, height };
}

function currentSoftwareZoom() {
  return state.zoomMode === "software" ? Number(elements.softwareZoom.value) : 1;
}

function updateZoomStat() {
  const value = state.zoomMode === "software"
    ? Number(elements.softwareZoom.value)
    : (state.cameraTrack?.getSettings().zoom ?? state.driverZoomNeutral);
  elements.zoomStat.textContent = `${Number(value).toFixed(1)}× · ${state.zoomMode === "software" ? "软件" : "驱动"}`;
}

async function listCameras(preferredDeviceId = "") {
  if (!navigator.mediaDevices?.enumerateDevices) {
    elements.cameraSelect.innerHTML = '<option value="">当前浏览器不支持摄像头 API</option>';
    return;
  }
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === "videoinput");
  const previous = preferredDeviceId || elements.cameraSelect.value;
  elements.cameraSelect.replaceChildren();
  if (!devices.length) {
    const option = new Option("未发现摄像头，请先允许权限", "");
    elements.cameraSelect.add(option);
    return;
  }
  devices.forEach((device, index) => {
    elements.cameraSelect.add(new Option(device.label || `摄像头 ${index + 1}`, device.deviceId));
  });
  if (devices.some((device) => device.deviceId === previous)) {
    elements.cameraSelect.value = previous;
  }
}

function buildCameraConstraints(requestZoomPermission) {
  const { width, height } = selectedResolution();
  const video = {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: Number(elements.fpsSelect.value) },
  };
  if (elements.cameraSelect.value) {
    video.deviceId = { exact: elements.cameraSelect.value };
  }
  if (requestZoomPermission) {
    // W3C Image Capture 规定：请求非 false 的 zoom 约束可触发摄像头 PTZ 权限。
    video.zoom = true;
  }
  return { video, audio: false };
}

async function getCameraStream() {
  const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? {};
  if (supported.zoom) {
    try {
      return await navigator.mediaDevices.getUserMedia(buildCameraConstraints(true));
    } catch (error) {
      // 有些浏览器识别 zoom 能力却不接受布尔权限约束；回退后仍可正常录像。
      if (!["TypeError", "OverconstrainedError", "NotAllowedError"].includes(error.name)) throw error;
    }
  }
  return navigator.mediaDevices.getUserMedia(buildCameraConstraints(false));
}

function stopRenderLoop() {
  if (state.renderFrameId !== null) {
    cancelAnimationFrame(state.renderFrameId);
    state.renderFrameId = null;
  }
}

function renderPreviewFrame() {
  const video = elements.sourceVideo;
  const canvas = elements.previewCanvas;
  if (!state.cameraStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    state.renderFrameId = requestAnimationFrame(renderPreviewFrame);
    return;
  }
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (sourceWidth && sourceHeight && (canvas.width !== sourceWidth || canvas.height !== sourceHeight)) {
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
  }
  const zoom = currentSoftwareZoom();
  const cropWidth = sourceWidth / zoom;
  const cropHeight = sourceHeight / zoom;
  const sourceX = (sourceWidth - cropWidth) / 2;
  const sourceY = (sourceHeight - cropHeight) / 2;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  state.renderFrameId = requestAnimationFrame(renderPreviewFrame);
}

function configureDriverZoom() {
  const capabilities = state.cameraTrack?.getCapabilities?.() ?? {};
  const zoom = capabilities.zoom;
  const validRange = zoom && Number.isFinite(zoom.min) && Number.isFinite(zoom.max) && zoom.max > zoom.min;
  state.driverZoomSupported = Boolean(validRange);
  elements.driverZoom.disabled = !validRange || state.zoomMode !== "driver";
  if (!validRange) {
    state.driverZoomNeutral = 1;
    elements.driverZoom.min = "1";
    elements.driverZoom.max = "1";
    elements.driverZoom.value = "1";
    elements.driverZoomValue.textContent = "不支持";
    elements.zoomHelp.textContent = "该摄像头或浏览器没有公开驱动变焦能力；请选择“软件变焦”。";
    elements.zoomHelp.dataset.kind = "warning";
    updateZoomStat();
    return;
  }
  const settings = state.cameraTrack.getSettings();
  const step = Number.isFinite(zoom.step) && zoom.step > 0 ? zoom.step : Math.max((zoom.max - zoom.min) / 100, 0.1);
  const neutral = Math.min(zoom.max, Math.max(zoom.min, 1));
  const current = Number.isFinite(settings.zoom) ? settings.zoom : neutral;
  state.driverZoomNeutral = neutral;
  elements.driverZoom.min = String(zoom.min);
  elements.driverZoom.max = String(zoom.max);
  elements.driverZoom.step = String(step);
  elements.driverZoom.value = String(current);
  elements.driverZoomValue.textContent = `${current.toFixed(1)}×`;
  elements.zoomHelp.textContent = `已连接驱动变焦：${zoom.min}× ～ ${zoom.max}×。调整时会直接调用摄像头轨道约束。`;
  elements.zoomHelp.dataset.kind = "ok";
  updateZoomStat();
}

async function applyDriverZoom(value, { quiet = false } = {}) {
  if (!state.cameraTrack || !state.driverZoomSupported) return;
  const requestId = ++state.zoomRequestId;
  try {
    const existing = { ...state.cameraTrack.getConstraints() };
    delete existing.zoom;
    const advanced = Array.isArray(existing.advanced)
      ? existing.advanced.filter((item) => !("zoom" in item))
      : [];
    await state.cameraTrack.applyConstraints({ ...existing, advanced: [...advanced, { zoom: Number(value) }] });
    if (requestId !== state.zoomRequestId) return;
    const actual = state.cameraTrack.getSettings().zoom ?? Number(value);
    elements.driverZoom.value = String(actual);
    elements.driverZoomValue.textContent = `${Number(actual).toFixed(1)}×`;
    updateZoomStat();
  } catch (error) {
    if (!quiet) showToast(`驱动变焦设置失败：${error.message}`, "error");
    configureDriverZoom();
  }
}

async function setZoomMode(mode) {
  state.zoomMode = mode;
  elements.driverZoomField.hidden = mode !== "driver";
  elements.softwareZoomField.hidden = mode !== "software";
  if (mode === "software") {
    // 软件裁切前恢复驱动的 1×/最小倍率，避免两种变焦叠加。
    await applyDriverZoom(state.driverZoomNeutral, { quiet: true });
    elements.driverZoom.disabled = true;
    elements.zoomHelp.textContent = "软件变焦采用中心裁切，预览和保存的录像都会包含放大效果。";
    elements.zoomHelp.dataset.kind = "ok";
  } else {
    elements.driverZoom.disabled = !state.driverZoomSupported;
    configureDriverZoom();
    if (state.driverZoomSupported) await applyDriverZoom(elements.driverZoom.value, { quiet: true });
  }
  updateZoomStat();
}

function updateStreamStats() {
  if (!state.cameraTrack) return;
  const settings = state.cameraTrack.getSettings();
  elements.resolutionStat.textContent = `${settings.width ?? elements.previewCanvas.width} × ${settings.height ?? elements.previewCanvas.height}`;
  elements.fpsStat.textContent = `${settings.frameRate ? Number(settings.frameRate).toFixed(0) : "—"} fps`;
  updateZoomStat();
}

function setCameraControls(opened) {
  elements.openCameraButton.disabled = opened;
  elements.closeCameraButton.disabled = !opened;
  elements.startRecordingButton.disabled = !opened;
  elements.cameraSelect.disabled = opened;
  elements.resolutionSelect.disabled = opened;
  elements.fpsSelect.disabled = opened;
  elements.refreshDevicesButton.disabled = opened;
}

async function openCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setCameraStatus("浏览器不允许访问摄像头", "error");
    showToast("请通过本机 http://127.0.0.1 地址打开，并使用新版 Chrome 或 Edge。", "error");
    return;
  }
  elements.openCameraButton.disabled = true;
  setCameraStatus("正在请求摄像头权限……", "idle");
  try {
    await closeCamera({ keepStatus: true });
    const preferredDeviceId = elements.cameraSelect.value;
    state.cameraStream = await getCameraStream();
    state.cameraTrack = state.cameraStream.getVideoTracks()[0];
    elements.sourceVideo.srcObject = state.cameraStream;
    await elements.sourceVideo.play();
    elements.emptyState.hidden = true;
    setCameraControls(true);
    setCameraStatus("摄像头已连接", "ready");
    configureDriverZoom();
    await setZoomMode(state.zoomMode);
    updateStreamStats();
    stopRenderLoop();
    renderPreviewFrame();
    await listCameras(state.cameraTrack.getSettings().deviceId || preferredDeviceId);
    state.cameraTrack.addEventListener("ended", () => closeCamera());
  } catch (error) {
    setCameraControls(false);
    const messages = {
      NotAllowedError: "摄像头权限被拒绝，请在浏览器地址栏重新允许。",
      NotFoundError: "没有找到可用摄像头。",
      NotReadableError: "摄像头正在被其他程序占用，请先释放设备。",
      OverconstrainedError: "摄像头不支持当前分辨率或帧率，请降低设置。",
      SecurityError: "当前页面不是允许摄像头访问的安全来源。",
    };
    const message = messages[error.name] || `打开摄像头失败：${error.message}`;
    setCameraStatus("摄像头连接失败", "error");
    showToast(message, "error");
  }
}

async function closeCamera({ keepStatus = false } = {}) {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    await stopRecording();
  }
  stopRenderLoop();
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  state.cameraTrack = null;
  elements.sourceVideo.srcObject = null;
  elements.emptyState.hidden = false;
  state.driverZoomSupported = false;
  elements.driverZoom.disabled = true;
  elements.driverZoomValue.textContent = "—";
  elements.resolutionStat.textContent = "— × —";
  elements.fpsStat.textContent = "— fps";
  elements.zoomStat.textContent = "1.0×";
  setCameraControls(false);
  if (!keepStatus) setCameraStatus("摄像头未连接", "idle");
}

function chooseRecordingMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function recordingExtension(mimeType) {
  return mimeType.includes("mp4") ? ".mp4" : ".webm";
}

function initializeRecordingFormat() {
  if (typeof MediaRecorder === "undefined") {
    elements.filenameExtension.textContent = ".不支持";
    elements.codecStat.textContent = "当前浏览器不支持网页录像";
    return;
  }
  state.mimeType = chooseRecordingMimeType();
  if (!state.mimeType) {
    state.extension = "";
    elements.filenameExtension.textContent = ".自动";
    elements.codecStat.textContent = "录像格式由浏览器决定";
    return;
  }
  state.extension = recordingExtension(state.mimeType);
  elements.filenameExtension.textContent = state.extension;
  elements.codecStat.textContent = state.extension === ".mp4"
    ? "首选格式：MP4 / H.264"
    : "当前浏览器回退：WebM";
}

function cleanupRecordingUrl() {
  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
  state.recordingUrl = null;
}

function updateRecordingTimer() {
  elements.recordTimer.textContent = formatDuration(performance.now() - state.recordingStartedAt);
}

function startRecording() {
  if (!state.cameraStream || !elements.previewCanvas.captureStream || typeof MediaRecorder === "undefined") {
    showToast("当前浏览器不支持网页录像，请使用新版 Chrome 或 Edge。", "error");
    return;
  }
  cleanupRecordingUrl();
  state.recordingBlob = null;
  state.recordingChunks = [];
  const fps = Number(elements.fpsSelect.value);
  state.recordingStream = elements.previewCanvas.captureStream(fps);
  state.mimeType = chooseRecordingMimeType();
  state.extension = recordingExtension(state.mimeType);
  const options = state.mimeType ? { mimeType: state.mimeType } : {};
  try {
    state.mediaRecorder = new MediaRecorder(state.recordingStream, options);
    state.mimeType = state.mediaRecorder.mimeType || state.mimeType;
    state.extension = recordingExtension(state.mimeType);
  } catch (error) {
    // 浏览器声称支持某格式时仍可能因当前分辨率或编码器资源而失败，退回默认编码器再试。
    try {
      state.mediaRecorder = new MediaRecorder(state.recordingStream);
      state.mimeType = state.mediaRecorder.mimeType;
      state.extension = recordingExtension(state.mimeType);
    } catch (fallbackError) {
      state.recordingStream.getTracks().forEach((track) => track.stop());
      state.recordingStream = null;
      showToast(`无法启动录像编码器：${fallbackError.message || error.message}`, "error");
      return;
    }
  }
  state.mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) state.recordingChunks.push(event.data);
  });
  state.mediaRecorder.addEventListener("error", (event) => {
    showToast(`录像失败：${event.error?.message || "浏览器编码器异常"}`, "error");
  });
  state.mediaRecorder.addEventListener("stop", finalizeRecording, { once: true });
  state.mediaRecorder.start(1000);
  state.recordingStartedAt = performance.now();
  state.timerId = window.setInterval(updateRecordingTimer, 250);
  updateRecordingTimer();
  elements.recordIndicator.hidden = false;
  elements.startRecordingButton.disabled = true;
  elements.stopRecordingButton.disabled = false;
  elements.openCameraButton.disabled = true;
  elements.closeCameraButton.disabled = true;
  elements.saveRecordingButton.disabled = true;
  elements.filenameExtension.textContent = state.extension;
  elements.codecStat.textContent = state.mediaRecorder.mimeType || "浏览器默认编码";
  setCameraStatus("正在录像", "ready");
}

function finalizeRecording() {
  window.clearInterval(state.timerId);
  state.timerId = null;
  const actualType = state.mediaRecorder?.mimeType || state.mimeType || "video/webm";
  state.extension = recordingExtension(actualType);
  state.recordingBlob = new Blob(state.recordingChunks, { type: actualType });
  state.recordingChunks = [];
  cleanupRecordingUrl();
  state.recordingUrl = URL.createObjectURL(state.recordingBlob);
  elements.playbackVideo.src = state.recordingUrl;
  elements.playbackPanel.hidden = false;
  elements.recordingSize.textContent = `${formatFileSize(state.recordingBlob.size)} · ${actualType}`;
  elements.filenameExtension.textContent = state.extension;
  elements.recordIndicator.hidden = true;
  elements.startRecordingButton.disabled = !state.cameraStream;
  elements.stopRecordingButton.disabled = true;
  elements.closeCameraButton.disabled = !state.cameraStream;
  elements.saveRecordingButton.disabled = state.recordingBlob.size === 0;
  state.recordingStream?.getTracks().forEach((track) => track.stop());
  state.recordingStream = null;
  setCameraStatus(state.cameraStream ? "摄像头已连接" : "摄像头未连接", state.cameraStream ? "ready" : "idle");
  showToast("录像已停止，请回放确认后保存到本地。", "success");
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") return Promise.resolve();
  return new Promise((resolve) => {
    state.mediaRecorder.addEventListener("stop", resolve, { once: true });
    state.mediaRecorder.stop();
  });
}

async function saveRecording() {
  if (!state.recordingBlob) return;
  const filename = `${safeFilename(elements.filenameInput.value)}${state.extension}`;
  try {
    if ("showSaveFilePicker" in window) {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "视频文件",
          accept: { [state.recordingBlob.type || "video/webm"]: [state.extension] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(state.recordingBlob);
      await writable.close();
    } else {
      const link = document.createElement("a");
      link.href = state.recordingUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
    }
    showToast(`录像已保存：${filename}`, "success");
  } catch (error) {
    if (error.name !== "AbortError") showToast(`保存失败：${error.message}`, "error");
  }
}

elements.refreshDevicesButton.addEventListener("click", async () => {
  try {
    await listCameras();
    showToast("摄像头列表已刷新。", "success");
  } catch (error) {
    showToast(`刷新失败：${error.message}`, "error");
  }
});
elements.openCameraButton.addEventListener("click", openCamera);
elements.closeCameraButton.addEventListener("click", () => closeCamera());
elements.startRecordingButton.addEventListener("click", startRecording);
elements.stopRecordingButton.addEventListener("click", stopRecording);
elements.saveRecordingButton.addEventListener("click", saveRecording);
elements.driverZoom.addEventListener("input", () => {
  elements.driverZoomValue.textContent = `${Number(elements.driverZoom.value).toFixed(1)}×`;
  applyDriverZoom(elements.driverZoom.value);
});
elements.softwareZoom.addEventListener("input", () => {
  elements.softwareZoomValue.textContent = `${Number(elements.softwareZoom.value).toFixed(1)}×`;
  updateZoomStat();
});
elements.zoomModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) setZoomMode(input.value);
  });
});
navigator.mediaDevices?.addEventListener("devicechange", () => listCameras());
window.addEventListener("pagehide", () => {
  stopRenderLoop();
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  state.recordingStream?.getTracks().forEach((track) => track.stop());
});

elements.filenameInput.value = timestampName();
initializeRecordingFormat();
listCameras().catch((error) => showToast(`读取摄像头列表失败：${error.message}`, "error"));

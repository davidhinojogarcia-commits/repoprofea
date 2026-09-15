from pathlib import Path

p = Path('components/CameraScannerModal.tsx')
text = p.read_text(encoding='utf-8')

state_anchor = """  const [isCameraLoading, setIsCameraLoading] = useState(false);\n  const videoRef = useRef<HTMLVideoElement>(null);\n  const streamRef = useRef<MediaStream | null>(null);\n"""
state_replacement = """  const [isCameraLoading, setIsCameraLoading] = useState(false);\n  const [isMobileCameraDevice, setIsMobileCameraDevice] = useState(false);\n  const [hasLocalCamera, setHasLocalCamera] = useState(false);\n  const videoRef = useRef<HTMLVideoElement>(null);\n  const streamRef = useRef<MediaStream | null>(null);\n\n  React.useEffect(() => {\n    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;\n\n    const mobileByUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);\n    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;\n    const touchDevice = (navigator.maxTouchPoints || 0) > 0;\n    const mobileLike = mobileByUa || (coarsePointer && touchDevice);\n    const mediaSupported = Boolean(navigator.mediaDevices?.getUserMedia);\n\n    setIsMobileCameraDevice(mobileLike);\n    setHasLocalCamera(mediaSupported);\n\n    if (mediaSupported && navigator.mediaDevices?.enumerateDevices) {\n      navigator.mediaDevices.enumerateDevices()\n        .then(devices => {\n          const hasVideoInput = devices.some(device => device.kind === 'videoinput');\n          setHasLocalCamera(hasVideoInput || mediaSupported);\n        })\n        .catch(() => setHasLocalCamera(mediaSupported));\n    }\n  }, []);\n"""
if 'isMobileCameraDevice' not in text:
    if state_anchor not in text:
        raise SystemExit('state anchor not found')
    text = text.replace(state_anchor, state_replacement, 1)

handler_anchor = """  const toggleFacingMode = () => {\n    const nextMode = facingMode === 'environment' ? 'user' : 'environment';\n    startLiveCamera(nextMode);\n  };\n"""
handler_replacement = handler_anchor + """\n\n  const openThisDeviceCamera = async () => {\n    if (!hasLocalCamera || !navigator.mediaDevices?.getUserMedia) {\n      fileInputRef.current?.click();\n      onToast('Abriendo la cámara nativa disponible en este dispositivo.', 'success');\n      return;\n    }\n    await startLiveCamera('environment');\n  };\n"""
if 'const openThisDeviceCamera' not in text:
    if handler_anchor not in text:
        raise SystemExit('handler anchor not found')
    text = text.replace(handler_anchor, handler_replacement, 1)

ui_anchor = """            <>\n              <RemoteScannerPairing onCapture={handleRemoteCapture} onToast={onToast} />\n\n              {/* Continuous Capture Mode Switch Card */}\n"""
ui_replacement = """            <>\n              {isMobileCameraDevice && (\n                <div className=\"p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20\">\n                  <button\n                    type=\"button\"\n                    onClick={openThisDeviceCamera}\n                    disabled={isCameraLoading}\n                    className=\"w-full flex items-center justify-center gap-3 px-5 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-wait text-white shadow-sm transition-colors\"\n                  >\n                    {isCameraLoading ? <Loader2 className=\"w-6 h-6 animate-spin\" /> : <Camera className=\"w-6 h-6\" />}\n                    <div className=\"text-left\">\n                      <div className=\"text-sm font-extrabold\">Usar cámara de este dispositivo</div>\n                      <div className=\"text-[11px] text-emerald-50\">\n                        {hasLocalCamera ? 'Cámara detectada · se abrirá preferentemente la cámara trasera' : 'Se intentará abrir la cámara nativa del móvil o tablet'}\n                      </div>\n                    </div>\n                  </button>\n                </div>\n              )}\n\n              <RemoteScannerPairing onCapture={handleRemoteCapture} onToast={onToast} />\n\n              {/* Continuous Capture Mode Switch Card */}\n"""
if 'Usar cámara de este dispositivo' not in text:
    if ui_anchor not in text:
        raise SystemExit('UI anchor not found')
    text = text.replace(ui_anchor, ui_replacement, 1)

p.write_text(text, encoding='utf-8')

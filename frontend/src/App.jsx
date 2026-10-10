import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || 'https://esp32-ai-camera-backend.onrender.com').replace(/\/$/, '')
const DEVICE_ID = import.meta.env.VITE_DEVICE_ID || 'ESP32CAM_001'
const stages = ['Capture', 'Understand', 'Listen']
const timeLabel = (date) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)

function Icon({ name, size = 20, ...props }) {
  const paths = {
    camera: <><path d="M14 4H9L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z" /><circle cx="12" cy="13" r="4" /></>,
    glasses: <><rect x="2" y="9" width="8" height="7" rx="3" /><rect x="14" y="9" width="8" height="7" rx="3" /><path d="M10 11c1-2 3-2 4 0M2 11l2-6h3m15 6-2-6h-3" /></>,
    sound: <><path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.5 6a8 8 0 0 1 13 3M4.5 15a8 8 0 0 0 13 3" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="16" cy="17" r="3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    chip: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M10 10h4v4h-4z" /></>,
    alert: <><path d="m12 3 10 18H2zM12 9v5M12 17h.01" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}

function App() {
  const [connection, setConnection] = useState('checking')
  const [checking, setChecking] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [image, setImage] = useState('')
  const [imageError, setImageError] = useState(false)
  const [analysis, setAnalysis] = useState('')
  const [error, setError] = useState('')
  const [speechError, setSpeechError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [capturedAt, setCapturedAt] = useState(null)
  const [history, setHistory] = useState([])
  const [view, setView] = useState('workspace')
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [rate, setRate] = useState(1)
  const [speaking, setSpeaking] = useState(false)
  const captureController = useRef(null)
  const connectionController = useRef(null)
  const speechVersion = useRef(0)
  const speechSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const busy = phase === 'capturing' || phase === 'analyzing'

  const checkConnection = useCallback(async () => {
    connectionController.current?.abort()
    const controller = new AbortController()
    connectionController.current = controller
    const timeout = setTimeout(() => controller.abort(), 12000)
    setChecking(true)
    try {
      const response = await fetch(`${BACKEND_URL}/devices`, { signal: controller.signal })
      if (!response.ok) throw new Error('Status unavailable')
      const devices = await response.json()
      if (connectionController.current === controller) setConnection(devices[DEVICE_ID]?.online ? 'online' : 'offline')
    } catch {
      if (connectionController.current === controller) setConnection('unreachable')
    } finally {
      clearTimeout(timeout)
      if (connectionController.current === controller) setChecking(false)
    }
  }, [])

  useEffect(() => {
    const initial = setTimeout(checkConnection, 0)
    const interval = setInterval(checkConnection, 20000)
    return () => {
      clearTimeout(initial)
      clearInterval(interval)
      connectionController.current?.abort()
      connectionController.current = null
      captureController.current?.abort()
      captureController.current = null
      speechVersion.current += 1
      if (speechSupported) window.speechSynthesis.cancel()
    }
  }, [checkConnection, speechSupported])

  useEffect(() => {
    if (!busy) return
    const started = performance.now()
    const interval = setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [busy])

  function stopSpeech() {
    speechVersion.current += 1
    if (speechSupported) window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  function speak(text) {
    if (!text || !speechSupported) return
    stopSpeech()
    setSpeechError('')
    const version = speechVersion.current
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate
    utterance.onstart = () => { if (version === speechVersion.current) setSpeaking(true) }
    utterance.onend = () => { if (version === speechVersion.current) setSpeaking(false) }
    utterance.onerror = () => {
      if (version !== speechVersion.current) return
      setSpeaking(false)
      setSpeechError('Audio could not start. Try Listen again or check your browser audio settings.')
    }
    window.speechSynthesis.speak(utterance)
  }

  const handleCapture = async () => {
    if (captureController.current) return
    const controller = new AbortController()
    captureController.current = controller
    const deadline = setTimeout(() => controller.abort(), 60000)
    // This clock sample runs in the click handler, not during render.
    // eslint-disable-next-line react-hooks/purity
    const started = performance.now()
    let receivedImage = false
    stopSpeech()
    setView('workspace')
    setPhase('capturing')
    setImage('')
    setImageError(false)
    setAnalysis('')
    setError('')
    setSpeechError('')
    setElapsed(0)
    setCapturedAt(null)
    try {
      const response = await fetch(`${BACKEND_URL}/device/${DEVICE_ID}/capture`, { method: 'POST', signal: controller.signal })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.message || `Capture request failed (${response.status}).`)
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        controller.signal.throwIfAborted()
        const resultResponse = await fetch(`${BACKEND_URL}/device/${DEVICE_ID}/analysis`, { signal: controller.signal })
        if (!resultResponse.ok) throw new Error(`Could not retrieve the scene (${resultResponse.status}). Please retry.`)
        const result = await resultResponse.json()
        if (result.image) {
          receivedImage = true
          setImage(`${BACKEND_URL}/images/${encodeURIComponent(result.image)}`)
          setPhase('analyzing')
        }
        if (result.image && result.analysis && result.analysisImage === result.image) {
          const now = new Date()
          // This clock sample runs after the asynchronous request completes.
          // eslint-disable-next-line react-hooks/purity
          const duration = ((performance.now() - started) / 1000).toFixed(1)
          setAnalysis(result.analysis)
          setCapturedAt(now)
          setElapsed(Number(duration))
          setPhase('complete')
          setHistory((items) => [{ id: result.image, image: `${BACKEND_URL}/images/${encodeURIComponent(result.image)}`, text: result.analysis, date: now, duration }, ...items.filter((item) => item.id !== result.image)].slice(0, 8))
          if (autoSpeak) speak(result.analysis)
          return
        }
      }
    } catch (cause) {
      if (captureController.current !== controller) return
      setPhase('error')
      setError(controller.signal.aborted
        ? receivedImage ? 'The image arrived, but the description did not finish within 60 seconds. Please try again.' : 'No image arrived within 60 seconds. Check the camera connection and try again.'
        : cause.message === 'Failed to fetch' ? 'Could not reach the backend. Check your connection and try again.' : cause.message)
    } finally {
      clearTimeout(deadline)
      if (captureController.current === controller) captureController.current = null
    }
  }

  function openCapture(item) {
    stopSpeech()
    setImage(item.image)
    setImageError(false)
    setAnalysis(item.text)
    setCapturedAt(item.date)
    setElapsed(Number(item.duration))
    setError('')
    setSpeechError('')
    setPhase('complete')
    setView('workspace')
  }

  const connectionLabel = { checking: 'Checking device', online: 'Device online', offline: 'Device offline', unreachable: 'Connection unavailable' }[connection]
  const activeStage = phase === 'capturing' ? 0 : phase === 'analyzing' ? 1 : phase === 'complete' ? 2 : -1

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to workspace</a>
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Smart Vision workspace" onClick={() => setView('workspace')}>
          <span className="brand-mark"><Icon name="glasses" size={28} /></span>
          <span>smart<span className="brand-light">vision</span><span className="brand-caption">A LITTLE MORE INDEPENDENCE</span></span>
        </a>
        <nav className="navigation" aria-label="Main navigation">
          <button className={view === 'workspace' ? 'nav-link active' : 'nav-link'} aria-current={view === 'workspace' ? 'page' : undefined} onClick={() => setView('workspace')}>Workspace</button>
          <button className={view === 'history' ? 'nav-link active' : 'nav-link'} aria-current={view === 'history' ? 'page' : undefined} onClick={() => setView('history')}>Session history <span className="nav-count">{history.length}</span></button>
        </nav>
        <div className="project-label"><span className="tiny-square" />SMART SPECTACLES PROJECT</div>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="page-heading">
          <div><p className="eyebrow">THE PERCEPTION WORKSPACE</p><h1>{view === 'workspace' ? 'Bring the scene into focus.' : 'A look back at this session.'}</h1><p className="page-subtitle">{view === 'workspace' ? 'Capture what’s in front of you. Turn it into words you can hear.' : 'Revisit your recent captures and listen to their descriptions.'}</p></div>
          <div className="heading-note"><Icon name="glasses" size={24} /><span>Designed for awareness.<br /><strong>Built for independence.</strong></span></div>
        </section>
        <section className="device-bar" aria-label="Device and audio controls">
          <div className="device-identity"><span className="device-icon"><Icon name="chip" /></span><div><strong>Vision camera</strong><span className="mono">{DEVICE_ID}</span></div></div>
          <div className="device-connection"><span className={`status-dot ${connection}`} /><span role="status">{connectionLabel}</span><button className="icon-button" onClick={checkConnection} disabled={checking} aria-label="Refresh device status"><Icon name="refresh" size={16} className={checking ? 'rotating' : ''} /></button></div>
          <details className="preferences"><summary><Icon name="settings" size={18} /> Audio settings</summary><div className="preferences-panel"><strong>Make it comfortable</strong><label className="toggle-row"><span>Read descriptions aloud</span><input type="checkbox" checked={autoSpeak} disabled={!speechSupported} onChange={(event) => setAutoSpeak(event.target.checked)} /></label><label className="range-label" htmlFor="speech-rate">Speech speed <span className="mono">{rate.toFixed(1)}×</span></label><input id="speech-rate" type="range" min="0.5" max="1.5" step="0.1" value={rate} disabled={!speechSupported} onChange={(event) => setRate(Number(event.target.value))} /><p>{speechSupported ? 'Uses your browser’s available voice and selected audio output.' : 'Speech is unavailable in this browser. Descriptions are still readable.'}</p></div></details>
        </section>

        {view === 'workspace' ? <>
          <div className="workspace-grid">
            <section className="camera-panel" aria-labelledby="camera-heading">
              <div className="panel-heading"><h2 id="camera-heading"><Icon name="camera" size={18} /> Camera view</h2><span className="small-label">STILL CAPTURE</span></div>
              <div className={`viewfinder ${busy ? 'is-processing' : ''}`} aria-busy={busy}>
                <span className="frame-corner top-left" /><span className="frame-corner top-right" /><span className="frame-corner bottom-left" /><span className="frame-corner bottom-right" />
                <div className="viewfinder-meta"><span><span className={`frame-dot ${image ? 'has-image' : ''}`} />{image ? 'CAPTURED FRAME' : 'AWAITING CAPTURE'}</span><span>ESP32-CAM</span></div>
                {image && !imageError ? <img className="scene-image" src={image} alt="Scene captured by your smart spectacles" onError={() => setImageError(true)} /> : <div className="camera-empty"><div className="optical-mark"><Icon name={imageError ? 'alert' : 'glasses'} size={68} /></div><h3>{imageError ? 'Image preview unavailable' : phase === 'capturing' ? 'A moment, in the making.' : 'Your next perspective starts here.'}</h3><p>{imageError ? 'The saved image could not be loaded. You can still read an available description.' : phase === 'capturing' ? 'Waiting for your camera to capture and upload a frame.' : 'Point your spectacles toward a scene, then capture it below.'}</p></div>}
                <div className="viewfinder-bottom"><span>{capturedAt ? timeLabel(capturedAt) : 'A single frame. A clearer understanding.'}</span><Icon name="camera" size={16} /></div>
              </div>
              <div className="capture-controls"><div><strong>{busy ? 'Finding the words…' : phase === 'complete' ? 'Ready for another perspective?' : 'Whenever you’re ready.'}</strong><p>{busy ? 'Keep this window open while your scene is processed.' : 'One capture is all it takes to get started.'}</p></div><button className="button button-primary" disabled={busy} onClick={() => handleCapture()}><Icon name={busy ? 'refresh' : 'camera'} size={19} className={busy ? 'rotating' : ''} />{busy ? 'Processing…' : 'Capture scene'}{!busy && <Icon name="arrow" size={18} />}</button></div>
            </section>
            <section className="description-panel" aria-labelledby="description-heading" aria-busy={busy}>
              <div className="panel-heading"><h2 id="description-heading"><Icon name="spark" size={18} /> Scene description</h2><span className="ai-label">GEMINI</span></div>
              <div className="description-content">
                {analysis ? <><div className="result-label"><span className="status-dot online" />A SCENE, PUT INTO WORDS</div><p className="description-text">{analysis}</p><div className="result-meta"><Icon name="clock" size={14} /><span>{elapsed}s to describe</span><span>·</span><span>{capturedAt && timeLabel(capturedAt)}</span></div></> : <div className="description-empty"><div className="description-symbol"><Icon name="spark" size={28} /></div><h3>{busy ? 'From seeing to understanding.' : 'The world, in words.'}</h3><p>{phase === 'capturing' ? 'First, your camera captures the scene. Its description will appear here.' : phase === 'analyzing' ? 'Your image is here. Gemini is preparing a concise description of the scene.' : 'Your scene description will appear here, ready to read or hear aloud.'}</p>{busy && <div className="processing-label"><span className="processing-dots"><i /><i /><i /></span><span>Processing your scene</span></div>}</div>}
                {error && <div className="error-message" role="alert"><Icon name="alert" size={18} /><div><strong>Let’s try that again</strong><p>{error}</p></div></div>}
              </div>
              <div className="audio-controls"><div className={`audio-state ${speaking ? 'speaking' : ''}`}><span className="audio-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span><div><strong>{speaking ? 'Reading your scene' : 'Listen to your surroundings'}</strong><span>{!speechSupported ? 'Speech unavailable in this browser' : autoSpeak ? 'Automatic playback is on' : 'Automatic playback is off'}</span></div></div><button className="button button-secondary" disabled={!analysis || !speechSupported} onClick={() => speaking ? stopSpeech() : speak(analysis)}><Icon name={speaking ? 'stop' : 'sound'} size={17} />{speaking ? 'Stop' : 'Listen'}</button></div>
              {speechError && <p className="speech-error" role="alert">{speechError}</p>}
            </section>
          </div>
          <section className="process-strip" aria-label="Capture progress">
            <div className="process-intro"><span className="eyebrow">FROM SCENE TO SPEECH</span><span role="status">{busy ? `Working on your scene · ${elapsed}s` : phase === 'complete' ? 'Your description is ready' : phase === 'error' ? 'Capture needs attention' : 'Three steps. One simple action.'}</span></div>
            <ol className="process-steps">{stages.map((stage, index) => <li key={stage} className={activeStage === index ? 'current' : activeStage > index ? 'done' : ''}><span className="step-number">{activeStage > index ? <Icon name="check" size={14} /> : `0${index + 1}`}</span><span>{stage}<small>{['ESP32 camera', 'Gemini vision', 'Spoken description'][index]}</small></span>{index < 2 && <span className="step-connector" />}</li>)}</ol>
          </section>
          <div className="workspace-note"><Icon name="sound" size={16} /><p>A little space to listen. Use your preferred audio device for spoken descriptions.</p><span>ON-DEMAND SCENE PERCEPTION</span></div>
        </> : <section className="history-panel" aria-labelledby="history-heading"><div className="panel-heading"><h2 id="history-heading"><Icon name="clock" size={18} /> Recent captures</h2><span className="small-label">THIS SESSION · UP TO 8 CAPTURES</span></div>{history.length ? <div className="history-list">{history.map((item, index) => <button className="history-item" key={item.id} disabled={busy} onClick={() => openCapture(item)}><span className="history-number mono">{String(history.length - index).padStart(2, '0')}</span><span className="history-copy"><strong>{item.text}</strong><span>{timeLabel(item.date)} · {item.duration}s to describe</span></span><Icon name="arrow" /></button>)}</div> : <div className="history-empty"><Icon name="camera" size={40} /><h3>Every perspective has a beginning.</h3><p>Your completed captures will appear here during this session.</p><button className="button button-primary" onClick={() => setView('workspace')}>Go to workspace <Icon name="arrow" size={18} /></button></div>}<p className="history-footnote">Session history is kept in this tab and clears when you reload.</p></section>}
      </main>
      <footer><span><Icon name="glasses" size={19} /> Smart Vision <span className="footer-divider">/</span> Perception with purpose.</span><span>Prototype workspace <span className="footer-dot">·</span> ESP32 + Gemini</span></footer>
    </div>
  )
}

export default App

import React, { useEffect, useRef, useState } from 'react';

function App() {
  // --- STATE ---
  const [status, setStatus] = useState("Click START to Connect");
  const [isConnected, setIsConnected] = useState(false);
  const [debugNote, setDebugNote] = useState("-"); 
  const [currentAction, setCurrentAction] = useState("IDLE");

  // --- SETTINGS ---
  const SPEED = 5;             
  const PITCH_HIGH = 350;       
  const PITCH_LOW = 110;        
  const CLICK_THRESHOLD = 0.15; 
  const NOISE_GATE = 0.20;      

  // References
  const classifierRef = useRef(null);
  const pitchRef = useRef(null);
  const audioContextRef = useRef(null);
  const requestRef = useRef(null);
  const volumeRef = useRef(0);
  const socketRef = useRef(null); // <--- NEW: WebSocket Connection

  const TM_MODEL_URL = "https://teachablemachine.withgoogle.com/models/36aepnE9f/model.json"; 
  const PITCH_MODEL_URL = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models/models/pitch-detection/crepe/';

  // --- INITIALIZATION ---
  const startApp = async () => {
    // 1. Connect to Python Server
    connectSocket();

    // 2. Start Audio
    if (!window.ml5) return alert("Error: ml5 not loaded");
    try {
      setStatus("Booting Audio...");
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, 
        video: false 
      });

      classifierRef.current = window.ml5.soundClassifier(TM_MODEL_URL, { audioContext: audioContextRef.current }, modelLoaded);
      pitchRef.current = window.ml5.pitchDetection(PITCH_MODEL_URL, audioContextRef.current, stream, modelLoaded);
      setupVolume(stream);
    } catch (err) {
      setStatus("Error: " + err.message);
    }
  };

  const connectSocket = () => {
    // Connect to localhost:8000 (Your Python Script)
    socketRef.current = new WebSocket("ws://localhost:8000/ws");
    
    socketRef.current.onopen = () => {
      setIsConnected(true);
      setStatus("✅ Connected to Mouse Driver");
    };
    
    socketRef.current.onclose = () => {
      setIsConnected(false);
      setStatus("❌ Disconnected from Driver");
    };
  };

  let modelsLoaded = 0;
  const modelLoaded = () => {
    modelsLoaded++;
    if (modelsLoaded === 2) {
      runLoop(); 
    }
  };

  // --- HELPER TO SEND COMMANDS ---
  const sendCommand = (action, dx = 0, dy = 0) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action, dx, dy }));
      setCurrentAction(action);
      setTimeout(() => setCurrentAction("IDLE"), 200);
    }
  };

  // --- MAIN LOOP ---
  const runLoop = () => {
    if (volumeRef.current < NOISE_GATE) {
      setDebugNote("-");
      requestRef.current = requestAnimationFrame(runLoop);
      return;
    }

    // Left/Right
    if (classifierRef.current) {
      classifierRef.current.classify((err, res) => {
        if (!err && res && res[0].confidence > 0.7) {
          const label = res[0].label;
          if (label === "Eeeee" || label === "Class 2") sendCommand("MOVE", SPEED, 0);
          if (label === "Oooo" || label === "Class 3") sendCommand("MOVE", -SPEED, 0);
        }
      });
    }

    // Up/Down
    if (pitchRef.current) {
      pitchRef.current.getPitch((err, frequency) => {
        if (frequency) {
          const freqNum = Number(frequency);
          setDebugNote(Math.round(freqNum) + " Hz");
          if (freqNum > PITCH_HIGH) sendCommand("MOVE", 0, -SPEED); // -Y is Up
          else if (freqNum < PITCH_LOW) sendCommand("MOVE", 0, SPEED);  // +Y is Down
        }
      });
    }
    
    requestRef.current = requestAnimationFrame(runLoop);
  };

  const setupVolume = (stream) => {
    const ctx = audioContextRef.current;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    src.connect(analyser);
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);
    
    let lastClickTime = 0;

    const checkVol = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i=0; i<data.length; i++) sum+=data[i];
      let vol = (sum / data.length) / 255;
      volumeRef.current = vol;

      if (vol > CLICK_THRESHOLD) {
        const now = Date.now();
        if (now - lastClickTime > 500) { 
            lastClickTime = now;
            sendCommand("CLICK"); // Send Click to Python
        }
      }
      requestAnimationFrame(checkVol);
    };
    checkVol();
  };

  return (
    <div style={{ height: '100vh', background: '#111', color: 'white', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      
      {!isConnected ? (
        <button onClick={startApp} style={{ padding: '20px 50px', fontSize: '2rem', background: '#0f0', border: 'none', borderRadius: '10px', cursor: 'pointer' }}>
          CONNECT TO MOUSE
        </button>
      ) : (
        <>
          <h1 style={{color: '#0f0', fontSize: '3rem'}}>REMOTE ACTIVE</h1>
          <h2 style={{color: '#888'}}>PITCH: <span style={{color: '#fff'}}>{debugNote}</span></h2>
          <h2 style={{color: '#888'}}>ACTION: <span style={{color: '#ff0055'}}>{currentAction}</span></h2>
          
          <div style={{marginTop: '50px', padding: '20px', border: '1px solid #333'}}>
            <p>1. Keep this tab open.</p>
            <p>2. Switch to ANY other app (Spotify, Chrome, Desktop).</p>
            <p>3. Use your voice to control the REAL mouse.</p>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
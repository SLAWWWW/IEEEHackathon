import React, { useEffect, useRef, useState } from 'react';

function App() {
  // --- STATE ---
  const [status, setStatus] = useState("Click START to Connect");
  const [isConnected, setIsConnected] = useState(false);
  const [currentAction, setCurrentAction] = useState("IDLE");
  
  // DIAGNOSTIC STATE (Visual Feedback)
  const [livePitch, setLivePitch] = useState(0);
  const [liveVol, setLiveVol] = useState(0);

  // --- SETTINGS (TUNE THESE!) ---
  const SPEED = 25;             
  const PITCH_HIGH = 350;       
  const PITCH_LOW = 120;        
  const CLICK_THRESHOLD = 0.25; 
  const NOISE_GATE = 0.05;      // Raised to 5% to kill background noise

  // References
  const classifierRef = useRef(null);
  const pitchRef = useRef(null);
  const audioContextRef = useRef(null);
  const socketRef = useRef(null);
  
  // LIVE DATA REFS
  const activeCommandRef = useRef("IDLE"); 
  const volumeRef = useRef(0);
  const lastCommandTimeRef = useRef(0); // For throttling

  const TM_MODEL_URL = "https://teachablemachine.withgoogle.com/models/36aepnE9f/model.json"; 
  const PITCH_MODEL_URL = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models/models/pitch-detection/crepe/';

  // --- INITIALIZATION ---
  const startApp = async () => {
    connectSocket();
    if (!window.ml5) return alert("Error: ml5 not loaded");
    
    try {
      setStatus("Booting Audio Engine...");
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        }, 
        video: false 
      });

      classifierRef.current = window.ml5.soundClassifier(TM_MODEL_URL, { audioContext: audioContextRef.current }, () => {
        classifierRef.current.classify(handleVowelResult);
      });

      pitchRef.current = window.ml5.pitchDetection(PITCH_MODEL_URL, audioContextRef.current, stream, () => {
        getPitchLoop();
      });

      setupVolume(stream);
      requestAnimationFrame(gameLoop);
      setStatus("✅ SYSTEM READY");

    } catch (err) {
      setStatus("Error: " + err.message);
    }
  };

  const connectSocket = () => {
    socketRef.current = new WebSocket("ws://localhost:8000/ws");
    socketRef.current.onopen = () => setIsConnected(true);
    socketRef.current.onclose = () => setIsConnected(false);
  };

  // --- AI HANDLERS ---
  const handleVowelResult = (error, results) => {
    if (error || !results || volumeRef.current < NOISE_GATE) return;

    const best = results[0];
    if (best.confidence > 0.75) { // Increased confidence requirement
      if (best.label === "Eeeee" || best.label === "Class 2") {
        activeCommandRef.current = "RIGHT";
      } else if (best.label === "Oooo" || best.label === "Class 3") {
        activeCommandRef.current = "LEFT";
      } 
    }
  };

  const getPitchLoop = () => {
    pitchRef.current.getPitch((err, frequency) => {
      // 1. UPDATE VISUALS (For Debugging)
      setLivePitch(frequency ? Math.round(frequency) : 0);

      // 2. SAFETY CHECKS
      if (volumeRef.current < NOISE_GATE) {
        activeCommandRef.current = "IDLE"; 
        getPitchLoop();
        return;
      }

      if (frequency) {
        const freqNum = Number(frequency);

        // Only use pitch if we aren't using vowels
        if (activeCommandRef.current !== "RIGHT" && activeCommandRef.current !== "LEFT") {
          if (freqNum > PITCH_HIGH) activeCommandRef.current = "UP";
          else if (freqNum < PITCH_LOW) activeCommandRef.current = "DOWN";
          else activeCommandRef.current = "IDLE"; // DEAD ZONE
        }
      } else {
        // No frequency detected -> Stop vertical movement
        if (activeCommandRef.current === "UP" || activeCommandRef.current === "DOWN") {
           activeCommandRef.current = "IDLE";
        }
      }
      getPitchLoop(); 
    });
  };

  // --- GAME LOOP ---
  const gameLoop = () => {
    // Force Stop if Quiet
    if (volumeRef.current < NOISE_GATE) {
        // Optional: Send explicit STOP to clear buffer
    } else {
      const cmd = activeCommandRef.current;
      // Throttle: Only send command every 50ms to prevent lag
      const now = Date.now();
      if (now - lastCommandTimeRef.current > 50) {
          if (cmd === "RIGHT") sendCommand("MOVE", SPEED, 0);
          if (cmd === "LEFT")  sendCommand("MOVE", -SPEED, 0);
          if (cmd === "UP")    sendCommand("MOVE", 0, -SPEED);
          if (cmd === "DOWN")  sendCommand("MOVE", 0, SPEED);
          lastCommandTimeRef.current = now;
      }
    }
    requestAnimationFrame(gameLoop);
  };

  const sendCommand = (action, dx = 0, dy = 0) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action, dx, dy }));
      setCurrentAction(action);
      setTimeout(() => setCurrentAction(prev => prev === action ? "IDLE" : prev), 150);
    }
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
      setLiveVol(Math.round(vol * 100)); // Update Visual

      if (vol > CLICK_THRESHOLD) {
        const now = Date.now();
        if (now - lastClickTime > 500) { 
            lastClickTime = now;
            sendCommand("CLICK");
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
          <h2 style={{fontSize: '4rem', color: currentAction === "IDLE" ? "#333" : "#ff0055"}}>{currentAction}</h2>

          {/* DIAGNOSTICS PANEL */}
          <div style={{marginTop: '40px', display: 'flex', gap: '20px', background: '#222', padding: '20px', borderRadius: '10px'}}>
            <div style={{textAlign: 'center', width: '120px'}}>
               <p style={{color: '#aaa', fontSize: '0.8rem'}}>LIVE VOLUME</p>
               <h3 style={{fontSize: '2rem', color: liveVol < (NOISE_GATE*100) ? 'red' : '#0f0'}}>{liveVol}%</h3>
               <p style={{fontSize: '0.7rem'}}>Must be &gt; {NOISE_GATE*100}%</p>
            </div>
            <div style={{width: '1px', background: '#444'}}></div>
            <div style={{textAlign: 'center', width: '120px'}}>
               <p style={{color: '#aaa', fontSize: '0.8rem'}}>LIVE PITCH</p>
               <h3 style={{fontSize: '2rem', color: '#00ccff'}}>{livePitch} Hz</h3>
            </div>
          </div>

          <div style={{marginTop: '20px', textAlign: 'center', color: '#666'}}>
             <p>UP &gt; {PITCH_HIGH} Hz | DOWN &lt; {PITCH_LOW} Hz</p>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
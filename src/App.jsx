import React, { useEffect, useRef, useState } from 'react';

// --- ICONS (Simple SVGs) ---
const IconMic = () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>;
const IconMouse = () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="7"/><line x1="12" y1="6" x2="12" y2="6"/></svg>;
const IconBrain = () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-4z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-4z"/></svg>;

function App() {
  // --- APP LOGIC STATE ---
  const [view, setView] = useState("LANDING"); // 'LANDING' or 'APP'
  const [status, setStatus] = useState("Initializing...");
  const [isConnected, setIsConnected] = useState(false);
  const [currentAction, setCurrentAction] = useState("IDLE");
  const [livePitch, setLivePitch] = useState(0);
  const [liveVol, setLiveVol] = useState(0);

  // --- SETTINGS ---
  const SPEED = 25;             
  const PITCH_HIGH = 350;       
  const PITCH_LOW = 180;        
  const CLICK_THRESHOLD = 0.25; 
  const NOISE_GATE = 0.05;      

  // --- REFS ---
  const classifierRef = useRef(null);
  const pitchRef = useRef(null);
  const audioContextRef = useRef(null);
  const socketRef = useRef(null);
  const activeCommandRef = useRef("IDLE"); 
  const volumeRef = useRef(0);
  const lastCommandTimeRef = useRef(0);

  const TM_MODEL_URL = "https://teachablemachine.withgoogle.com/models/36aepnE9f/model.json"; 
  const PITCH_MODEL_URL = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models/models/pitch-detection/crepe/';

  // --- STARTUP ---
  const launchSystem = async () => {
    setView("APP");
    connectSocket();
    
    if (!window.ml5) return alert("Error: ml5 library not found!");
    
    try {
      setStatus("Booting Neural Networks...");
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false 
      });

      classifierRef.current = window.ml5.soundClassifier(TM_MODEL_URL, { audioContext: audioContextRef.current }, () => {
        classifierRef.current.classify(handleVowelResult);
      });

      pitchRef.current = window.ml5.pitchDetection(PITCH_MODEL_URL, audioContextRef.current, stream, () => {
        getPitchLoop();
      });

      setupVolume(stream);
      requestAnimationFrame(gameLoop);
      setStatus("✅ SYSTEM ONLINE");

    } catch (err) {
      setStatus("Error: " + err.message);
    }
  };

  const connectSocket = () => {
    socketRef.current = new WebSocket("ws://localhost:8000/ws");
    socketRef.current.onopen = () => setIsConnected(true);
    socketRef.current.onclose = () => setIsConnected(false);
  };

  // --- AI LOGIC ---
  const handleVowelResult = (error, results) => {
    if (error || !results || volumeRef.current < NOISE_GATE) return;
    const best = results[0];
    if (best.confidence > 0.75) {
      if (best.label === "Eeeee" || best.label === "Class 2") activeCommandRef.current = "RIGHT";
      else if (best.label === "Oooo" || best.label === "Class 3") activeCommandRef.current = "LEFT";
    }
  };

  const getPitchLoop = () => {
    pitchRef.current.getPitch((err, frequency) => {
      setLivePitch(frequency ? Math.round(frequency) : 0);
      if (volumeRef.current < NOISE_GATE) {
        activeCommandRef.current = "IDLE"; 
        getPitchLoop(); return;
      }
      if (frequency) {
        const freqNum = Number(frequency);
        if (activeCommandRef.current !== "RIGHT" && activeCommandRef.current !== "LEFT") {
          if (freqNum > PITCH_HIGH) activeCommandRef.current = "UP";
          else if (freqNum < PITCH_LOW) activeCommandRef.current = "DOWN";
          else activeCommandRef.current = "IDLE"; 
        }
      } else {
        if (activeCommandRef.current === "UP" || activeCommandRef.current === "DOWN") activeCommandRef.current = "IDLE";
      }
      getPitchLoop(); 
    });
  };

  const gameLoop = () => {
    if (volumeRef.current >= NOISE_GATE) {
      const cmd = activeCommandRef.current;
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
      setLiveVol(Math.round(vol * 100)); 

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

  // --- RENDER ---
  if (view === "LANDING") {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: '#000', color: '#fff', minHeight: '100vh' }}>
        {/* HERO */}
        <nav style={{ padding: '20px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333' }}>
          <h2 style={{ margin: 0, color: '#00ffcc', letterSpacing: '2px' }}>VOCAL<span style={{color: 'white'}}>JOYSTICK</span></h2>
          <button onClick={() => window.location.href="https://github.com"} style={{ background: '#333', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '5px', cursor: 'pointer' }}>GitHub</button>
        </nav>

        <header style={{ padding: '100px 20px', textAlign: 'center', background: 'radial-gradient(circle at center, #1a1a1a 0%, #000 70%)' }}>
          <h1 style={{ fontSize: '4rem', marginBottom: '20px', fontWeight: '800' }}>Control Your World.<br/><span style={{ color: '#00ffcc' }}>With Just Your Voice.</span></h1>
          <p style={{ fontSize: '1.2rem', color: '#aaa', maxWidth: '600px', margin: '0 auto 40px auto' }}>
            The world's first non-verbal, pitch-based navigation engine. <br/>Designed for ALS, Motor Impairment, and Hands-free Productivity.
          </p>
          <button onClick={launchSystem} style={{ padding: '20px 60px', fontSize: '1.5rem', background: '#00ffcc', color: '#000', border: 'none', borderRadius: '50px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 0 30px rgba(0,255,204,0.4)', transition: 'transform 0.2s' }}>
            LAUNCH DEMO
          </button>
        </header>

        {/* FEATURES */}
        <section style={{ padding: '80px 20px', maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '40px' }}>
            <FeatureCard 
              icon={<IconMic />} 
              title="Pitch Control" 
              desc="Uses real-time frequency analysis to map vocal pitch to Y-axis movement. High = Up, Low = Down." 
            />
            <FeatureCard 
              icon={<IconBrain />} 
              title="Formant AI" 
              desc="Neural network identifies vowel shapes ('Eeee' vs 'Oooo') to control X-axis with zero latency." 
            />
            <FeatureCard 
              icon={<IconMouse />} 
              title="Remote Click" 
              desc="Connects via WebSocket to a Python driver, allowing you to control the OS-level mouse cursor." 
            />
          </div>
        </section>

        <footer style={{ textAlign: 'center', padding: '40px', color: '#555', borderTop: '1px solid #222' }}>
          Built for iNTUition 2026. Powered by React, ml5.js, and Python.
        </footer>
      </div>
    );
  }

  // --- APP VIEW ---
  return (
    <div style={{ height: '100vh', background: '#111', color: 'white', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <button onClick={() => setView("LANDING")} style={{ position: 'absolute', top: 20, left: 20, background: 'transparent', color: '#666', border: '1px solid #333', padding: '5px 15px', cursor: 'pointer' }}>&larr; BACK</button>
      
      {!isConnected ? (
        <div style={{ textAlign: 'center', animation: 'pulse 2s infinite' }}>
          <h1 style={{ color: '#ff0055' }}>WAITING FOR DRIVER...</h1>
          <p>Please run <code>python server.py</code> in your terminal.</p>
        </div>
      ) : (
        <>
          <h1 style={{color: '#00ffcc', fontSize: '3rem', letterSpacing: '5px'}}>REMOTE ACTIVE</h1>
          <h2 style={{fontSize: '5rem', margin: '20px 0', color: currentAction === "IDLE" ? "#333" : "#fff", textShadow: currentAction !== "IDLE" ? "0 0 30px white" : "none" }}>{currentAction}</h2>

          <div style={{ marginTop: '40px', display: 'flex', gap: '20px', background: '#222', padding: '30px', borderRadius: '15px', border: '1px solid #333' }}>
            <div style={{ textAlign: 'center', width: '150px' }}>
               <p style={{ color: '#aaa', fontSize: '0.8rem', marginBottom: '10px' }}>LIVE VOLUME</p>
               <div style={{ height: '10px', background: '#444', borderRadius: '5px', overflow: 'hidden' }}>
                 <div style={{ height: '100%', width: `${liveVol}%`, background: liveVol > (NOISE_GATE*100) ? '#0f0' : 'red', transition: 'width 0.1s' }}></div>
               </div>
               <h3 style={{ fontSize: '1.5rem', marginTop: '10px' }}>{liveVol}%</h3>
            </div>
            
            <div style={{ width: '1px', background: '#444' }}></div>
            
            <div style={{ textAlign: 'center', width: '150px' }}>
               <p style={{ color: '#aaa', fontSize: '0.8rem', marginBottom: '10px' }}>LIVE PITCH</p>
               <h3 style={{ fontSize: '2rem', color: '#00ccff', margin: 0 }}>{livePitch} <span style={{fontSize: '1rem', color: '#666'}}>Hz</span></h3>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Component for Feature Cards
function FeatureCard({ icon, title, desc }) {
  return (
    <div style={{ background: '#1a1a1a', padding: '30px', borderRadius: '15px', border: '1px solid #333', transition: 'transform 0.2s' }}>
      <div style={{ color: '#00ffcc', marginBottom: '20px' }}>{icon}</div>
      <h3 style={{ fontSize: '1.5rem', marginBottom: '15px' }}>{title}</h3>
      <p style={{ color: '#aaa', lineHeight: '1.6' }}>{desc}</p>
    </div>
  );
}

export default App;
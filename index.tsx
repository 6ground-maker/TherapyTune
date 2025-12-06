import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Schema, Type } from "@google/genai";

// --- Types ---
interface AxisState {
  energy: number;
  reality: number;
  temporal: number;
  repetition: number;
  hedonic: number;
  summary?: string;
}

interface VoiceMetrics {
  pitch: string;    // Qualitative: "High", "Low", "Neutral"
  stability: string; // "Stable", "Trembling", "Variable"
  speed: string;     // "Fast", "Slow", "Moderate"
  note: string;
}

interface Song {
  title: string;
  artist: string;
  target_state: AxisState;
  therapeutic_note: string;
  color_hex: string;
}

interface PlaylistResponse {
  songs: Song[];
  voice_analysis?: VoiceMetrics; // Optional, only if voice used
}

type ViewState = "INPUT" | "RECORDING" | "ANALYZING" | "PLAYLIST";
type InputMode = "VOICE" | "TEXT";

declare var Chart: any;

const EXAMPLE_CHIPS = [
  "I feel empty and can't get out of bed",
  "I'm anxious about the future",
  "I feel numb and disconnected",
  "I'm restless and can't focus"
];

const HEALTHY_TARGET: AxisState = {
  energy: 0,
  reality: 0.2,
  temporal: 0,
  repetition: 0,
  hedonic: 0.2
};

// --- Helpers ---

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(',')[1]);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// --- Audio Hooks & Logic ---

const useAudioRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [metrics, setMetrics] = useState<{rms: number, zcr: number} | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Setup Audio Context for Analysis
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Setup Recorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        analyzeRecordedAudio(blob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone. Please allow permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      setIsRecording(false);
    }
  };

  // Quick client-side analysis of the blob for prompt context
  const analyzeRecordedAudio = async (blob: Blob) => {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const data = audioBuffer.getChannelData(0);
      
      // Calculate RMS (Energy/Volume)
      let sumSquares = 0;
      let zeroCrossings = 0;
      for (let i = 0; i < data.length; i++) {
        sumSquares += data[i] * data[i];
        if (i > 0 && ((data[i] >= 0 && data[i-1] < 0) || (data[i] < 0 && data[i-1] >= 0))) {
          zeroCrossings++;
        }
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const zcr = zeroCrossings / data.length; // Crude pitch proxy
      
      setMetrics({ rms, zcr });
    } catch (e) {
      console.error("Client side analysis failed", e);
    }
  };

  return { isRecording, startRecording, stopRecording, audioBlob, analyserRef, metrics, setAudioBlob };
};

// --- Visual Components ---

// 1. Live Waveform Visualizer
const LiveWaveform = ({ analyser, isRecording }: { analyser: React.MutableRefObject<AnalyserNode | null>, isRecording: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isRecording || !analyser.current || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.current!.getByteTimeDomainData(dataArray);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.2)'; // Fade effect
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 3;
      // Dynamic gradient stroke
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, '#2DD4BF'); // Teal
      gradient.addColorStop(0.5, '#A78BFA'); // Purple
      gradient.addColorStop(1, '#F472B6'); // Pink
      ctx.strokeStyle = gradient;

      ctx.beginPath();
      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [isRecording, analyser]);

  return <canvas ref={canvasRef} width={600} height={150} className="w-full h-32 rounded-xl" />;
};

// 2. Morphing Background (Same as before)
const MorphingBackground = ({ state }: { state: AxisState | null }) => {
  const getGradient = () => {
    if (!state) return "linear-gradient(-45deg, #0F172A, #1e1b4b, #312e81, #0F172A)"; 
    const { energy: e, hedonic: h, reality: r } = state;
    if (e < -0.4 && h < -0.4) return "linear-gradient(-45deg, #020617, #172554, #1e1b4b, #000000)";
    else if (r > 0.4 || e > 0.6) return "linear-gradient(-45deg, #450a0a, #7f1d1d, #c2410c, #4c1d95)";
    else if (r < -0.4) return "linear-gradient(-45deg, #1f2937, #115e59, #374151, #0f172a)";
    else return "linear-gradient(-45deg, #022c22, #0f766e, #0e7490, #134e4a)";
  };

  return <div className="fixed inset-0 -z-20 bg-gradient-anim opacity-80 transition-all duration-2000" style={{ backgroundImage: getGradient() }} />;
};

// 3. Geometric Overlay (Same as before)
const GeometricOverlay = () => (
  <div className="fixed inset-0 -z-10 opacity-20 pointer-events-none mix-blend-overlay">
    <svg width="100%" height="100%">
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
        </pattern>
        <pattern id="circles" width="100" height="100" patternUnits="userSpaceOnUse">
          <circle cx="50" cy="50" r="40" fill="none" stroke="white" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" className="animate-pulse-slow" />
      <circle cx="50%" cy="50%" r="300" fill="url(#circles)" className="animate-spin-slow origin-center opacity-30" />
    </svg>
  </div>
);

// 4. Waveform Animation (CSS Bar for Playlist)
const WaveformBar = ({ color }: { color: string }) => (
  <div className="flex items-end gap-[2px] h-8 opacity-70">
    {[...Array(8)].map((_, i) => (
      <div key={i} className="waveform-bar" style={{ color, animationDelay: `${i * 0.1}s`, animationDuration: `${0.8 + Math.random() * 0.5}s` }} />
    ))}
  </div>
);

// 5. Particle Journey (Canvas) - kept active if PLAYLIST view
const ParticleJourney = ({ active }: { active: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let particles: any[] = [];
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;
    const createParticle = () => ({
      x: Math.random() * w,
      y: h + 10,
      vx: (Math.random() - 0.5) * 1,
      vy: -Math.random() * 2 - 1,
      size: Math.random() * 3 + 1,
      color: `rgba(${100 + Math.random() * 155}, ${200 + Math.random() * 55}, 255, ${Math.random() * 0.5})`
    });
    for (let i = 0; i < 50; i++) particles.push(createParticle());
    let animationId: number;
    const animate = () => {
      ctx.clearRect(0, 0, w, h);
      particles.forEach((p, i) => {
        p.y += p.vy;
        p.x += p.vx;
        p.size *= 0.99;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        if (p.y < -10 || p.size < 0.1) particles[i] = createParticle();
      });
      animationId = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(animationId);
  }, [active]);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none opacity-50" />;
};

// 6. Song Card
const SongCard = ({ song, index }: { song: Song; index: number }) => (
  <div className="glass-card rounded-xl p-5 mb-4 flex gap-5 items-center transform transition-all hover:scale-[1.02] hover:bg-white/5 animate-fade-in-up group relative overflow-hidden" style={{ animationDelay: `${index * 200}ms`, borderLeft: `4px solid ${song.color_hex}` }}>
    <div className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500" style={{ background: `linear-gradient(90deg, ${song.color_hex} 0%, transparent 100%)` }} />
    <div className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center font-display font-bold text-xl shadow-lg z-10 relative" style={{ backgroundColor: song.color_hex, color: '#0F172A' }}>
      {index + 1}
      <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ backgroundColor: song.color_hex }}></div>
    </div>
    <div className="flex-grow z-10">
      <div className="flex justify-between items-center mb-1">
        <div>
          <h3 className="font-display font-bold text-lg text-white group-hover:text-brand-primary transition-colors">{song.title}</h3>
          <p className="text-slate-400 text-sm font-medium">{song.artist}</p>
        </div>
        <WaveformBar color={song.color_hex} />
      </div>
      <p className="text-sm text-slate-300 leading-relaxed opacity-90">{song.therapeutic_note}</p>
    </div>
    <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.title} ${song.artist}`)}`} target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-20" aria-label={`Listen to ${song.title}`} />
  </div>
);

// 7. Axis Radar Chart (Enhanced)
const AxisRadarChart = ({ current, target }: { current: AxisState; target?: AxisState }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(167, 139, 250, 0.5)');
    gradient.addColorStop(1, 'rgba(45, 212, 191, 0.2)');
    chartInstanceRef.current = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Energy', 'Reality', 'Temporal', 'Repetition', 'Hedonic'],
        datasets: [
          {
            label: 'Current',
            data: [current.energy, current.reality, current.temporal, current.repetition, current.hedonic],
            backgroundColor: gradient,
            borderColor: '#A78BFA',
            borderWidth: 3,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#A78BFA',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6
          },
          ...(target ? [{
            label: 'Target',
            data: [target.energy, target.reality, target.temporal, target.repetition, target.hedonic],
            backgroundColor: 'transparent',
            borderColor: 'rgba(45, 212, 191, 0.5)',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0
          }] : [])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 2000, easing: 'easeOutQuart' },
        scales: {
          r: {
            angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            pointLabels: { color: '#94a3b8', font: { family: 'Outfit', size: 12, weight: 500 } },
            ticks: { display: false, backdropColor: 'transparent' },
            min: -1,
            max: 1
          }
        },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', titleFont: { family: 'Outfit' }, bodyFont: { family: 'Inter' }, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } }
      }
    });
    return () => { if (chartInstanceRef.current) chartInstanceRef.current.destroy(); };
  }, [current, target]);
  return <div className="relative h-72 w-full chart-container"><canvas ref={canvasRef} /></div>;
};

// --- Main Application ---

const App = () => {
  const [view, setView] = useState<ViewState>("INPUT");
  const [inputMode, setInputMode] = useState<InputMode>("VOICE");
  const [userState, setUserState] = useState<AxisState | null>(null);
  const [voiceMetrics, setVoiceMetrics] = useState<VoiceMetrics | undefined>(undefined);
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputText, setInputText] = useState("");
  
  const { isRecording, startRecording, stopRecording, audioBlob, analyserRef, metrics, setAudioBlob } = useAudioRecorder();

  // Helper to trigger analysis flow from either Voice or Text
  const handleAnalyze = async () => {
    setLoading(true);
    // Slight delay for visual transitions
    setTimeout(() => setView("ANALYZING"), 300);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // 1. Analyze State (Multimodal if audio exists)
      const analysisSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          energy: { type: Type.NUMBER },
          reality: { type: Type.NUMBER },
          temporal: { type: Type.NUMBER },
          repetition: { type: Type.NUMBER },
          hedonic: { type: Type.NUMBER },
          summary: { type: Type.STRING },
          voice_analysis: {
             type: Type.OBJECT,
             properties: {
               pitch: { type: Type.STRING },
               stability: { type: Type.STRING },
               speed: { type: Type.STRING },
               note: { type: Type.STRING }
             }
          }
        },
        required: ["energy", "reality", "temporal", "repetition", "hedonic", "summary"]
      };

      let contents = [];
      
      if (inputMode === "VOICE" && audioBlob) {
        const base64Audio = await blobToBase64(audioBlob);
        
        // Prepare context string with client-side metrics
        const clientMetricsStr = metrics ? 
          `Client-side metrics detected: RMS(Volume)=${metrics.rms.toFixed(3)}, ZCR(PitchProxy)=${metrics.zcr.toFixed(3)}. ` : "";

        contents = [{
          role: "user",
          parts: [
            { text: `Analyze the user's emotional state from this voice recording. ${clientMetricsStr} 
             Voice often reveals emotions that words hide (trembling, pitch, speed). 
             Map to 5 axes (-1.0 to +1.0). Return JSON including voice_analysis.` },
            { inlineData: { mimeType: "audio/webm", data: base64Audio } }
          ]
        }];
      } else {
        contents = [{
          role: "user",
          parts: [{ text: `Analyze the user's emotional state based on: "${inputText}". Map to 5 axes (-1.0 to +1.0). Return JSON.` }]
        }];
      }

      const analysisResp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents,
        config: { responseMimeType: "application/json", responseSchema: analysisSchema }
      });
      
      const analysisResult = JSON.parse(analysisResp.text!) as any; // Using any to grab optional voice_analysis
      const currentState = {
        energy: analysisResult.energy,
        reality: analysisResult.reality,
        temporal: analysisResult.temporal,
        repetition: analysisResult.repetition,
        hedonic: analysisResult.hedonic,
        summary: analysisResult.summary
      };
      
      setUserState(currentState);
      if (analysisResult.voice_analysis) {
        setVoiceMetrics(analysisResult.voice_analysis);
      } else {
        setVoiceMetrics(undefined);
      }

      // 2. Generate Playlist
      const playlistSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          songs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                artist: { type: Type.STRING },
                target_state: {
                  type: Type.OBJECT,
                  properties: { energy: { type: Type.NUMBER }, reality: { type: Type.NUMBER }, temporal: { type: Type.NUMBER }, repetition: { type: Type.NUMBER }, hedonic: { type: Type.NUMBER } }
                },
                therapeutic_note: { type: Type.STRING },
                color_hex: { type: Type.STRING }
              }
            }
          }
        }
      };

      const playlistResp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: `Current: ${JSON.stringify(currentState)}. Target: ${JSON.stringify(HEALTHY_TARGET)}. ISO Principle playlist. 5 real songs. Max 0.2 shift/axis. Color code emotion.` }] }],
        config: { responseMimeType: "application/json", responseSchema: playlistSchema }
      });

      const playlistData = JSON.parse(playlistResp.text!) as PlaylistResponse;
      setPlaylist(playlistData.songs);
      
      setTimeout(() => {
        setLoading(false);
        setView("PLAYLIST");
      }, 1000);

    } catch (e) {
      console.error(e);
      setLoading(false);
      setView("INPUT");
      alert("Analysis failed. Please try again.");
    }
  };

  const onStopRecording = () => {
    stopRecording();
    // Small delay to allow Blob state to update before triggering analysis
    // In a real app, we'd use a useEffect on audioBlob, but for simplicity:
    setTimeout(() => {
        // We rely on the user clicking "Analyze" or auto-analyzing. 
        // Let's add an "Analyze" button after recording stops.
    }, 100);
  };

  return (
    <>
      <MorphingBackground state={userState} />
      <GeometricOverlay />
      <ParticleJourney active={view === "PLAYLIST"} />

      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4 overflow-hidden">
        
        {/* INPUT VIEW */}
        {view === "INPUT" && !loading && (
          <div className="w-full max-w-2xl animate-fade-in text-center flex flex-col items-center">
            <h1 className="text-5xl md:text-7xl font-display font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-teal-200 via-white to-purple-200 tracking-tight drop-shadow-lg">
              TherapyTune
            </h1>
            <p className="text-slate-300 text-lg mb-8 font-light tracking-wide">
              Music that meets you where you are
            </p>

            {/* Input Mode Toggles */}
            <div className="flex gap-4 mb-8 bg-white/5 p-1 rounded-full border border-white/10">
               <button 
                 onClick={() => setInputMode("VOICE")}
                 className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${inputMode === "VOICE" ? "bg-brand-primary text-slate-900" : "text-slate-400 hover:text-white"}`}
               >
                 Voice (Recommended)
               </button>
               <button 
                 onClick={() => setInputMode("TEXT")}
                 className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${inputMode === "TEXT" ? "bg-brand-primary text-slate-900" : "text-slate-400 hover:text-white"}`}
               >
                 Text
               </button>
            </div>

            <div className="glass-panel rounded-3xl p-1 animate-float w-full relative overflow-hidden transition-all duration-500">
              <div className="bg-slate-900/60 rounded-[22px] p-8 backdrop-blur-xl flex flex-col items-center justify-center min-h-[300px]">
                
                {inputMode === "VOICE" ? (
                    <div className="flex flex-col items-center w-full">
                       {isRecording ? (
                          <div className="w-full">
                             <div className="text-brand-primary animate-pulse mb-4 font-mono text-sm uppercase tracking-widest">● Recording...</div>
                             <LiveWaveform analyser={analyserRef} isRecording={isRecording} />
                             <button 
                               onClick={() => { stopRecording(); }}
                               className="mt-6 w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.4)] transition-all transform hover:scale-105"
                             >
                                <div className="w-8 h-8 bg-white rounded-md" />
                             </button>
                          </div>
                       ) : audioBlob ? (
                          <div className="w-full animate-fade-in-up">
                              <div className="text-teal-300 mb-6 font-display text-xl">Voice Captured</div>
                              <div className="flex gap-4 justify-center">
                                  <button onClick={() => { setAudioBlob(null); startRecording(); }} className="px-6 py-3 rounded-full border border-white/20 text-white hover:bg-white/10 transition-colors">
                                    Record Again
                                  </button>
                                  <button onClick={handleAnalyze} className="px-8 py-3 rounded-full bg-brand-primary text-slate-900 font-bold shadow-lg hover:shadow-brand-primary/50 transition-all">
                                    Analyze Voice
                                  </button>
                              </div>
                          </div>
                       ) : (
                          <>
                            <button 
                               onClick={startRecording}
                               className="relative group w-32 h-32 rounded-full bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 flex items-center justify-center transition-all duration-300 hover:scale-105 hover:border-brand-primary/50"
                            >
                               <div className="absolute inset-0 rounded-full border border-brand-primary/30 scale-110 opacity-0 group-hover:scale-125 group-hover:opacity-100 transition-all duration-700 animate-pulse-slow"></div>
                               <svg className="w-12 h-12 text-white group-hover:text-brand-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                               </svg>
                            </button>
                            <p className="mt-6 text-slate-400 font-light">Tap to speak your feelings</p>
                          </>
                       )}
                    </div>
                ) : (
                    <div className="w-full">
                        <textarea
                        className="w-full h-32 bg-transparent text-xl text-white placeholder-slate-500 focus:outline-none resize-none text-center font-light"
                        placeholder="I feel..."
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        />
                        <div className="flex flex-wrap justify-center gap-2 mt-6">
                        {EXAMPLE_CHIPS.map((chip, i) => (
                            <button
                            key={i}
                            onClick={() => setInputText(chip)}
                            className="px-4 py-2 rounded-full text-xs font-medium bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all border border-white/5 hover:border-brand-primary/50"
                            >
                            {chip}
                            </button>
                        ))}
                        </div>
                        <button
                          onClick={handleAnalyze}
                          disabled={!inputText.trim()}
                          className="mt-8 px-10 py-3 rounded-full bg-brand-primary text-slate-900 font-bold shadow-lg hover:shadow-brand-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          Analyze Text
                        </button>
                    </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ANALYZING VIEW */}
        {(view === "ANALYZING" || loading) && (
          <div className="flex flex-col items-center animate-fade-in">
             <div className="relative w-40 h-40 mb-8">
               {/* Pulsing Rings */}
               <div className="absolute inset-0 rounded-full border-2 border-brand-primary/20 animate-[ping_3s_infinite]" />
               <div className="absolute inset-4 rounded-full border-2 border-brand-accent/30 animate-[ping_3s_infinite_0.5s]" />
               <div className="absolute inset-0 flex items-center justify-center">
                 <div className="w-20 h-20 bg-gradient-to-tr from-brand-primary to-brand-accent rounded-full blur-xl animate-pulse" />
               </div>
             </div>
             <h2 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-200 to-purple-200 animate-pulse text-center">
               {inputMode === "VOICE" ? "Decoding vocal patterns..." : "Listening to your frequency..."}
             </h2>
          </div>
        )}

        {/* RESULTS VIEW */}
        {view === "PLAYLIST" && userState && (
          <div className="w-full max-w-5xl animate-fade-in pb-20">
            
            {/* Header / Nav */}
            <div className="flex justify-between items-end mb-8 px-2">
              <div>
                <h2 className="text-4xl font-display font-bold text-white">Your Healing Journey</h2>
                <div className="h-1 w-20 bg-brand-primary mt-2 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.8)]" />
              </div>
              <button 
                 onClick={() => { setView("INPUT"); setUserState(null); setInputText(""); setAudioBlob(null); setVoiceMetrics(undefined); }}
                 className="text-slate-400 hover:text-white transition-colors text-sm uppercase tracking-widest font-bold"
               >
                 Start Over
               </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Left Col: Stats */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* Voice Analysis Card (Conditional) */}
                {voiceMetrics && (
                    <div className="glass-panel rounded-2xl p-6 border-l-4 border-l-brand-primary bg-brand-primary/5">
                        <div className="flex items-center gap-2 mb-4 text-brand-primary">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                            <span className="text-xs font-bold uppercase tracking-wider">Voice Analysis</span>
                        </div>
                        <p className="text-white font-medium mb-4 italic">"{voiceMetrics.note}"</p>
                        <div className="space-y-3">
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1"><span>Pitch</span><span className="text-white">{voiceMetrics.pitch}</span></div>
                                <div className="h-1 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-teal-400 w-3/4 opacity-80"></div></div>
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1"><span>Stability</span><span className="text-white">{voiceMetrics.stability}</span></div>
                                <div className="h-1 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-purple-400 w-1/2 opacity-80"></div></div>
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1"><span>Speed</span><span className="text-white">{voiceMetrics.speed}</span></div>
                                <div className="h-1 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-pink-400 w-2/3 opacity-80"></div></div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="glass-panel rounded-2xl p-6">
                  <div className="mb-4">
                    <span className="text-xs font-bold text-brand-accent uppercase tracking-wider">Emotional State</span>
                    <p className="text-xl font-display text-white mt-1 leading-snug">"{userState.summary}"</p>
                  </div>
                  <AxisRadarChart current={userState} target={HEALTHY_TARGET} />
                </div>

                {/* Color Journey Timeline */}
                <div className="glass-panel rounded-2xl p-6">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Emotional Shift</h3>
                  <div className="relative h-4 rounded-full overflow-hidden w-full bg-slate-800">
                    <div className="absolute inset-0 flex">
                      {/* Current State Color */}
                      <div className="flex-1 transition-all duration-1000" style={{ backgroundColor: playlist[0]?.color_hex || '#333' }}></div>
                      {playlist.map((s, i) => (
                        <div key={i} className="flex-1 transition-all duration-1000" style={{ backgroundColor: s.color_hex }}></div>
                      ))}
                      {/* Target Color */}
                      <div className="flex-1 bg-brand-primary"></div>
                    </div>
                  </div>
                  <div className="flex justify-between mt-2 text-[10px] text-slate-500 font-mono uppercase">
                    <span>Current</span>
                    <span>Target</span>
                  </div>
                </div>
              </div>

              {/* Right Col: Playlist */}
              <div className="lg:col-span-8">
                {playlist.map((song, idx) => (
                  <SongCard key={idx} song={song} index={idx} />
                ))}
                
                <div className="mt-8 text-center animate-fade-in-up" style={{ animationDelay: '1.2s' }}>
                  <button 
                    className="group relative px-8 py-3 rounded-full bg-slate-800 text-white font-bold transition-all hover:bg-slate-700 overflow-hidden"
                    onClick={() => {
                      const text = playlist.map((s, i) => `${i+1}. ${s.title} - ${s.artist}`).join('\n');
                      navigator.clipboard.writeText(text);
                      alert("Copied to clipboard!");
                    }}
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      Share This Path
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
                    </span>
                    <div className="absolute inset-0 bg-gradient-to-r from-brand-primary/20 to-brand-accent/20 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-500" />
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}
      </main>
    </>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

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
  pitch: string;
  stability: string;
  speed: string;
  note: string;
}

interface AiSuggestion {
  suggested_state: AxisState;
  reasoning: string;
  voice_analysis?: VoiceMetrics;
}

interface Song {
  title: string;
  artist: string;
  target_state: AxisState;
  therapeutic_note: string;
  color_hex: string;
  axis_shifts: AxisState;
}

interface PlaylistResponse {
  songs: Song[];
  journey_narrative: string;
  iso_insight: string;
  total_shift: AxisState;
}

interface GenreOption {
  id: string;
  label: string;
  emoji: string;
}

type ViewState = "INPUT" | "ANALYZING" | "CONFIRMATION" | "PLAYLIST";
type Tab = "SLIDERS" | "VOICE" | "TEXT";

declare var Chart: any;

const HEALTHY_TARGET: AxisState = {
  energy: 0,
  reality: 0.2,
  temporal: 0,
  repetition: 0,
  hedonic: 0.2
};

const INITIAL_STATE: AxisState = {
  energy: 0,
  reality: 0,
  temporal: 0,
  repetition: 0,
  hedonic: 0,
  summary: "Neutral"
};

const GENRE_OPTIONS: GenreOption[] = [
  { id: 'kpop', label: 'K-Pop', emoji: '🇰🇷' },
  { id: 'jpop', label: 'J-Pop', emoji: '🇯🇵' },
  { id: 'pop', label: 'Pop', emoji: '🎤' },
  { id: 'classical', label: 'Classical', emoji: '🎻' },
  { id: 'jazz', label: 'Jazz', emoji: '🎷' },
  { id: 'ambient', label: 'Ambient', emoji: '🌊' },
  { id: 'lofi', label: 'Lo-Fi', emoji: '☕' },
  { id: 'indie', label: 'Indie', emoji: '🎸' },
  { id: 'folk', label: 'Folk/Acoustic', emoji: '🪕' },
  { id: 'rnb', label: 'R&B/Soul', emoji: '💜' },
  { id: 'hiphop', label: 'Hip-Hop', emoji: '🎤' },
  { id: 'rock', label: 'Rock', emoji: '🤘' },
  { id: 'electronic', label: 'Electronic', emoji: '🎛️' },
  { id: 'edm', label: 'EDM', emoji: '🔊' },
];

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
  const [permissionError, setPermissionError] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async () => {
    setPermissionError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

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
      setPermissionError(true);
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

  const analyzeRecordedAudio = async (blob: Blob) => {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const data = audioBuffer.getChannelData(0);
      
      let sumSquares = 0;
      let zeroCrossings = 0;
      for (let i = 0; i < data.length; i++) {
        sumSquares += data[i] * data[i];
        if (i > 0 && ((data[i] >= 0 && data[i-1] < 0) || (data[i] < 0 && data[i-1] >= 0))) {
          zeroCrossings++;
        }
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const zcr = zeroCrossings / data.length;
      
      setMetrics({ rms, zcr });
    } catch (e) {
      console.error("Client side analysis failed", e);
    }
  };

  return { isRecording, startRecording, stopRecording, audioBlob, analyserRef, metrics, setAudioBlob, permissionError };
};

// --- Visual Components ---

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

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 3;
      // Aurora Gradient for Waveform
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

  return <canvas ref={canvasRef} width={600} height={100} className="w-full h-24 rounded-lg bg-black/20" />;
};

const MorphingBackground = ({ state }: { state: AxisState }) => {
  const getGradient = () => {
    const { energy: e, hedonic: h, reality: r } = state;
    // Deep Ocean / Aurora base themes
    if (e < -0.4 && h < -0.4) return "linear-gradient(-45deg, #020617, #0F172A, #1e1b4b, #000000)"; // Abyssal
    else if (r > 0.4 || e > 0.6) return "linear-gradient(-45deg, #312e81, #4c1d95, #be185d, #881337)"; // Intense Aura
    else if (r < -0.4) return "linear-gradient(-45deg, #0f172a, #134e4a, #115e59, #0f172a)"; // Foggy Deep
    else return "linear-gradient(-45deg, #0f172a, #1e293b, #334155, #0f172a)"; // Neutral Deep
  };

  return <div className="fixed inset-0 -z-20 bg-gradient-anim opacity-90 transition-all duration-2000" style={{ backgroundImage: getGradient() }} />;
};

const GeometricOverlay = () => (
  <div className="fixed inset-0 -z-10 opacity-10 pointer-events-none mix-blend-overlay">
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

const WaveformBar = ({ color }: { color: string }) => (
  <div className="flex items-end gap-[2px] h-8 opacity-70">
    {[...Array(8)].map((_, i) => (
      <div key={i} className="waveform-bar" style={{ color, animationDelay: `${i * 0.1}s`, animationDuration: `${0.8 + Math.random() * 0.5}s` }} />
    ))}
  </div>
);

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

const SongCard: React.FC<{ song: Song; index: number }> = ({ song, index }) => {
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <div className="glass-card rounded-xl p-5 mb-4 flex gap-5 items-start transform transition-all hover:scale-[1.02] hover:bg-white/5 animate-fade-in-up group relative overflow-hidden" style={{ animationDelay: `${index * 200}ms`, borderLeft: `4px solid ${song.color_hex}` }}>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500" style={{ background: `linear-gradient(90deg, ${song.color_hex} 0%, transparent 100%)` }} />
      
      {/* Link covers the card but is positioned behind content (z-0). */}
      <a 
        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.title} ${song.artist}`)}`} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="absolute inset-0 z-0" 
        aria-label={`Listen to ${song.title}`} 
      />
      
      <div className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center font-display font-bold text-xl shadow-lg relative mt-1 z-10 pointer-events-none" style={{ backgroundColor: song.color_hex, color: '#0F172A' }}>
        {index + 1}
      </div>
      
      <div className="flex-grow z-10 pointer-events-none">
        <div className="flex justify-between items-center mb-1">
          <div>
            <h3 className="font-display font-bold text-lg text-white group-hover:text-brand-primary transition-colors">{song.title}</h3>
            <p className="text-slate-400 text-sm font-medium">{song.artist}</p>
          </div>
          <WaveformBar color={song.color_hex} />
        </div>
        <p className="text-sm text-slate-300 leading-relaxed opacity-90 mb-3">{song.therapeutic_note}</p>
        
        {/* Buttons: pointer-events-auto ensures they are clickable */}
        <div className="flex gap-2 pointer-events-auto">
           <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFeedback('heavy'); }} className={`text-xs px-3 py-1 rounded-full border transition-colors ${feedback === 'heavy' ? 'bg-white/20 border-white text-white' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>Too Heavy</button>
           <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFeedback('meh'); }} className={`text-xs px-3 py-1 rounded-full border transition-colors ${feedback === 'meh' ? 'bg-white/20 border-white text-white' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>Not Quite</button>
           <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFeedback('good')} } className={`text-xs px-3 py-1 rounded-full border transition-colors ${feedback === 'good' ? 'bg-brand-primary/20 border-brand-primary text-brand-primary' : 'border-brand-primary/30 text-brand-primary/70 hover:bg-brand-primary/10'}`}>Yes! ✓</button>
        </div>
      </div>
    </div>
  );
};

// --- NEW SCIENTIFIC & VISUALIZATION COMPONENTS ---

const AxisSelector = ({ active, onChange }: { active: string, onChange: (axis: string) => void }) => {
    const axes = ['energy', 'reality', 'temporal', 'repetition', 'hedonic'];
    
    return (
      <div className="flex gap-1 p-1 bg-slate-800/50 rounded-lg mb-4">
        {axes.map(axis => (
          <button
            key={axis}
            onClick={() => onChange(axis)}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all
              ${active === axis 
                ? 'bg-gradient-to-r from-teal-400 to-purple-400 text-slate-900 shadow-lg shadow-purple-500/20' 
                : 'text-slate-500 hover:text-white'
              }`}
          >
            {axis.slice(0, 3)}
          </button>
        ))}
      </div>
    );
  };
  
  interface JourneyGraphProps {
    songs: Song[];
    initialState: AxisState;
    targetState: AxisState;
    activeAxis: Exclude<keyof AxisState, 'summary'>;
  }
  
  const JourneyGraph = ({ songs, initialState, targetState, activeAxis }: JourneyGraphProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Axis labels mapping
    const axisLabels: Record<string, { low: string; high: string }> = {
      energy: { low: 'Exhausted', high: 'Wired' },
      reality: { low: 'Foggy', high: 'On Edge' },
      temporal: { low: 'Past-focused', high: 'Future-anxious' },
      repetition: { low: 'Bored', high: 'Obsessing' },
      hedonic: { low: 'Numb', high: 'Overwhelmed' }
    };
  
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
  
      const w = canvas.width;
      const h = canvas.height;
      const padding = 40;
      const graphW = w - padding * 2;
      const graphH = h - padding * 2;
  
      ctx.clearRect(0, 0, w, h);
  
      // Background Gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, 'rgba(239, 68, 68, 0.1)');  // High/Extreme
      bgGrad.addColorStop(0.5, 'rgba(45, 212, 191, 0.1)'); // Healthy Middle
      bgGrad.addColorStop(1, 'rgba(59, 130, 246, 0.1)');  // Low/Extreme
      ctx.fillStyle = bgGrad;
      ctx.fillRect(padding, padding, graphW, graphH);
  
      // Healthy Zone (-0.3 to +0.3)
      const healthyTop = padding + graphH * (1 - (0.3 + 1) / 2);
      const healthyBottom = padding + graphH * (1 - (-0.3 + 1) / 2);
      ctx.fillStyle = 'rgba(45, 212, 191, 0.15)';
      ctx.fillRect(padding, healthyTop, graphW, healthyBottom - healthyTop);
      
      // Center Line (0)
      const centerY = padding + graphH / 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(padding, centerY);
      ctx.lineTo(w - padding, centerY);
      ctx.stroke();
      ctx.setLineDash([]);
  
      // Axis Labels
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Outfit';
      ctx.textAlign = 'right';
      ctx.fillText(axisLabels[activeAxis].high, padding - 5, padding + 10);
      ctx.fillText('0', padding - 5, centerY + 3);
      ctx.fillText(axisLabels[activeAxis].low, padding - 5, h - padding);
  
      // Calculate Points
      // Normalize values from -1...1 to 0...1 for canvas Y (inverted)
      const getY = (val: number) => padding + graphH * (1 - (val + 1) / 2);
      
      const points = [
        { x: padding, y: getY(initialState[activeAxis]), label: 'Start', color: '#F472B6' },
        ...songs.map((song, i) => ({
          x: padding + graphW * ((i + 1) / (songs.length + 1)),
          y: getY(song.target_state[activeAxis]),
          label: `Song ${i + 1}`,
          color: song.color_hex
        })),
        { x: w - padding, y: getY(targetState[activeAxis]), label: 'Target', color: '#2DD4BF' }
      ];
  
      // Draw Curve
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      
      for (let i = 1; i < points.length; i++) {
        const xc = (points[i].x + points[i - 1].x) / 2;
        const yc = (points[i].y + points[i - 1].y) / 2;
        ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
  
      // Draw Points
      points.forEach((p, i) => {
        // Glow effect
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === 0 || i === points.length - 1 ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
  
        // Labels
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '9px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(p.label, p.x, p.y + 20);
        
        // Values
        const value = i === 0 ? initialState[activeAxis] : 
                      i === points.length - 1 ? targetState[activeAxis] : 
                      songs[i - 1].target_state[activeAxis];
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(value.toFixed(1), p.x, p.y - 12);
      });
  
    }, [songs, initialState, targetState, activeAxis]);
  
    return (
      <div className="relative">
        <canvas ref={canvasRef} width={500} height={200} className="w-full" />
      </div>
    );
  };
  
  interface ISOExplanationProps {
    initialState: AxisState;
    journeyNarrative: string;
    isoInsight: string;
    totalShift: AxisState;
  }
  
  const ISOExplanation = ({ initialState, journeyNarrative, isoInsight, totalShift }: ISOExplanationProps) => {
    const [expanded, setExpanded] = useState(false);
  
    // Find extreme axis
    // Filter ensures we only look at numeric values and excludes 'summary'
    const extremeAxis = Object.entries(initialState)
      .filter((entry): entry is [string, number] => entry[0] !== 'summary' && typeof entry[1] === 'number')
      .reduce((max, [key, val]) => 
        Math.abs(val) > Math.abs(max.val) ? { axis: key, val } : max, 
        { axis: 'energy', val: 0 }
      );
  
    const getInsightText = () => {
      if (extremeAxis.val < -0.4) {
        return {
          title: "Why we're starting low",
          body: `Your ${extremeAxis.axis} is at ${extremeAxis.val.toFixed(1)}. Research shows that jumping to high-energy music when feeling depleted can feel dismissive. By starting with music that matches your state, we create space for your feelings before gently shifting.`,
          citation: "Thaut, M.H. (2005). Rhythm, Music, and the Brain"
        };
      } else if (extremeAxis.val > 0.4) {
        return {
          title: "Why we're easing down",
          body: `Your ${extremeAxis.axis} is elevated at ${extremeAxis.val.toFixed(1)}. Rather than suppressing this with slow music immediately, we match your intensity first, then gradually introduce calmer elements. This respects your current energy.`,
          citation: "Saarikallio, S. (2011). Music as emotional self-regulation"
        };
      } else {
        return {
          title: "Fine-tuning your balance",
          body: `Your emotional state is relatively balanced. We're making subtle adjustments to optimize your wellbeing, focusing on gentle shifts rather than dramatic changes.`,
          citation: "Juslin, P.N. (2013). From everyday emotions to aesthetic emotions"
        };
      }
    };
  
    const insight = getInsightText();
  
    return (
      <div className="glass-panel rounded-2xl p-6 mb-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-brand-primary/20 flex items-center justify-center">
            <span className="text-lg">🧠</span>
          </div>
          <div>
            <h3 className="font-display font-bold text-white">ISO Principle Applied</h3>
            <p className="text-xs text-slate-400">Evidence-based music selection</p>
          </div>
        </div>
  
        {/* Insight */}
        <div className="bg-slate-800/50 rounded-xl p-4 mb-4 border-l-4 border-brand-primary">
          <h4 className="text-sm font-bold text-brand-primary mb-2">{insight.title}</h4>
          <p className="text-sm text-slate-300 leading-relaxed">{insight.body}</p>
          <p className="text-[10px] text-slate-500 mt-2 italic">📚 {insight.citation}</p>
        </div>
  
        {/* Narrative */}
        <div className="mb-4">
          <p className="text-sm text-slate-300 leading-relaxed italic border-l-2 border-white/20 pl-3">
            "{journeyNarrative}"
          </p>
        </div>
  
        {/* Expansion */}
        <button 
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-brand-primary hover:text-brand-accent transition-colors flex items-center gap-1 font-medium"
        >
          {expanded ? '▼' : '▶'} View detailed shift analysis
        </button>
  
        {expanded && (
          <div className="mt-4 pt-4 border-t border-white/10 animate-fade-in">
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Total Axis Movement</h4>
            <div className="grid grid-cols-5 gap-2 text-center">
              {Object.entries(totalShift)
                .filter((entry): entry is [string, number] => entry[0] !== 'summary' && typeof entry[1] === 'number')
                .map(([axis, shift]) => (
                <div key={axis} className="bg-slate-800/30 rounded-lg p-2">
                  <div className="text-[10px] text-slate-500 capitalize mb-1">{axis.slice(0,3)}</div>
                  <div className={`text-xs font-bold ${
                    shift > 0 ? 'text-teal-400' : 
                    shift < 0 ? 'text-purple-400' : 'text-slate-400'
                  }`}>
                    {shift > 0 ? '+' : ''}{shift.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
            
            {isoInsight && (
              <div className="mt-4 p-3 bg-brand-primary/10 rounded-lg border border-brand-primary/20">
                <p className="text-xs text-brand-primary">💡 {isoInsight}</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

const AxisRadarChart = ({ current, target, suggestion }: { current: AxisState; target?: AxisState, suggestion?: AxisState }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // Aurora Gradient for Chart Fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(45, 212, 191, 0.4)'); // Teal
    gradient.addColorStop(0.5, 'rgba(167, 139, 250, 0.3)'); // Purple
    gradient.addColorStop(1, 'rgba(244, 114, 182, 0.1)'); // Pink

    const datasets: any[] = [
      {
        label: 'My Settings',
        data: [current.energy, current.reality, current.temporal, current.repetition, current.hedonic],
        backgroundColor: gradient,
        borderColor: '#2DD4BF', // Bright Teal Border
        borderWidth: 2,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#2DD4BF',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      }
    ];

    if (suggestion) {
       datasets.push({
        label: 'Suggested',
        data: [suggestion.energy, suggestion.reality, suggestion.temporal, suggestion.repetition, suggestion.hedonic],
        backgroundColor: 'rgba(251, 146, 60, 0.2)', // Orange tint
        borderColor: '#FB923C',
        borderWidth: 2,
        pointBackgroundColor: '#FB923C',
        pointBorderColor: '#fff',
        pointBorderWidth: 1,
        pointRadius: 3
       });
    }

    if (target) {
       datasets.push({
        label: 'Target',
        data: [target.energy, target.reality, target.temporal, target.repetition, target.hedonic],
        backgroundColor: 'transparent',
        borderColor: 'rgba(255, 255, 255, 0.3)',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0
      });
    }

    chartInstanceRef.current = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Energy', 'Reality', 'Temporal', 'Repetition', 'Hedonic'],
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1000 },
        scales: {
          r: {
            angleLines: { color: 'rgba(255, 255, 255, 0.05)' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            pointLabels: { color: '#94a3b8', font: { family: 'Outfit', size: 10, weight: 600 } },
            ticks: { display: false, backdropColor: 'transparent' },
            min: -1,
            max: 1
          }
        },
        plugins: { 
            legend: { 
                display: true, 
                labels: { color: '#cbd5e1', font: {family: 'Outfit'} } 
            } 
        }
      }
    });
    return () => { if (chartInstanceRef.current) chartInstanceRef.current.destroy(); };
  }, [current, target, suggestion]);
  return <div className="relative h-64 w-full chart-container"><canvas ref={canvasRef} /></div>;
};

// Updated Chakra Slider with specific gradients
const AxisSlider = ({ label, lowLabel, highLabel, value, onChange, gradient }: { label: string, lowLabel: string, highLabel: string, value: number, onChange: (v: number) => void, gradient: string }) => (
  <div className="mb-5 animate-fade-in-up">
    <div className="flex justify-between text-xs text-slate-400 mb-2 font-medium tracking-wide">
      <span className="w-20 text-left opacity-70">{lowLabel}</span>
      <span className="text-white font-bold tracking-widest uppercase">{label}</span>
      <span className="w-20 text-right opacity-70">{highLabel}</span>
    </div>
    <div className="relative h-4 w-full flex items-center">
        {/* Custom Track Background */}
        <div 
            className="absolute w-full h-1.5 rounded-full opacity-80"
            style={{ background: gradient }}
        />
        <input 
        type="range" 
        min="-1" max="1" step="0.1" 
        value={value}
        aria-label={`${label} slider`}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full absolute z-10 appearance-none cursor-pointer h-full opacity-100 bg-transparent focus:outline-none"
        />
    </div>
  </div>
);

const GenreSelector = ({ selected, setSelected, excluded, setExcluded }: { 
    selected: string[], 
    setSelected: (s: string[]) => void, 
    excluded: string[], 
    setExcluded: (s: string[]) => void 
}) => (
  <div className="mb-8 animate-fade-in">
    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
      <span className="text-aurora">🎵 What music do you like?</span>
    </h3>
    <div className="flex flex-wrap gap-2 mb-4">
      {GENRE_OPTIONS.map((genre) => (
        <button
          key={genre.id}
          onClick={() => {
            if (selected.includes(genre.id)) {
              setSelected(selected.filter(g => g !== genre.id));
            } else {
              setSelected([...selected, genre.id]);
              setExcluded(excluded.filter(g => g !== genre.id));
            }
          }}
          className={`px-3 py-2 rounded-full text-xs font-medium transition-all duration-300 flex items-center gap-1 border
            ${selected.includes(genre.id) 
              ? 'bg-aurora text-slate-900 border-transparent shadow-[0_0_15px_rgba(167,139,250,0.5)] transform scale-105 font-bold' 
              : 'bg-slate-800/40 text-slate-400 border-white/5 hover:bg-slate-700/50 hover:border-white/10 hover:text-slate-200'
            }`}
        >
          <span>{genre.emoji}</span> {genre.label}
        </button>
      ))}
    </div>
    
    <details className="text-slate-500">
      <summary className="cursor-pointer text-xs hover:text-slate-300 font-medium transition-colors">
        ❌ Exclude genres (optional)
      </summary>
      <div className="flex flex-wrap gap-2 mt-3 p-3 bg-black/20 rounded-xl border border-white/5">
        {GENRE_OPTIONS.map((genre) => (
          <button
            key={genre.id}
            onClick={() => {
              if (excluded.includes(genre.id)) {
                setExcluded(excluded.filter(g => g !== genre.id));
              } else {
                setExcluded([...excluded, genre.id]);
                setSelected(selected.filter(g => g !== genre.id));
              }
            }}
            className={`px-3 py-1 rounded-full text-[10px] transition-all
              ${excluded.includes(genre.id) 
                ? 'bg-red-500/20 text-red-300 border border-red-500/30' 
                : 'bg-slate-800/40 text-slate-500 hover:bg-slate-700/50'
              }`}
          >
            {genre.label}
          </button>
        ))}
      </div>
    </details>
  </div>
);

// --- Main Application ---

const App = () => {
  const [view, setView] = useState<ViewState>("INPUT");
  const [activeTab, setActiveTab] = useState<Tab>("SLIDERS");
  const [manualState, setManualState] = useState<AxisState>(INITIAL_STATE);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [playlistResult, setPlaylistResult] = useState<PlaylistResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Processing...");
  const [inputText, setInputText] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [excludedGenres, setExcludedGenres] = useState<string[]>([]);
  const [activeGraphAxis, setActiveGraphAxis] = useState<string>('energy');
  
  const { isRecording, startRecording, stopRecording, audioBlob, analyserRef, metrics, setAudioBlob, permissionError } = useAudioRecorder();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSliderChange = (axis: keyof AxisState, val: number) => {
    setManualState(prev => ({ ...prev, [axis]: val }));
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setInputText(content);
    };
    reader.readAsText(file);
  };

  const handleAnalyzeContext = async () => {
    setLoading(true);
    setLoadingMessage("Analyzing your state...");
    setView("ANALYZING");

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const analysisSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          suggested_state: {
            type: Type.OBJECT,
            properties: {
               energy: { type: Type.NUMBER },
               reality: { type: Type.NUMBER },
               temporal: { type: Type.NUMBER },
               repetition: { type: Type.NUMBER },
               hedonic: { type: Type.NUMBER },
               summary: { type: Type.STRING }
            }
          },
          reasoning: { type: Type.STRING },
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
        required: ["suggested_state", "reasoning"]
      };

      let contents = [];
      
      if (activeTab === "VOICE" && audioBlob) {
        const base64Audio = await blobToBase64(audioBlob);
        const clientMetricsStr = metrics ? `Metrics: RMS=${metrics.rms.toFixed(2)}, ZCR=${metrics.zcr.toFixed(2)}.` : "";
        contents = [{
          role: "user",
          parts: [
            { text: `The user set their state to: ${JSON.stringify(manualState)}. 
             Based on the voice recording (${clientMetricsStr}), suggest adjustments to these coordinates.
             Return 'suggested_state' and 'reasoning'. Do not simply override unless the voice strongly suggests otherwise (e.g., detected tremors, slow speed).` },
            { inlineData: { mimeType: "audio/webm", data: base64Audio } }
          ]
        }];
      } else {
        contents = [{
          role: "user",
          parts: [{ text: `The user set their state to: ${JSON.stringify(manualState)}. 
             They provided this context (which might be a short text or a journal entry): "${inputText}". 
             Suggest adjustments to the state coordinates based on this text. Return 'suggested_state' and 'reasoning'.` }]
        }];
      }

      const resp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents,
        config: { responseMimeType: "application/json", responseSchema: analysisSchema }
      });
      
      const text = resp.text;
      if (!text) throw new Error("No response text from AI");
      
      const result = JSON.parse(text) as AiSuggestion;
      setAiSuggestion(result);
      setLoading(false);
      setView("CONFIRMATION");

    } catch (e) {
      console.error(e);
      setLoading(false);
      setView("INPUT");
      alert("Hmm, something went wrong with the analysis. Please try again.");
    }
  };

  const generatePlaylist = async (finalState: AxisState) => {
    setLoading(true);
    setLoadingMessage("Curating your therapeutic journey...");
    setView("ANALYZING"); // Re-use analyzing view for loading playlist

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
                    color_hex: { type: Type.STRING },
                    axis_shifts: {
                        type: Type.OBJECT,
                        properties: { energy: { type: Type.NUMBER }, reality: { type: Type.NUMBER }, temporal: { type: Type.NUMBER }, repetition: { type: Type.NUMBER }, hedonic: { type: Type.NUMBER } }
                    }
                  }
                }
              },
              journey_narrative: { type: Type.STRING },
              iso_insight: { type: Type.STRING },
              total_shift: {
                type: Type.OBJECT,
                properties: { energy: { type: Type.NUMBER }, reality: { type: Type.NUMBER }, temporal: { type: Type.NUMBER }, repetition: { type: Type.NUMBER }, hedonic: { type: Type.NUMBER } }
              }
            }
          };

          const genreStr = selectedGenres.length > 0 ? `Preferred genres: ${selectedGenres.join(', ')}. ` : 'No preference';
          const excludeStr = excludedGenres.length > 0 ? `NEVER include: ${excludedGenres.join(', ')}. ` : '';
          
          const prompt = `
            You are a music therapy AI using the ISO Principle (Isoprinciple).

            ## Current State Analysis
            User's emotional coordinates: ${JSON.stringify(finalState)}
            Target (healthy baseline): ${JSON.stringify(HEALTHY_TARGET)}

            ## ISO Principle Rules
            The ISO Principle states: "Meet the client where they are, then gradually guide them."
            - Song 1: MUST match current state (±0.1 tolerance)
            - Each song shifts MAX 0.2 per axis toward target
            - Never jump directly to opposite emotion
            - The journey matters more than the destination

            ## Genre Preferences
            ${genreStr}
            ${excludeStr}

            ## Output Requirements
            For each of 5 songs, provide:
            1. title, artist (REAL songs only)
            2. target_state (exact coordinates this song represents)
            3. therapeutic_note (1 sentence: why this song at this position)
            4. color_hex (emotion color)
            5. axis_shifts (how much each axis changed from previous song)

            Also provide:
            - journey_narrative: 2-3 sentences explaining the overall emotional arc
            - iso_insight: A surprising fact about why starting sad/intense helps (if applicable)
            - total_shift: Summary of movement on each axis across all 5 songs

            IMPORTANT: 
            - If user selected K-Pop/J-Pop, include those languages.
            - Do NOT start with upbeat music for depressed/low energy states.
          `;
    
          const resp = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ 
                role: "user", 
                parts: [{ text: prompt }] 
            }],
            config: { responseMimeType: "application/json", responseSchema: playlistSchema }
          });
    
          const text = resp.text;
          if (!text) throw new Error("No response text from AI");

          const data = JSON.parse(text) as PlaylistResponse;
          setPlaylistResult(data);
          setLoading(false);
          setView("PLAYLIST");
    } catch (e) {
        console.error(e);
        setLoading(false);
        setView("INPUT"); // Fallback
        alert("Hmm, something went wrong generating the playlist. Please try again.");
    }
  };

  // Validation
  const canProceed = selectedGenres.length > 0;

  return (
    <>
      <MorphingBackground state={manualState} />
      <GeometricOverlay />
      <ParticleJourney active={view === "PLAYLIST"} />

      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4 overflow-hidden">
        
        {/* HEADER */}
        {view !== "PLAYLIST" && (
            <div className="w-full max-w-2xl text-center mb-6 animate-fade-in">
                <h1 className="text-4xl md:text-6xl font-display font-bold mb-2 text-aurora tracking-tight">
                TherapyTune
                </h1>
                <p className="text-slate-300 text-lg font-light tracking-wide">
                Music for Your Mood
                </p>
            </div>
        )}

        {/* INPUT VIEW */}
        {view === "INPUT" && (
          <div className="w-full max-w-4xl glass-panel rounded-3xl p-1 animate-float relative overflow-hidden transition-all duration-500">
             <div className="bg-slate-900/80 rounded-[22px] p-6 backdrop-blur-xl min-h-[500px] flex flex-col md:flex-row gap-8">
                
                {/* Left: Visualization (Always Visible) */}
                <div className="w-full md:w-1/2 flex flex-col justify-center">
                   <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 text-center">Your Settings</h3>
                   <div className="bg-slate-800/50 rounded-2xl p-4 border border-white/5 shadow-inner">
                      <AxisRadarChart current={manualState} target={HEALTHY_TARGET} />
                   </div>
                   <p className="text-center text-xs text-slate-500 mt-4 px-8">
                      Adjust the sliders to match how you feel right now. We'll find music that resonates.
                   </p>
                </div>

                {/* Right: Controls */}
                <div className="w-full md:w-1/2 flex flex-col">
                   
                   {/* Genre Selection - Always visible in Input Flow */}
                   <GenreSelector 
                      selected={selectedGenres} 
                      setSelected={setSelectedGenres}
                      excluded={excludedGenres}
                      setExcluded={setExcludedGenres}
                   />

                   {/* Tabs */}
                   <div className="flex gap-2 mb-6 p-1 bg-slate-800/50 rounded-lg">
                      <button onClick={() => setActiveTab("SLIDERS")} className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${activeTab === "SLIDERS" ? "bg-aurora text-slate-900 shadow-lg" : "text-slate-400 hover:text-white"}`}>Controls</button>
                      <button onClick={() => setActiveTab("VOICE")} className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${activeTab === "VOICE" ? "bg-aurora text-slate-900 shadow-lg" : "text-slate-400 hover:text-white"}`}>+ Voice</button>
                      <button onClick={() => setActiveTab("TEXT")} className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${activeTab === "TEXT" ? "bg-aurora text-slate-900 shadow-lg" : "text-slate-400 hover:text-white"}`}>+ Journal</button>
                   </div>

                   {/* Tab Content */}
                   <div className="flex-grow overflow-y-auto pr-2 custom-scrollbar" style={{maxHeight: '400px'}}>
                      
                      {activeTab === "SLIDERS" && (
                          <div className="animate-fade-in">
                              <AxisSlider 
                                label="Energy" 
                                lowLabel="Exhausted" 
                                highLabel="Wired" 
                                value={manualState.energy} 
                                onChange={(v) => handleSliderChange('energy', v)} 
                                gradient="linear-gradient(90deg, #4f46e5 0%, #ec4899 100%)"
                              />
                              <AxisSlider 
                                label="Reality" 
                                lowLabel="Foggy" 
                                highLabel="On Edge" 
                                value={manualState.reality} 
                                onChange={(v) => handleSliderChange('reality', v)} 
                                gradient="linear-gradient(90deg, #2563eb 0%, #22d3ee 100%)"
                              />
                              <AxisSlider 
                                label="Temporal" 
                                lowLabel="Past" 
                                highLabel="Future" 
                                value={manualState.temporal} 
                                onChange={(v) => handleSliderChange('temporal', v)} 
                                gradient="linear-gradient(90deg, #0d9488 0%, #34d399 100%)"
                              />
                              <AxisSlider 
                                label="Repetition" 
                                lowLabel="Bored" 
                                highLabel="Obsessing" 
                                value={manualState.repetition} 
                                onChange={(v) => handleSliderChange('repetition', v)} 
                                gradient="linear-gradient(90deg, #ea580c 0%, #fbbf24 100%)"
                              />
                              <AxisSlider 
                                label="Hedonic" 
                                lowLabel="Numb" 
                                highLabel="Overwhelmed" 
                                value={manualState.hedonic} 
                                onChange={(v) => handleSliderChange('hedonic', v)} 
                                gradient="linear-gradient(90deg, #c026d3 0%, #e879f9 100%)"
                              />
                              
                              <button 
                                onClick={() => generatePlaylist(manualState)}
                                disabled={!canProceed}
                                className="w-full mt-4 py-4 rounded-xl bg-aurora text-slate-900 font-bold text-lg shadow-lg hover:shadow-brand-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02]"
                              >
                                {canProceed ? "Find Music for This Mood" : "Select at least 1 genre"}
                              </button>
                          </div>
                      )}

                      {activeTab === "VOICE" && (
                          <div className="flex flex-col items-center h-full animate-fade-in pt-4">
                             {permissionError && (
                                <div className="w-full mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-200 text-xs text-center">
                                  Microphone Access Denied. Please enable permissions.
                                </div>
                             )}
                             
                             <div className="flex-grow flex flex-col items-center justify-center w-full">
                                {isRecording ? (
                                    <>
                                        <div className="text-brand-primary animate-pulse mb-4 font-mono text-xs uppercase">Recording...</div>
                                        <LiveWaveform analyser={analyserRef} isRecording={isRecording} />
                                        <button onClick={() => stopRecording()} className="mt-8 w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg transition-transform hover:scale-110">
                                            <div className="w-6 h-6 bg-white rounded-sm" />
                                        </button>
                                    </>
                                ) : audioBlob ? (
                                    <div className="w-full text-center">
                                        <div className="text-teal-300 mb-4 font-display text-lg">Voice Captured</div>
                                        <div className="flex flex-col gap-3">
                                            <button 
                                                onClick={handleAnalyzeContext} 
                                                disabled={!canProceed}
                                                className="w-full py-3 rounded-xl bg-aurora text-slate-900 font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                            >
                                                {canProceed ? "Check with AI" : "Select a genre first"}
                                            </button>
                                            <button onClick={() => { setAudioBlob(null); startRecording(); }} className="w-full py-3 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 transition-all">
                                                Record Again
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button onClick={startRecording} className="group w-24 h-24 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center hover:border-brand-primary hover:bg-slate-700 transition-all">
                                        <svg className="w-10 h-10 text-slate-300 group-hover:text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                                    </button>
                                )}
                             </div>
                             <p className="text-xs text-slate-500 mt-4 text-center px-4">
                                Use voice to help refine the sliders. AI will suggest adjustments, but you stay in control.
                             </p>
                          </div>
                      )}

                      {activeTab === "TEXT" && (
                          <div className="flex flex-col h-full animate-fade-in">
                            {/* File Upload Button */}
                            <div className="mb-2 flex justify-end">
                                <input 
                                    type="file" 
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    accept=".md,.txt,.markdown"
                                    className="hidden"
                                />
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="text-xs flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
                                >
                                    <span className="text-lg">📄</span> Upload Journal/MD
                                </button>
                            </div>

                             <textarea
                                className="w-full h-40 bg-slate-800/50 rounded-xl p-4 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-primary resize-none text-base"
                                placeholder="Describe how you're feeling or upload a journal entry..."
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                             />
                             <button 
                                onClick={handleAnalyzeContext}
                                disabled={!inputText.trim() || !canProceed}
                                className="w-full mt-4 py-3 rounded-xl bg-aurora text-slate-900 font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                             >
                                {canProceed ? "Check with AI" : "Select a genre first"}
                             </button>
                             <p className="text-xs text-slate-500 mt-4 text-center">
                                AI will read this text or uploaded file and suggest slider adjustments.
                             </p>
                          </div>
                      )}

                   </div>
                </div>
             </div>
          </div>
        )}

        {/* LOADING VIEW */}
        {view === "ANALYZING" && (
            <div className="flex flex-col items-center animate-fade-in">
                <div className="relative w-24 h-24 mb-6">
                <div className="absolute inset-0 rounded-full border-t-2 border-brand-primary animate-spin" />
                <div className="absolute inset-2 rounded-full border-r-2 border-brand-accent animate-spin-slow" />
                </div>
                <h2 className="text-xl font-display font-medium text-slate-300 animate-pulse">
                   {loadingMessage}
                </h2>
            </div>
        )}

        {/* CONFIRMATION VIEW */}
        {view === "CONFIRMATION" && aiSuggestion && (
            <div className="w-full max-w-2xl glass-panel rounded-3xl p-8 animate-fade-in-up">
                <h2 className="text-2xl font-display font-bold text-white mb-2 text-center">Suggestion</h2>
                <div className="flex justify-center mb-6">
                    <div className="h-1 w-16 bg-brand-accent rounded-full" />
                </div>

                <div className="flex flex-col md:flex-row gap-8 mb-8">
                     <div className="w-full md:w-1/2">
                        <AxisRadarChart current={manualState} suggestion={aiSuggestion.suggested_state} />
                        <div className="flex justify-center gap-4 mt-2 text-xs">
                           <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-brand-accent"/> My Settings</div>
                           <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-400"/> Suggested</div>
                        </div>
                     </div>
                     <div className="w-full md:w-1/2 flex flex-col justify-center">
                        <p className="text-slate-300 text-lg leading-relaxed mb-4">"{aiSuggestion.reasoning}"</p>
                        {aiSuggestion.voice_analysis && (
                            <div className="bg-slate-800/50 p-3 rounded-lg border border-white/5 mb-4">
                                <p className="text-xs text-brand-primary font-bold uppercase mb-1">What we heard</p>
                                <p className="text-sm text-slate-400">"{aiSuggestion.voice_analysis.note}"</p>
                            </div>
                        )}
                     </div>
                </div>

                <div className="flex gap-4">
                    <button 
                       onClick={() => {
                           setManualState(aiSuggestion.suggested_state);
                           generatePlaylist(aiSuggestion.suggested_state);
                       }}
                       className="flex-1 py-3 bg-brand-primary text-slate-900 rounded-xl font-bold hover:bg-brand-primary/90 transition-all"
                    >
                        Accept & Find Music
                    </button>
                    <button 
                       onClick={() => generatePlaylist(manualState)}
                       className="flex-1 py-3 bg-slate-800 text-white border border-slate-600 rounded-xl font-medium hover:bg-slate-700 transition-all"
                    >
                        Keep My Settings
                    </button>
                </div>
            </div>
        )}

        {/* RESULTS VIEW */}
        {view === "PLAYLIST" && playlistResult && (
          <div className="w-full max-w-5xl animate-fade-in pb-20">
            <div className="flex justify-between items-end mb-8 px-2">
              <div>
                <h2 className="text-4xl font-display font-bold text-white">Your Healing Journey</h2>
                <div className="h-1 w-20 bg-brand-primary mt-2 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.8)]" />
              </div>
              <button 
                 onClick={() => { setView("INPUT"); setInputText(""); setAudioBlob(null); setAiSuggestion(null); setSelectedGenres([]); setExcludedGenres([]); setPlaylistResult(null); }}
                 className="text-slate-400 hover:text-white transition-colors text-sm uppercase tracking-widest font-bold"
               >
                 Start Over
               </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Col */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* Radar Chart */}
                <div className="glass-panel rounded-2xl p-6">
                  <div className="mb-4">
                    <span className="text-xs font-bold text-brand-accent uppercase tracking-wider">Final Settings</span>
                  </div>
                  <AxisRadarChart current={manualState} target={HEALTHY_TARGET} />
                </div>
                
                {/* Journey Graph */}
                <div className="glass-panel rounded-2xl p-6">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">
                    Emotional Journey
                  </span>
                  <AxisSelector active={activeGraphAxis} onChange={setActiveGraphAxis} />
                  <JourneyGraph 
                    songs={playlistResult.songs}
                    initialState={manualState}
                    targetState={HEALTHY_TARGET}
                    activeAxis={activeGraphAxis as Exclude<keyof AxisState, 'summary'>}
                  />
                  <p className="text-[10px] text-slate-500 mt-2 text-center">
                    Each point shows how this axis shifts through your playlist
                  </p>
                </div>

                {selectedGenres.length > 0 && (
                    <div className="glass-panel rounded-2xl p-6">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">Preferred Genres</span>
                        <div className="flex flex-wrap gap-2">
                            {selectedGenres.map(gid => {
                                const g = GENRE_OPTIONS.find(opt => opt.id === gid);
                                return <span key={gid} className="text-xs bg-brand-primary/10 text-brand-primary px-2 py-1 rounded border border-brand-primary/20">{g?.emoji} {g?.label}</span>
                            })}
                        </div>
                    </div>
                )}
              </div>

              {/* Right Col */}
              <div className="lg:col-span-8">
                
                {/* ISO Explanation */}
                <ISOExplanation 
                    initialState={manualState}
                    journeyNarrative={playlistResult.journey_narrative}
                    isoInsight={playlistResult.iso_insight}
                    totalShift={playlistResult.total_shift}
                />

                {/* Color Timeline */}
                <div className="mb-6 animate-fade-in-up">
                  <div className="flex h-3 rounded-full overflow-hidden shadow-lg border border-white/5">
                    {playlistResult.songs.map((song, i) => (
                      <div 
                        key={i} 
                        className="flex-1 transition-all hover:flex-[1.5] cursor-pointer relative group"
                        style={{ backgroundColor: song.color_hex }}
                      >
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 border border-white/10 px-2 py-1 rounded text-[10px] whitespace-nowrap z-20">
                          {song.title}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1 px-1">
                    <span>Start</span>
                    <span className="tracking-widest">→ JOURNEY →</span>
                    <span>Target</span>
                  </div>
                </div>

                {playlistResult.songs.map((song, idx) => (
                  <SongCard key={idx} song={song} index={idx} />
                ))}
                
                <div className="mt-12 pt-8 border-t border-white/10 text-center">
                   <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                      DISCLAIMER: TherapyTune uses the ISO Principle, an evidence-based approach in music therapy. 
                      This is a music discovery tool, not a replacement for professional mental health care.
                   </p>
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
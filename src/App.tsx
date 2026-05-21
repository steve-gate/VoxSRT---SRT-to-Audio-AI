/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  FileAudio, 
  Upload, 
  Play, 
  Loader2, 
  Languages, 
  Download, 
  CheckCircle2, 
  AlertCircle,
  Settings,
  Mic2,
  Trash2,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parseSrt } from './lib/srtParser';
import { generateSpeechFromGemini, createWavBlob, playRawPCM, base64ToUint8Array } from './lib/gemini';
import { SrtSegment, VoiceName } from './types';

const LANGUAGES = [
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'zh', name: '中文' },
];

const VOICES: VoiceName[] = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

export default function App() {
  const [segments, setSegments] = useState<SrtSegment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>('Kore');
  const [language, setLanguage] = useState('vi');
  const [error, setError] = useState<string | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      try {
        const parsed = parseSrt(content);
        setSegments(parsed);
        setError(null);
      } catch (err) {
        setError('Không thể phân tích tệp SRT. Vui lòng kiểm tra định dạng.');
      }
    };
    reader.readAsText(file);
  };

  const generateSegmentAudio = async (segmentId: number) => {
    const segment = segments.find(s => s.id === segmentId);
    if (!segment || segment.audioUrl) return;

    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, isGenerating: true } : s));

    try {
      const base64 = await generateSpeechFromGemini(segment.text, selectedVoice, language);
      const blob = createWavBlob(base64);
      const url = URL.createObjectURL(blob);
      
      setSegments(prev => prev.map(s => s.id === segmentId ? { 
        ...s, 
        audioUrl: url, 
        isGenerating: false,
        // Store the base64 for potentially combining later if needed
        metadata: { base64 } 
      } : s));
    } catch (err) {
      setError(`Lỗi khi tạo âm thanh cho phân đoạn ${segmentId}`);
      setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, isGenerating: false } : s));
    }
  };

  const playSegment = async (id: number) => {
    const segment = segments.find(s => s.id === id);
    if (!segment) return;

    if (segment.audioUrl) {
      const audio = new Audio(segment.audioUrl);
      setActiveSegmentId(id);
      audio.onended = () => setActiveSegmentId(null);
      audio.play();
    } else {
      setActiveSegmentId(id);
      try {
        await generateSegmentAudio(id);
        const updated = segments.find(s => s.id === id);
        if (updated?.audioUrl) {
          const audio = new Audio(updated.audioUrl);
          audio.onended = () => setActiveSegmentId(null);
          audio.play();
        }
      } catch (err) {
        setActiveSegmentId(null);
      }
    }
  };

  const generateAll = async () => {
    setIsProcessing(true);
    setError(null);
    
    for (const segment of segments) {
      if (!segment.audioUrl) {
        await generateSegmentAudio(segment.id);
      }
    }
    
    setIsProcessing(false);
  };

  const downloadCombined = () => {
    const validSegments = segments.filter(s => (s as any).metadata?.base64);
    if (validSegments.length === 0) return;

    // Simplistic combination: concatenate raw PCM
    let totalLength = 0;
    const pcmChunks = validSegments.map(s => {
      const arr = base64ToUint8Array((s as any).metadata.base64);
      totalLength += arr.length;
      return arr;
    });

    const combinedPcm = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of pcmChunks) {
      combinedPcm.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert combined back to base64 to use our existing createWavBlob
    // Note: window.btoa on large strings can fail, but here we can just pass the Uint8 directly if we refactor createWavBlob
    // For now, let's create a specific blob for combined
    const dummyBase64 = ''; // We won't use it
    const blob = createWavBlobFromUint8(combinedPcm);
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voxsrt_combined_audio.wav';
    a.click();
  };

  // Helper for direct Uint8 conversion to avoid base64 overhead
  const createWavBlobFromUint8 = (pcmData: Uint8Array): Blob => {
    const header = createWavHeader(pcmData.length);
    return new Blob([header, pcmData], { type: 'audio/wav' });
  };

  const createWavHeader = (pcmLength: number): Uint8Array => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeString = (v: DataView, o: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, 24000, true); // Sample rate
    view.setUint32(28, 24000 * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // Bits per sample
    writeString(view, 36, 'data');
    view.setUint32(40, pcmLength, true);

    return new Uint8Array(header);
  };

  return (
    <div className="min-h-screen bg-bg text-ink font-sans selection:bg-gold selection:text-black">
      {/* Header */}
      <header className="h-[80px] border-b border-line px-10 flex justify-between items-center bg-bg relative z-20">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gold flex items-center justify-center rounded-sm">
            <FileAudio className="text-black" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-normal tracking-[2px] uppercase font-serif text-gold">VoxConvert Pro</h1>
            <p className="text-[10px] font-sans text-dim uppercase tracking-[1px] -mt-1">SRT to Audio Excellence</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:block text-[12px] text-dim border-r border-line pr-6 mr-0 italic">
            Phần mềm chuyển đổi chuyên nghiệp
          </div>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-6 py-3 border border-gold text-gold hover:bg-gold hover:text-black transition-all text-xs font-bold uppercase tracking-[1px]"
          >
            <Upload size={14} />
            Tải lên SRT
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".srt" 
            className="hidden" 
          />
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-[1fr_340px] h-[calc(100vh-80px-60px)] bg-line">
        {/* Content Area */}
        <section className="bg-bg flex flex-col relative overflow-hidden order-2 lg:order-1">
          {segments.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <div className="w-24 h-24 border border-line rounded-sm flex items-center justify-center mb-8 opacity-30">
                <FileText size={40} className="text-gold" />
              </div>
              <h2 className="text-2xl font-serif font-light mb-4 text-ink">Bắt đầu trải nghiệm VoxConvert</h2>
              <p className="max-w-md text-sm text-dim mb-10 leading-relaxed font-light">
                Kéo và thả tệp .srt vào đây hoặc nhấp để chọn từ máy tính của bạn. Quy trình hoàn toàn tự động và chất lượng cao.
              </p>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="bg-gold text-black px-10 py-4 rounded-sm text-xs font-bold uppercase tracking-[2px] hover:brightness-110 transition-all"
              >
                Chọn tệp ngay
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto scroll-smooth bg-bg">
              <div className="sticky top-0 bg-card border-b border-line px-10 py-4 flex justify-between items-center z-10 shadow-xl">
                <p className="text-[10px] font-sans uppercase tracking-[2px] text-gold font-bold">
                  Dự án: {segments.length} Phân đoạn | Hoàn tất: {segments.filter(s => s.audioUrl).length}
                </p>
                <div className="w-48 bg-line h-[1px] relative">
                  <motion.div 
                    className="absolute top-0 left-0 h-[1px] bg-gold"
                    initial={{ width: 0 }}
                    animate={{ width: `${(segments.filter(s => s.audioUrl).length / segments.length) * 100}%` }}
                    transition={{ duration: 1 }}
                  />
                </div>
              </div>
              
              <div className="p-0">
                {segments.map((segment) => (
                  <motion.div 
                    layout
                    key={segment.id}
                    className={`grid grid-cols-[60px_1fr_120px] md:grid-cols-[80px_1fr_180px] border-b border-line group transition-all duration-300 ${
                      activeSegmentId === segment.id ? 'bg-gold/10' : 'hover:bg-card'
                    }`}
                  >
                    <div className={`p-6 font-mono text-[11px] flex flex-col justify-start items-center border-r border-line ${activeSegmentId === segment.id ? 'text-gold' : 'text-dim'}`}>
                      <span className="opacity-40">#{segment.id.toString().padStart(3, '0')}</span>
                    </div>
                    
                    <div className="p-6 flex flex-col justify-center gap-3">
                       <span className="text-[10px] font-sans tracking-[1px] text-gold uppercase opacity-80">{segment.startTime} — {segment.endTime}</span>
                       <p className={`text-base leading-relaxed font-light ${activeSegmentId === segment.id ? 'text-ink' : 'text-ink/80'}`}>{segment.text}</p>
                    </div>

                    <div className="p-6 flex items-center justify-end gap-4 border-l border-line/30">
                      {segment.isGenerating ? (
                        <div className="flex items-center gap-2 text-[10px] font-sans font-bold text-gold animate-pulse tracking-[1px]">
                          <Loader2 size={14} className="animate-spin" />
                          PROCESSING
                        </div>
                      ) : segment.audioUrl ? (
                        <div className="flex items-center gap-4">
                           <span className="hidden md:block text-[9px] text-dim uppercase tracking-[1.5px]">Đã sẵn sàng</span>
                          <button 
                            onClick={() => playSegment(segment.id)}
                            className={`p-3 rounded-full border transition-all ${
                              activeSegmentId === segment.id 
                              ? 'bg-gold text-black border-gold shadow-[0_0_15px_rgba(212,175,55,0.3)]' 
                              : 'border-line text-gold hover:border-gold hover:bg-gold/5'
                            }`}
                          >
                            <Play size={16} fill={activeSegmentId === segment.id ? "currentColor" : "none"} />
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => generateSegmentAudio(segment.id)}
                          className="px-4 py-2 border border-line text-dim hover:text-gold hover:border-gold transition-all text-[10px] uppercase font-bold tracking-[1px]"
                        >
                          Tạo âm thanh
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Sidebar Controls */}
        <aside className="lg:col-span-1 border-l border-line p-8 overflow-y-auto bg-card order-1 lg:order-2">
          <section className="h-full flex flex-col">
            <h2 className="text-xl font-serif font-light text-gold mb-10 border-b border-line pb-4 uppercase tracking-[2px]">Cấu hình giọng nói</h2>
            
            <div className="space-y-10 flex-1">
              <div>
                <label className="block text-[11px] font-sans font-bold text-dim uppercase tracking-[2px] mb-4">
                  <Languages size={14} className="inline mr-2" /> Ngôn ngữ đầu ra
                </label>
                <select 
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full bg-bg border border-line p-4 text-sm text-ink focus:outline-none focus:border-gold transition-colors appearance-none cursor-pointer"
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code} className="bg-card">{lang.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-sans font-bold text-dim uppercase tracking-[2px] mb-4">
                  <Mic2 size={14} className="inline mr-2" /> Giọng đọc (Voice)
                </label>
                <div className="grid grid-cols-1 gap-3">
                  {VOICES.map(v => (
                    <button
                      key={v}
                      onClick={() => setSelectedVoice(v)}
                      className={`text-left px-5 py-4 text-xs font-sans transition-all border ${
                        selectedVoice === v 
                        ? 'bg-gold/10 text-gold border-gold shadow-[inset_0_0_10px_rgba(212,175,55,0.1)]' 
                        : 'border-line text-dim hover:text-ink hover:border-line/60 bg-bg/30'
                      }`}
                    >
                      <span className="flex items-center justify-between">
                        {v}
                        {selectedVoice === v && <div className="w-1.5 h-1.5 bg-gold rounded-full" />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-sans font-bold text-dim uppercase tracking-[2px] mb-4">
                  Hành động
                </label>
                <div className="space-y-4">
                  <button 
                    disabled={segments.length === 0 || isProcessing}
                    onClick={generateAll}
                    className="w-full bg-gold text-black py-5 rounded-sm text-xs font-bold uppercase tracking-[2px] flex items-center justify-center gap-3 disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all shadow-[0_5px_15px_rgba(0,0,0,0.3)]"
                  >
                    {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Mic2 size={18} />}
                    Bắt đầu chuyển đổi
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-auto pt-10">
              <div className="p-4 bg-bg/50 border border-line rounded-sm mb-6">
                <div className="flex justify-between items-center mb-4">
                   <span className="text-[10px] text-dim font-bold uppercase tracking-[1px]">Định dạng tệp</span>
                   <span className="text-[10px] text-gold font-bold">WAV High-Res</span>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 bg-gold text-black text-center py-2 text-[10px] font-bold uppercase tracking-[1px]">24kHz</div>
                  <div className="flex-1 border border-line text-dim text-center py-2 text-[10px] font-bold uppercase tracking-[1px]">Mono</div>
                </div>
              </div>

              <button 
                disabled={segments.length === 0 || !segments.some(s => s.audioUrl)}
                onClick={downloadCombined}
                className="w-full border border-gold/40 text-gold py-4 rounded-sm text-xs font-bold uppercase tracking-[2px] flex items-center justify-center gap-2 hover:bg-gold hover:text-black transition-all disabled:opacity-20"
              >
                <Download size={18} />
                Tải về tệp Audio
              </button>
              
              <button 
                onClick={() => setSegments([])}
                disabled={segments.length === 0}
                className="w-full mt-4 text-dim hover:text-red-500 transition-colors text-[10px] font-bold uppercase tracking-[2px] py-2"
              >
                Xóa tất cả dữ liệu
              </button>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }}
                className="mt-6 p-4 bg-red-950/20 border border-red-900/50 flex items-start gap-3 text-[11px] text-red-400"
              >
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </motion.div>
            )}
          </section>
        </aside>
      </main>

      {/* Footer */}
      <footer className="h-[60px] border-t border-line bg-card px-10 flex items-center gap-8 text-[11px] font-sans tracking-[1px]">
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 border border-gold text-gold text-[9px] font-bold rounded-full uppercase">Hệ thống sẵn sàng</span>
          <span className="text-dim">Gemini AI Engine Online</span>
        </div>
        <div className="hidden md:flex ml-auto items-center gap-8 text-dim uppercase font-bold text-[10px]">
           <div className="flex items-center gap-2">
             <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
             Ứng dụng hoạt động bình thường
           </div>
           <span>Phiên bản Enterprise</span>
        </div>
      </footer>
    </div>
  );
}

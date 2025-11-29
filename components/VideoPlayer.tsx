import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import dashjs from 'dashjs';
import mpegts from 'mpegts.js';
import { Channel } from '../types';
import { ArrowLeft, Play, Pause, Sparkles, X, Volume2, VolumeX, SkipBack, SkipForward, Wifi, Activity, AlertTriangle } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

interface VideoPlayerProps {
  channel: Channel;
  onBack: () => void;
  onNextChannel: () => void;
  onPrevChannel: () => void;
  onChannelError: (channelId: string) => void;
}

interface NetworkMetrics {
    status: 'good' | 'fair' | 'poor' | 'buffering' | 'offline';
    bufferLead: number;
    color: string;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, onBack, onNextChannel, onPrevChannel, onChannelError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<any>(null); // dashjs type
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  
  // Playback State
  const [isPlaying, setIsPlaying] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const controlsTimeoutRef = useRef<number | null>(null);
  
  // Network Health State
  const [metrics, setMetrics] = useState<NetworkMetrics>({ status: 'buffering', bufferLead: 0, color: 'text-yellow-400' });

  // Volume State
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('iptv_volume');
    return saved ? parseFloat(saved) : 1;
  });
  const [isMuted, setIsMuted] = useState(false);

  // AI State
  const [showAIInfo, setShowAIInfo] = useState(false);
  const [aiContent, setAIContent] = useState<string>('');
  const [isLoadingAI, setIsLoadingAI] = useState(false);

  // Clean up all players
  const destroyPlayers = () => {
     if (hlsRef.current) {
         hlsRef.current.destroy();
         hlsRef.current = null;
     }
     if (dashRef.current) {
         // Use destroy if available, otherwise reset
         if (dashRef.current.destroy) {
             dashRef.current.destroy();
         } else {
             dashRef.current.reset();
         }
         dashRef.current = null;
     }
     if (mpegtsRef.current) {
         mpegtsRef.current.destroy();
         mpegtsRef.current = null;
     }
     
     // Clean up video element to stop downloading/playing
     if (videoRef.current) {
         videoRef.current.removeAttribute('src');
         videoRef.current.load();
     }
  };

  // Helper to safely play video and ignore AbortError (interrupted by load)
  const safePlay = (videoEl: HTMLVideoElement) => {
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
          playPromise.catch(error => {
              if (error.name === 'AbortError') {
                  // This is expected when switching channels or unmounting
                  return;
              }
              if (error.name === 'NotAllowedError') {
                  console.warn('Auto-play prevented by browser policy');
                  setIsPlaying(false);
                  return;
              }
              console.error("Auto-play failed", error);
          });
      }
  };

  // Handle fatal error logic
  const handleFatalError = (msg: string) => {
      console.warn(`Channel Fatal Error: ${msg}`);
      setError(msg);
      setIsRemoving(true);
  };

  // Watch for removing state to trigger callback
  useEffect(() => {
      let timer: number;
      if (isRemoving) {
          timer = window.setTimeout(() => {
              onChannelError(channel.id);
          }, 2500); // Wait 2.5s before skipping so user sees the message
      }
      return () => clearTimeout(timer);
  }, [isRemoving, channel.id, onChannelError]);


  // Monitor Buffer Health
  useEffect(() => {
    const checkHealth = () => {
        const video = videoRef.current;
        if (!video) return;

        // If player is dead or removing
        if (video.error || isRemoving) {
             setMetrics({ status: 'offline', bufferLead: 0, color: 'text-red-500' });
             return;
        }

        if (video.readyState < 3) {
            // Not enough data to play next frame
            setMetrics({ status: 'buffering', bufferLead: 0, color: 'text-yellow-400' });
            return;
        }

        const currentTime = video.currentTime;
        let bufferEnd = 0;
        
        // Find the buffer range that covers current time
        for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= currentTime && video.buffered.end(i) >= currentTime) {
                bufferEnd = video.buffered.end(i);
                break;
            }
        }
        
        const bufferLead = Math.max(0, bufferEnd - currentTime);
        
        let status: NetworkMetrics['status'] = 'good';
        let color = 'text-green-400';

        if (bufferLead < 2) {
            status = 'poor';
            color = 'text-red-400';
        } else if (bufferLead < 5) {
            status = 'fair';
            color = 'text-yellow-400';
        } else {
            status = 'good';
            color = 'text-green-400';
        }
        
        setMetrics({ status, bufferLead, color });
    };

    const interval = setInterval(checkHealth, 1000);
    return () => clearInterval(interval);
  }, [isRemoving]);

  // Initial Player Setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset state
    setError(null);
    setIsRemoving(false);
    setMetrics({ status: 'buffering', bufferLead: 0, color: 'text-yellow-400' });
    destroyPlayers();
    
    // Restore volume
    video.volume = volume;
    video.muted = isMuted;

    const url = channel.url.trim();
    const cleanUrl = url.split('?')[0].toLowerCase();
    
    const isDash = cleanUrl.endsWith('.mpd');
    const isFlv = cleanUrl.endsWith('.flv');
    const isTs = cleanUrl.endsWith('.ts');
    const isM3u8 = cleanUrl.endsWith('.m3u8');

    console.log(`Loading channel: ${channel.name} (${url})`);
    if (channel.drm) {
        console.log(`DRM Configuration found: ${channel.drm.type}`);
    }

    try {
        if (isDash) {
            // DASH Support
            console.log('Initializing DASH player');
            const player = dashjs.MediaPlayer().create();
            
            // Apply DRM Configuration if present
            if (channel.drm) {
                 const protectionData = {
                    [channel.drm.type]: {
                        serverURL: channel.drm.licenseUrl,
                        httpRequestHeaders: channel.drm.headers || {}
                    }
                };
                player.setProtectionData(protectionData);
            }

            player.initialize(video, url, true);
            player.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
                console.error("DASH Error", e);
                handleFatalError("DASH Error");
            });
            dashRef.current = player;
            // dashjs autoplays by default with initialize(..., true), but we can safePlay if needed, though initialize handles it.
            
        } else if ((isFlv || isTs) && mpegts.getFeatureList().mseLivePlayback) {
            // MPEG-TS / FLV Support
            console.log('Initializing MPEGTS player');
            const player = mpegts.createPlayer({
                type: isFlv ? 'flv' : 'mpegts',
                url: url,
                isLive: true,
                cors: true
            });
            player.attachMediaElement(video);
            player.load();
            
            // mpegts player.play() returns a Promise, handle it
            const promise = player.play() as unknown as Promise<void> | undefined;
            if (promise && typeof promise.catch === 'function') {
                promise.catch((e: any) => {
                    if (e.name === 'AbortError') return;
                    console.error("Auto-play failed", e);
                });
            }

            player.on(mpegts.Events.ERROR, (type: any, details: any) => {
                console.error("MPEGTS Error", type, details);
                if (type === mpegts.ErrorTypes.NETWORK_ERROR) {
                     handleFatalError("Network Error");
                }
            });
            mpegtsRef.current = player;

        } else if (Hls.isSupported() && (isM3u8 || (!isDash && !isFlv && !isTs && !video.canPlayType('application/vnd.apple.mpegurl')))) {
            // HLS Support
            console.log('Initializing HLS player');
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                manifestLoadingTimeOut: 10000,
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                safePlay(video);
            });
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log("fatal network error encountered, trying to recover");
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log("fatal media error encountered, trying to recover");
                            hls.recoverMediaError();
                            break;
                        default:
                            destroyPlayers();
                            handleFatalError("Stream Connection Failed");
                            break;
                    }
                }
            });
            hlsRef.current = hls;

        } else {
            // Native Support
            console.log('Initializing Native player');
            video.src = url;
            video.load();
            safePlay(video);
            
            video.onerror = () => {
                 handleFatalError("Format not supported or offline");
            };
        }
    } catch (err: any) {
        console.error("Setup error", err);
        handleFatalError("Player Setup Failed");
    }

    return () => {
      destroyPlayers();
    };
  }, [channel.url]); // Re-run if channel changes

  // Volume Effect
  useEffect(() => {
    if (videoRef.current) {
        videoRef.current.volume = volume;
        videoRef.current.muted = isMuted;
        localStorage.setItem('iptv_volume', volume.toString());
    }
  }, [volume, isMuted]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      resetControlsTimer();
      
      switch(e.key) {
        case 'ArrowRight':
          e.preventDefault();
          onNextChannel();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onPrevChannel();
          break;
        case 'ArrowUp':
           e.preventDefault();
           setVolume(prev => Math.min(1, prev + 0.1));
           setIsMuted(false);
           break;
        case 'ArrowDown':
           e.preventDefault();
           setVolume(prev => Math.max(0, prev - 0.1));
           setIsMuted(false);
           break;
        case 'm':
        case 'M':
           toggleMute();
           break;
        case 'Escape':
        case 'Backspace':
          if (showAIInfo) {
             setShowAIInfo(false);
          } else {
             onBack();
          }
          break;
        case 'Enter':
        case ' ': 
          e.preventDefault();
          togglePlay();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, showAIInfo, volume]); 

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        safePlay(videoRef.current);
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
      setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setVolume(parseFloat(e.target.value));
      setIsMuted(false);
  };

  const resetControlsTimer = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (!showAIInfo) {
        setShowControls(false);
      }
    }, 4000);
  };

  useEffect(() => {
    const container = containerRef.current;
    if(container) {
        container.addEventListener('mousemove', resetControlsTimer);
        container.addEventListener('click', resetControlsTimer);
    }
    resetControlsTimer();
    return () => {
        if(container) {
            container.removeEventListener('mousemove', resetControlsTimer);
            container.removeEventListener('click', resetControlsTimer);
        }
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    }
  }, [showAIInfo]);

  const handleAskAI = async () => {
    setShowAIInfo(true);
    if (aiContent) return; 

    setIsLoadingAI(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Tell me a brief description (max 50 words) about the TV channel "${channel.name}". Include what kind of content it typically broadcasts.`;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{googleSearch: {}}],
        },
      });
      
      setAIContent(response.text || "No information available.");
    } catch (e) {
      console.error(e);
      setAIContent("Sorry, I couldn't fetch information for this channel at the moment.");
    } finally {
      setIsLoadingAI(false);
    }
  };


  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-50 flex items-center justify-center overflow-hidden font-sans group select-none">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        autoPlay
        playsInline
        onClick={togglePlay}
      />
      
      {/* Error/Offline Overlay */}
      {isRemoving && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-40">
           <div className="text-center p-8 bg-slate-900 rounded-2xl border border-red-500/30 shadow-2xl max-w-md mx-4 animate-pulse">
               <div className="text-red-500 mb-4 font-bold text-xl flex flex-col items-center gap-3">
                   <div className="p-4 bg-red-500/10 rounded-full">
                     <AlertTriangle className="w-10 h-10" />
                   </div>
                   Channel Offline
               </div>
               <p className="text-slate-300 mb-2 font-medium">Removing from list and skipping...</p>
               <div className="w-full h-1 bg-slate-800 rounded-full mt-4 overflow-hidden">
                   <div className="h-full bg-red-500 animate-[width_2s_ease-in-out_forwards]" style={{width: '0%'}}></div>
               </div>
           </div>
        </div>
      )}

      {/* Main UI Overlay */}
      <div 
        className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 pointer-events-none ${showControls && !isRemoving ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* Top Header */}
        <div className="flex justify-between items-start p-6 md:p-10 pointer-events-auto bg-gradient-to-b from-black/80 to-transparent">
           <button 
             onClick={onBack}
             className="p-3 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-sm transition-transform hover:scale-110 focus:ring-2 focus:ring-white"
             title="Go Back"
           >
             <ArrowLeft className="w-6 h-6 text-white" />
           </button>
           
           <div className="flex gap-4 items-start">
               {/* Signal / Buffer Meter */}
                <div className="flex flex-col items-end mr-2 bg-black/40 px-3 py-2 rounded-xl backdrop-blur-md border border-white/5">
                    <div className={`flex items-center gap-2 ${metrics.color}`}>
                        <Wifi className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">{metrics.status === 'good' ? 'Online' : metrics.status}</span>
                    </div>
                    {/* Buffer Bar */}
                    <div className="w-20 h-1 bg-slate-700 rounded-full mt-1 overflow-hidden relative">
                        {metrics.status === 'buffering' ? (
                             <div className="absolute inset-0 bg-yellow-400 animate-pulse w-full"></div>
                        ) : (
                             <div 
                                className={`h-full transition-all duration-500 ${metrics.status === 'good' ? 'bg-green-500' : metrics.status === 'fair' ? 'bg-yellow-500' : 'bg-red-500'}`} 
                                style={{ width: `${Math.min(100, (metrics.bufferLead / 10) * 100)}%` }}
                             ></div>
                        )}
                    </div>
                </div>

                <button 
                    onClick={handleAskAI}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600/80 hover:bg-purple-600 rounded-full backdrop-blur-md transition-all hover:scale-105 focus:ring-4 focus:ring-purple-400 border border-purple-400/30 shadow-lg shadow-purple-900/50"
                >
                    <Sparkles className="w-5 h-5 text-yellow-300" />
                    <span className="text-white font-medium hidden md:inline">Ask AI</span>
                </button>
           </div>
        </div>

        {/* Click area for center play/pause */}
        <div className="flex-1 pointer-events-auto" onClick={togglePlay} onDoubleClick={togglePlay} />

        {/* Bottom Bar Container */}
        <div className="pointer-events-auto bg-gradient-to-t from-black/95 via-black/70 to-transparent px-8 pb-8 pt-16 flex flex-col gap-6">
            
            {/* Playback Controls Row - Centered */}
            <div className="flex items-center justify-center gap-10">
                <button 
                    onClick={onPrevChannel}
                    className="p-3 text-slate-300 hover:text-white hover:bg-white/10 rounded-full transition-all active:scale-95"
                    title="Previous Channel"
                >
                    <SkipBack className="w-8 h-8" />
                </button>

                <button 
                    onClick={togglePlay}
                    className="p-4 bg-white text-black hover:bg-slate-200 rounded-full transition-transform hover:scale-110 shadow-lg focus:ring-4 focus:ring-blue-500/50 outline-none"
                >
                    {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
                </button>

                <button 
                    onClick={onNextChannel}
                    className="p-3 text-slate-300 hover:text-white hover:bg-white/10 rounded-full transition-all active:scale-95"
                    title="Next Channel"
                >
                    <SkipForward className="w-8 h-8" />
                </button>
            </div>

            {/* Info & Volume Row */}
            <div className="flex flex-col md:flex-row items-end md:items-center justify-between gap-4 border-t border-white/10 pt-4">
                {/* Channel Info */}
                <div className="flex-1 min-w-0">
                    <h2 className="text-2xl font-bold text-white drop-shadow-md truncate">{channel.name}</h2>
                    <div className="flex items-center gap-2 text-blue-400 mt-1">
                        <Activity className="w-4 h-4" />
                        <p className="text-sm font-medium uppercase tracking-wide truncate">{channel.group}</p>
                    </div>
                </div>

                {/* Volume Control */}
                <div className="flex items-center gap-3 bg-white/10 px-4 py-2 rounded-xl backdrop-blur-md border border-white/5 hover:bg-white/15 transition-colors">
                    <button onClick={toggleMute} className="text-white hover:text-blue-400 transition-colors">
                        {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                    <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.05" 
                        value={volume}
                        onChange={handleVolumeChange}
                        className="w-24 md:w-32 h-1.5 bg-slate-500 rounded-lg appearance-none cursor-pointer accent-white hover:accent-blue-400"
                    />
                </div>
            </div>
            
            {/* Helper Text */}
            <div className="text-center hidden md:block">
                <p className="text-white/30 text-[10px] uppercase tracking-widest">
                    Arrows: Vol/Channel • Space: Pause • M: Mute
                </p>
            </div>
        </div>

      </div>

      {/* AI Panel */}
      {showAIInfo && (
          <div className="absolute top-20 right-4 md:right-8 w-80 md:w-96 bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl p-6 transition-all animate-in fade-in slide-in-from-right-10 pointer-events-auto z-50">
             <div className="flex justify-between items-start mb-4">
                <h3 className="text-purple-400 font-bold flex items-center gap-2">
                    <Sparkles className="w-5 h-5" /> Gemini Info
                </h3>
                <button 
                    onClick={() => setShowAIInfo(false)}
                    className="text-slate-400 hover:text-white"
                >
                    <X className="w-5 h-5" />
                </button>
             </div>
             
             <div className="text-slate-200 leading-relaxed text-sm max-h-[60vh] overflow-y-auto">
                 {isLoadingAI ? (
                     <div className="flex flex-col items-center py-4">
                         <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                         <span className="text-purple-300 text-xs animate-pulse">Consulting knowledge base...</span>
                     </div>
                 ) : (
                     <div>{aiContent}</div>
                 )}
             </div>
          </div>
      )}
    </div>
  );
};

export default VideoPlayer;
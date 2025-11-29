import React, { useState, useEffect, useCallback } from 'react';
import { parseM3U, DEMO_PLAYLIST } from './utils/parser';
import { Channel, Category, AppState } from './types';
import VideoPlayer from './components/VideoPlayer';
import ChannelCard from './components/ChannelCard';
import { Settings, MonitorPlay, Search, Star, FileUp, Link, ClipboardType, EyeOff, Loader2, Globe } from 'lucide-react';

const PRESETS = [
  { group: 'South America', name: 'Argentina', url: 'https://www.m3u.cl/lista/AR.m3u' },
  { group: 'South America', name: 'Bolivia', url: 'https://www.m3u.cl/lista/BO.m3u' },
  { group: 'South America', name: 'Brasil', url: 'https://www.m3u.cl/lista/BR.m3u' },
  { group: 'South America', name: 'Chile', url: 'https://www.m3u.cl/lista/CL.m3u' },
  { group: 'South America', name: 'Colombia', url: 'https://www.m3u.cl/lista/CO.m3u' },
  { group: 'South America', name: 'Ecuador', url: 'https://www.m3u.cl/lista/EC.m3u' },
  { group: 'South America', name: 'Paraguay', url: 'https://www.m3u.cl/lista/PY.m3u' },
  { group: 'South America', name: 'Perú', url: 'https://www.m3u.cl/lista/PE.m3u' },
  { group: 'South America', name: 'Venezuela', url: 'https://www.m3u.cl/lista/VE.m3u' },
  
  { group: 'North/Central America', name: 'México', url: 'https://www.m3u.cl/lista/MX.m3u' },
  { group: 'North/Central America', name: 'Dominican Republic', url: 'https://www.m3u.cl/lista/DO.m3u' },

  { group: 'Europe', name: 'España (M3U.CL)', url: 'https://www.m3u.cl/lista/ES.m3u' },
  { group: 'Europe', name: 'España (TDTChannels TV)', url: 'https://www.tdtchannels.com/lists/tv.m3u8' },
  { group: 'Europe', name: 'España (TDTChannels Radio)', url: 'https://www.tdtchannels.com/lists/radio.m3u8' },

  { group: 'Themed', name: 'Música', url: 'https://www.m3u.cl/lista/musica.m3u' },
  { group: 'Themed', name: 'Religiosos', url: 'https://www.m3u.cl/lista/religiosos.m3u' },
  { group: 'Themed', name: 'Variedad (Total)', url: 'https://www.m3u.cl/lista/total.m3u' },
  { group: 'Themed', name: 'IPTV-Org Spanish', url: 'https://iptv-org.github.io/iptv/languages/spa.m3u' },
];

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.SETUP);
  const [isLoading, setIsLoading] = useState(false);
  
  // Setup State
  const [setupMode, setSetupMode] = useState<'url' | 'file' | 'text' | 'preset'>('url');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistText, setPlaylistText] = useState('');

  // Data State
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  
  // Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('iptv_favorites');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  // Navigation State
  const [focusedIndex, setFocusedIndex] = useState<number>(-1); // -1 means sidebar or search
  const [isSidebarFocused, setIsSidebarFocused] = useState(false);
  
  // Persist Favorites
  useEffect(() => {
    localStorage.setItem('iptv_favorites', JSON.stringify(Array.from(favorites)));
  }, [favorites]);

  const toggleFavorite = (e: React.MouseEvent, channel: Channel) => {
    e.stopPropagation();
    const newFavs = new Set(favorites);
    const key = channel.url; 
    if (newFavs.has(key)) {
      newFavs.delete(key);
    } else {
      newFavs.add(key);
    }
    setFavorites(newFavs);
  };

  // Filter channels
  const filteredChannels = React.useMemo(() => {
    return channels.filter(ch => {
      if (selectedCategory !== 'all' && ch.group !== selectedCategory) return false;
      if (searchTerm && !ch.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (showFavoritesOnly && !favorites.has(ch.url)) return false;
      return true;
    });
  }, [channels, selectedCategory, searchTerm, showFavoritesOnly, favorites]);

  const loadPlaylist = useCallback((content: string) => {
    try {
      const parsed = parseM3U(content);
      if (parsed.channels.length === 0) {
        alert("No channels found in playlist. The file might be empty or invalid.");
        return;
      }
      setChannels(parsed.channels);
      setCategories(parsed.categories);
      setAppState(AppState.BROWSING);
      setFocusedIndex(0); 
    } catch (e) {
      alert("Failed to parse playlist");
    }
  }, []);

  const fetchPlaylist = async (url: string) => {
    if (!url) return;
    setIsLoading(true);

    // Strategy pattern to try multiple ways to fetch the playlist
    const strategies = [
      { name: 'Direct', fn: (u: string) => u },
      { name: 'AllOrigins', fn: (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
      { name: 'CodeTabs', fn: (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` }
    ];

    let content = '';
    let success = false;

    for (const strategy of strategies) {
      try {
        console.log(`Attempting fetch via ${strategy.name}...`);
        const targetUrl = strategy.fn(url);
        const response = await fetch(targetUrl);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const text = await response.text();
        
        // Basic validation: A valid M3U should usually have #EXTM3U or #EXTINF
        // This prevents us from trying to parse HTML error pages as playlists
        if (text.includes('#EXTINF') || text.includes('#EXTM3U') || text.indexOf('http') !== -1) {
           content = text;
           success = true;
           break;
        } else {
           console.warn(`Fetched content from ${strategy.name} does not look like an M3U playlist.`);
        }
      } catch (err) {
        console.warn(`Strategy ${strategy.name} failed:`, err);
      }
    }

    setIsLoading(false);

    if (success && content) {
      loadPlaylist(content);
    } else {
      alert("Unable to load playlist. All connection strategies failed. \n\nThis usually happens due to CORS restrictions or the link being offline. \n\nTip: Try downloading the .m3u file to your device and use the 'File' upload option.");
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPlaylist(playlistUrl);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      loadPlaylist(content);
      setIsLoading(false);
    };
    reader.onerror = () => {
        alert("Error reading file");
        setIsLoading(false);
    }
    reader.readAsText(file);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playlistText) return;
    loadPlaylist(playlistText);
  };

  const handleDemoLoad = () => {
    loadPlaylist(DEMO_PLAYLIST);
  };

  const handleChannelSelect = (channel: Channel) => {
    setCurrentChannel(channel);
    setAppState(AppState.PLAYING);
  };

  const handleBackFromPlayer = () => {
    setAppState(AppState.BROWSING);
    setCurrentChannel(null);
  };

  const handleChannelError = useCallback((channelId: string) => {
    // 1. Find the failed channel to verify it exists
    const failedChannelIndex = filteredChannels.findIndex(c => c.id === channelId);
    if (failedChannelIndex === -1) return;

    console.log(`Channel ${channelId} failed. Removing and skipping.`);

    // 2. Determine next channel
    let nextChannel: Channel | null = null;
    if (filteredChannels.length > 1) {
        const nextIndex = (failedChannelIndex + 1) % filteredChannels.length;
        nextChannel = filteredChannels[nextIndex];
    }

    // 3. Update the main list (Remove the bad channel)
    setChannels(prev => prev.filter(c => c.id !== channelId));

    // 4. Switch or Exit
    if (nextChannel) {
        setCurrentChannel(nextChannel);
    } else {
        // No channels left
        alert("All channels in this list seem to be offline.");
        setAppState(AppState.BROWSING);
        setCurrentChannel(null);
    }
  }, [filteredChannels]);

  // Channel Navigation Logic
  const getCurrentChannelIndex = () => {
    if (!currentChannel) return -1;
    return filteredChannels.findIndex(c => c.id === currentChannel.id);
  };

  const handleNextChannel = () => {
    const currentIndex = getCurrentChannelIndex();
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % filteredChannels.length;
    setCurrentChannel(filteredChannels[nextIndex]);
  };

  const handlePrevChannel = () => {
    const currentIndex = getCurrentChannelIndex();
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + filteredChannels.length) % filteredChannels.length;
    setCurrentChannel(filteredChannels[prevIndex]);
  };

  // Keyboard Navigation Logic
  useEffect(() => {
    if (appState !== AppState.BROWSING) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSidebarFocused) {
          if (e.key === 'ArrowRight' || e.key === 'Enter') {
             setIsSidebarFocused(false);
             setFocusedIndex(0);
          }
          return; 
      }

      const COLUMNS = 4;
      let nextIndex = focusedIndex;

      switch(e.key) {
        case 'ArrowRight':
          nextIndex = Math.min(filteredChannels.length - 1, focusedIndex + 1);
          break;
        case 'ArrowLeft':
          if (focusedIndex === 0 || focusedIndex % COLUMNS === 0) {
              // Optional: Focus sidebar
          }
          nextIndex = Math.max(0, focusedIndex - 1);
          break;
        case 'ArrowDown':
          nextIndex = Math.min(filteredChannels.length - 1, focusedIndex + COLUMNS);
          break;
        case 'ArrowUp':
          nextIndex = Math.max(0, focusedIndex - COLUMNS);
          break;
        case 'Enter':
          if (filteredChannels[focusedIndex]) {
            handleChannelSelect(filteredChannels[focusedIndex]);
          }
          break;
        case 'Backspace':
        case 'Escape':
           setAppState(AppState.SETUP);
           break;
      }

      if (nextIndex !== focusedIndex) {
        setFocusedIndex(nextIndex);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appState, focusedIndex, filteredChannels, isSidebarFocused]);


  if (appState === AppState.PLAYING && currentChannel) {
    return (
        <VideoPlayer 
            channel={currentChannel} 
            onBack={handleBackFromPlayer} 
            onNextChannel={handleNextChannel}
            onPrevChannel={handlePrevChannel}
            onChannelError={handleChannelError}
        />
    );
  }

  // Group presets for UI
  const groupedPresets = PRESETS.reduce((acc, preset) => {
    if (!acc[preset.group]) acc[preset.group] = [];
    acc[preset.group].push(preset);
    return acc;
  }, {} as Record<string, typeof PRESETS>);

  if (appState === AppState.SETUP) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-6 font-sans">
        <div className="max-w-xl w-full bg-slate-900 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
          
          <div className="p-8 pb-4 text-center flex-shrink-0">
            <div className="flex items-center justify-center mb-6">
                <div className="p-4 bg-blue-500/10 rounded-full">
                    <MonitorPlay className="w-12 h-12 text-blue-500" />
                </div>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">React IPTV Player</h1>
            <p className="text-slate-400">Load your playlist to start watching TV</p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-700 flex-shrink-0">
            <button 
                onClick={() => setSetupMode('url')}
                className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${setupMode === 'url' ? 'bg-slate-800 text-blue-400 border-b-2 border-blue-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
            >
                <Link className="w-4 h-4" /> URL
            </button>
            <button 
                onClick={() => setSetupMode('preset')}
                className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${setupMode === 'preset' ? 'bg-slate-800 text-blue-400 border-b-2 border-blue-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
            >
                <Globe className="w-4 h-4" /> Presets
            </button>
            <button 
                onClick={() => setSetupMode('file')}
                className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${setupMode === 'file' ? 'bg-slate-800 text-blue-400 border-b-2 border-blue-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
            >
                <FileUp className="w-4 h-4" /> File
            </button>
            <button 
                onClick={() => setSetupMode('text')}
                className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${setupMode === 'text' ? 'bg-slate-800 text-blue-400 border-b-2 border-blue-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
            >
                <ClipboardType className="w-4 h-4" /> Paste
            </button>
          </div>

          {/* Content Area */}
          <div className="p-8 overflow-y-auto custom-scrollbar">
             {setupMode === 'url' && (
                 <form onSubmit={handleUrlSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Playlist URL (.m3u)</label>
                        <input
                            type="text"
                            value={playlistUrl}
                            onChange={(e) => setPlaylistUrl(e.target.value)}
                            placeholder="https://example.com/playlist.m3u"
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder-slate-600"
                            autoFocus
                        />
                        <p className="text-xs text-slate-500 mt-2">Note: If loading fails, try using the Upload File tab.</p>
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-all focus:ring-4 focus:ring-blue-500/50 flex justify-center items-center gap-2"
                    >
                        {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Loading...</> : 'Load from URL'}
                    </button>
                </form>
             )}

             {setupMode === 'preset' && (
                 <div className="space-y-6">
                    {isLoading && (
                        <div className="flex items-center justify-center py-4 text-blue-400 animate-pulse">
                            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading playlist...
                        </div>
                    )}
                    {Object.entries(groupedPresets).map(([group, list]) => (
                        <div key={group}>
                            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3 sticky top-0 bg-slate-900 py-2">{group}</h3>
                            <div className="grid grid-cols-2 gap-3">
                                {list.map(preset => (
                                    <button
                                        key={preset.name}
                                        onClick={() => fetchPlaylist(preset.url)}
                                        disabled={isLoading}
                                        className="text-left px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 rounded-lg transition-all text-sm font-medium text-slate-200 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                 </div>
             )}

             {setupMode === 'file' && (
                 <div className="space-y-4">
                     <div className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-8 transition-colors text-center cursor-pointer relative">
                         <input 
                            type="file" 
                            accept=".m3u,.m3u8"
                            onChange={handleFileUpload}
                            disabled={isLoading}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full disabled:cursor-not-allowed"
                         />
                         {isLoading ? (
                            <div className="flex flex-col items-center">
                                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                                <p className="text-slate-300 font-medium">Parsing file...</p>
                            </div>
                         ) : (
                            <>
                                <FileUp className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                                <p className="text-slate-300 font-medium">Click to select .m3u file</p>
                                <p className="text-slate-500 text-sm mt-1">or drag and drop here</p>
                            </>
                         )}
                     </div>
                 </div>
             )}

             {setupMode === 'text' && (
                 <form onSubmit={handleTextSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Paste Playlist Content</label>
                        <textarea
                            value={playlistText}
                            onChange={(e) => setPlaylistText(e.target.value)}
                            placeholder="#EXTM3U..."
                            rows={6}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder-slate-600 font-mono text-xs"
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-all focus:ring-4 focus:ring-blue-500/50"
                    >
                        Parse Content
                    </button>
                 </form>
             )}

            {setupMode !== 'preset' && (
                <>
                    <div className="mt-8 flex items-center justify-between">
                        <span className="h-px bg-slate-800 flex-1"></span>
                        <span className="px-4 text-slate-600 text-sm">OR</span>
                        <span className="h-px bg-slate-800 flex-1"></span>
                    </div>

                    <button
                        onClick={handleDemoLoad}
                        className="mt-6 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-lg transition-all focus:ring-4 focus:ring-slate-500/50"
                    >
                        Try Demo Channels
                    </button>
                </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // BROWSING STATE
  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-slate-950 flex flex-col border-r border-slate-800">
        <div className="p-4 flex items-center gap-3 font-bold text-xl text-blue-400">
           <MonitorPlay className="w-8 h-8" />
           <span>IPTV</span>
        </div>
        
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 scrollbar-thin scrollbar-thumb-slate-700">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => { setSelectedCategory(cat.name === 'All Channels' ? 'all' : cat.name); setFocusedIndex(0); }}
              className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                 (selectedCategory === cat.name || (selectedCategory === 'all' && cat.id === 'all'))
                 ? 'bg-blue-600 text-white' 
                 : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
        
        <div className="p-4 border-t border-slate-800 text-xs text-slate-600 text-center">
            {channels.length} Channels Loaded
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
         {/* Top Bar */}
         <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md">
            <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="Search channels..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-800 border-none rounded-full py-2 pl-10 pr-4 text-sm text-white focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
                />
            </div>
            
            <div className="flex items-center gap-4 ml-4">
                <button 
                  onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                  className={`p-2 rounded-full transition-colors ${showFavoritesOnly ? 'bg-yellow-500/20 text-yellow-400' : 'text-slate-400 hover:bg-slate-800'}`}
                  title="Toggle Favorites"
                >
                   <Star className="w-5 h-5" fill={showFavoritesOnly ? "currentColor" : "none"} />
                </button>
                <button 
                  onClick={() => setAppState(AppState.SETUP)}
                  className="p-2 rounded-full text-slate-400 hover:bg-slate-800 transition-colors"
                  title="Settings / Load Playlist"
                >
                   <Settings className="w-5 h-5" />
                </button>
            </div>
         </div>

         {/* Grid */}
         <div className="flex-1 overflow-y-auto p-6 bg-slate-900">
             {filteredChannels.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-slate-500">
                    <EyeOff className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No channels found</p>
                    <button onClick={() => { setSearchTerm(''); setShowFavoritesOnly(false); setSelectedCategory('all'); }} className="mt-4 text-blue-400 hover:underline">Clear filters</button>
                 </div>
             ) : (
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                    {filteredChannels.map((channel, idx) => (
                        <ChannelCard 
                           key={channel.id} 
                           channel={channel} 
                           isFavorite={favorites.has(channel.url)}
                           onToggleFavorite={toggleFavorite}
                           onClick={handleChannelSelect}
                           focused={idx === focusedIndex && !isSidebarFocused}
                        />
                    ))}
                 </div>
             )}
         </div>
      </div>
    </div>
  );
};

export default App;
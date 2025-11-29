import React, { useRef, useEffect } from 'react';
import { Channel } from '../types';
import { Tv, Star } from 'lucide-react';

interface ChannelCardProps {
  channel: Channel;
  onClick: (channel: Channel) => void;
  onToggleFavorite: (e: React.MouseEvent, channel: Channel) => void;
  isFavorite: boolean;
  focused?: boolean;
}

const ChannelCard: React.FC<ChannelCardProps> = ({ channel, onClick, onToggleFavorite, isFavorite, focused }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll if focused via keyboard/programmatically
  useEffect(() => {
    if (focused && buttonRef.current) {
      buttonRef.current.focus();
      buttonRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focused]);

  return (
    <button
      ref={buttonRef}
      onClick={() => onClick(channel)}
      className={`
        group relative flex flex-col items-center justify-center 
        p-4 rounded-xl aspect-video bg-slate-800 
        transition-all duration-200 ease-out
        border-2 border-transparent
        hover:bg-slate-700 hover:scale-105 hover:border-slate-500 hover:z-10 hover:shadow-xl
        focus:outline-none focus:ring-4 focus:ring-blue-500 focus:scale-110 focus:z-20 focus:shadow-2xl focus:bg-slate-700
      `}
      title={channel.name}
    >
      <div className="absolute top-2 right-2 z-30">
        <div 
           onClick={(e) => onToggleFavorite(e, channel)}
           className={`p-1 rounded-full transition-colors ${isFavorite ? 'text-yellow-400' : 'text-slate-600 hover:text-yellow-200'}`}
        >
          <Star className="w-5 h-5" fill={isFavorite ? "currentColor" : "none"} />
        </div>
      </div>

      <div className="w-16 h-16 mb-3 flex items-center justify-center rounded-full bg-slate-900 shadow-inner overflow-hidden">
        {channel.logo ? (
          <img 
            src={channel.logo} 
            alt={channel.name} 
            className="w-full h-full object-cover" 
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <Tv className={`w-8 h-8 text-slate-500 ${channel.logo ? 'hidden' : ''}`} />
      </div>
      <h3 className="text-sm font-semibold text-center text-slate-200 line-clamp-2 w-full group-hover:text-white group-focus:text-white">
        {channel.name}
      </h3>
    </button>
  );
};

export default ChannelCard;
import { Channel, Category, DrmConfig } from '../types';

export const parseM3U = (content: string): { channels: Channel[]; categories: Category[] } => {
  const lines = content.split('\n');
  const channels: Channel[] = [];
  const categoriesSet = new Set<string>();
  
  let currentChannel: Partial<Channel> = {};
  let currentProps: Record<string, string> = {};

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('#KODIPROP:')) {
      // Parse Kodi/IPTV properties for DRM and Headers
      const prop = trimmed.substring(10);
      const splitIndex = prop.indexOf('=');
      if (splitIndex !== -1) {
          const key = prop.substring(0, splitIndex).trim();
          const val = prop.substring(splitIndex + 1).trim();
          currentProps[key] = val;
      }
    } else if (trimmed.startsWith('#EXTINF:')) {
      // Parse metadata
      const info = trimmed.substring(8);
      
      // Extract properties using regex for better accuracy
      const tvgIdMatch = info.match(/tvg-id="([^"]*)"/);
      const logoMatch = info.match(/tvg-logo="([^"]*)"/);
      const groupMatch = info.match(/group-title="([^"]*)"/);
      
      // Extract name (everything after the last comma)
      const nameParts = info.split(',');
      const name = nameParts[nameParts.length - 1].trim();

      currentChannel = {
        tvgId: tvgIdMatch ? tvgIdMatch[1] : undefined,
        name: name || 'Unknown Channel',
        logo: logoMatch ? logoMatch[1] : undefined,
        group: groupMatch ? groupMatch[1] : 'Uncategorized',
      };
      
      if (currentChannel.group) {
        categoriesSet.add(currentChannel.group);
      }
    } else if (!trimmed.startsWith('#')) {
      // It's a URL
      
      // Process DRM props if present
      let drm: DrmConfig | undefined;
      const licenseType = currentProps['inputstream.adaptive.license_type'];
      const licenseKey = currentProps['inputstream.adaptive.license_key'];

      if (licenseType && licenseKey) {
           let licenseUrl = licenseKey;
           let headers: Record<string, string> = {};

           // Handle Kodi style headers in license_key: url|Header=Val&Header2=Val
           if (licenseUrl.includes('|')) {
               const parts = licenseUrl.split('|');
               licenseUrl = parts[0];
               if (parts[1]) {
                   parts[1].split('&').forEach(h => {
                       const [k, v] = h.split('=');
                       if (k && v) headers[k] = decodeURIComponent(v);
                   });
               }
           }
           
           drm = { type: licenseType, licenseUrl, headers };
      }

      // Check for User-Agent and Referrer props (best effort)
      const userAgent = currentProps['http-user-agent'];
      const referrer = currentProps['http-referrer'];

      const channelName = currentChannel.name || `Channel ${channels.length + 1}`;
      
      channels.push({
        id: `ch-${Date.now()}-${index}`, // Unique internal ID
        name: channelName,
        tvgId: currentChannel.tvgId,
        logo: currentChannel.logo,
        group: currentChannel.group || 'Uncategorized',
        url: trimmed,
        drm,
        userAgent,
        referrer
      } as Channel);

      // Add category if we just created a default one? No, Uncategorized is implicit.
      if (currentChannel.group) {
          categoriesSet.add(currentChannel.group);
      } else {
          categoriesSet.add('Uncategorized');
      }

      currentChannel = {}; // Reset for next entry
      currentProps = {}; // Reset props for next entry
    }
  });

  const sortedCategories: Category[] = Array.from(categoriesSet).sort().map((cat, idx) => ({
    id: `cat-${idx}`,
    name: cat
  }));

  // Add "All" category at the start
  sortedCategories.unshift({ id: 'all', name: 'All Channels' });

  return { channels, categories: sortedCategories };
};

// A small demo playlist for testing
export const DEMO_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_Buck_Bunny_poster_big.jpg/800px-Big_Buck_Bunny_poster_big.jpg" group-title="Animation",Big Buck Bunny
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Sintel_movie_poster.jpg/800px-Sintel_movie_poster.jpg" group-title="Animation",Sintel (DASH)
https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd
#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Tears_of_Steel_poster.jpg/800px-Tears_of_Steel_poster.jpg" group-title="Sci-Fi",Tears of Steel
https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8
#EXTINF:-1 tvg-logo="https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg" group-title="Nature",Ocean
https://bitdash-a.akamaihd.net/content/MI201109210084_1/m3u8s/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.m3u8
`;
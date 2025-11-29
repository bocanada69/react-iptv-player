export interface DrmConfig {
  type: string; // e.g., 'com.widevine.alpha', 'com.microsoft.playready', 'org.w3.clearkey'
  licenseUrl: string;
  headers?: Record<string, string>;
}

export interface Channel {
  id: string; // Internal ID
  tvgId?: string; // ID from playlist
  name: string;
  logo?: string;
  group?: string;
  url: string;
  drm?: DrmConfig;
  userAgent?: string;
  referrer?: string;
}

export interface Category {
  id: string;
  name: string;
}

export enum AppState {
  SETUP = 'SETUP',
  BROWSING = 'BROWSING',
  PLAYING = 'PLAYING',
}
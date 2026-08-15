import { useEffect, useState, type RefObject } from 'react';
import type { Episode } from '@/types';

/**
 * Owns the <video> element itself: HLS.js attach/detach, playback state,
 * and the imperative transport controls. Extracted unchanged from
 * PlayerClient (Phase 4 Step 1 — see useEntitlement.ts for the same note).
 *
 * Two distinct error surfaces are preserved exactly as they were:
 * `fatalError` (unsupported browser, or a fatal HLS.js stream error) blocks
 * the whole page, same as an entitlement fault. `playbackError` (blocked
 * autoplay, a native <video> error event, fullscreen failing) is a
 * recoverable, in-place condition — the player stays interactive.
 */
export function useHlsPlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  episode: Episode | null,
  videoUrl: string | null,
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    let cancelled = false;
    let hls: import('hls.js').default | undefined;
    setPlaybackError(null);

    const isHlsSource = /\.m3u8(?:$|[?#])/i.test(videoUrl);
    if (!isHlsSource || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoUrl;
      video.load();
    } else {
      void import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setFatalError('เบราว์เซอร์นี้ไม่รองรับการเล่นวิดีโอ');
          return;
        }
        hls = new Hls();
        hls.loadSource(videoUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          hls?.destroy();
          setFatalError('เกิดข้อผิดพลาดในการเล่นวิดีโอ');
        });
      });
    }

    return () => {
      cancelled = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [videoRef, episode, videoUrl]);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      setPlaybackError(null);
      await video.play();
    } catch {
      setIsPlaying(false);
      setPlaybackError('เบราว์เซอร์ไม่อนุญาตให้เล่นอัตโนมัติ กรุณากดเล่นอีกครั้ง');
    }
  };

  const changePlaybackRate = (rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const toggleFullscreen = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await video.requestFullscreen();
    } catch {
      setPlaybackError('ไม่สามารถเปิดโหมดเต็มหน้าจอได้');
    }
  };

  return {
    isPlaying,
    setIsPlaying,
    mediaDuration,
    setMediaDuration,
    playbackRate,
    playbackError,
    setPlaybackError,
    fatalError,
    togglePlayback,
    changePlaybackRate,
    toggleFullscreen,
  };
}

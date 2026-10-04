import { type RefObject, useEffect, useRef } from 'react';
import { useTimelineStore } from '../store/timelineStore';

/**
 * Sincroniza bidireccionalmente el elemento <video> real con el store:
 * - Reproduciendo: video.currentTime -> store.currentTime (para mover el cabezal).
 * - Arrastrando el cabezal o haciendo clic en la timeline: store.currentTime -> video.currentTime.
 */
export function useVideoSync(videoRef: RefObject<HTMLVideoElement>) {
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const setPlaying = useTimelineStore((state) => state.setPlaying);
  const storeCurrentTime = useTimelineStore((state) => state.currentTime);
  const isSeekingFromStore = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (isSeekingFromStore.current) return;
      setCurrentTime(video.currentTime);
    };
    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [videoRef, setCurrentTime, setPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - storeCurrentTime) < 0.05) return;

    isSeekingFromStore.current = true;
    video.currentTime = storeCurrentTime;
    const clearFlag = () => {
      isSeekingFromStore.current = false;
    };
    video.addEventListener('seeked', clearFlag, { once: true });
    return () => video.removeEventListener('seeked', clearFlag);
  }, [videoRef, storeCurrentTime]);
}

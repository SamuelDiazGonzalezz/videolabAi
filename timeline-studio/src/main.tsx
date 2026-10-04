import React from 'react';
import ReactDOM from 'react-dom/client';
import { LocalBootstrap } from './LocalBootstrap';
import { resolveStoredMediaProxyUrl } from './api/projects';
import { extractR2StorageKey } from './utils/r2Fallback';
import './fonts.css';
import './index.css';

type R2MediaElement = HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLSourceElement;
const r2FallbackAttempts = new WeakMap<R2MediaElement, string>();

document.addEventListener('error', (event) => {
  const element = event.target;
  if (!(element instanceof HTMLImageElement)
      && !(element instanceof HTMLVideoElement)
      && !(element instanceof HTMLAudioElement)
      && !(element instanceof HTMLSourceElement)) return;
  const source = ('currentSrc' in element && element.currentSrc) || element.src || '';
  const key = extractR2StorageKey(source);
  if (!key || r2FallbackAttempts.get(element) === key) return;
  r2FallbackAttempts.set(element, key);
  void resolveStoredMediaProxyUrl(key).then((proxyUrl) => {
    if (!proxyUrl) return;
    element.src = proxyUrl;
    const media = element instanceof HTMLSourceElement ? element.parentElement : element;
    if (media instanceof HTMLVideoElement || media instanceof HTMLAudioElement) media.load();
  }).catch(() => {});
}, true);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocalBootstrap />
  </React.StrictMode>
);

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  FileText,
  Redo2,
  Save,
  Undo2,
  X
} from 'lucide-react';
import { VideoPreview } from './components/Preview/VideoPreview';
import { Timeline } from './components/Timeline/Timeline';
import { PropertiesPanel } from './components/PropertiesPanel';
import type { GraphicInsert } from './components/GraphicsLibrary';
import type { TemplatesPanelProps } from './components/TemplatesPanel';
import { buildTemplateInsertion } from './utils/motionTemplates';
import { AuthRedirect } from './components/AuthRedirect';
import { TranscriptPanel } from './components/TranscriptPanel';
import { ClippingTranscriptPanel, type ClippingTranscriptToken } from './components/ClippingTranscriptPanel';
import { CanvasToolbar } from './components/CanvasToolbar';
import { EditorToolRail, type EditorPanel } from './components/EditorToolRail';
import { EditorResizeHandle } from './components/EditorResizeHandle';
import { useTimelineStore } from './store/timelineStore';
import { useAuth } from './hooks/useAuth';
import {
  cancelTimelineRenderByClientRequestId,
  cancelTimelineRender,
  convertImageAssetToVideo,
  fetchVideoThumbnails,
  isTerminalTimelineRenderError,
  lookupJobByClientRequestId,
  resumeTimelineRender,
  submitTimelineRender,
  trackRegion,
  transcribeMedia,
  uploadEditorMedia,
  type EditorMediaResponse,
  type RenderTimelineResponse
} from './api/client';
import {
  isMissingCloudProjectError,
  loadCloudProject,
  resolveStoredMediaUrl,
  saveCloudProject,
  saveCloudProjectRender
} from './api/projects';
import {
  buildTimeline,
  clipAtProjectTime,
  MAX_TIMELINE_SUBTITLE_CLIPS,
  MAX_TIMELINE_TEXT_CLIPS,
  MAX_TIMELINE_VIDEO_CLIPS,
  serializeTimeline,
  sourceTimeAtProjectTime
} from './utils/timeline';
import { rasterizeTextOverlay, waitForEditorFonts } from './utils/textOverlay';
import { createKeyframeId } from './utils/keyframes';
import { DEFAULT_TEXT_ANIMATION_DURATION_MS } from './constants/textAnimations';
import { resolveTextAnimationExportKeyframes } from './utils/textAnimations';
import {
  DEFAULT_TIMELINE_HEIGHT,
  clampResizeValue,
  defaultTranscriptWidth,
  editorChromeSizes,
  editorResizeAvailability,
  readEditorLayoutPreference,
  timelineResizeBounds,
  transcriptResizeBounds,
  writeEditorLayoutPreference,
  type EditorLayoutPreference
} from './utils/editorLayout';
import { t, useUiLocale } from './i18n';
import { buildLocalRenderPayload, cancelLocalRender, runLocalRender } from './utils/localExport';
import {
  DEFAULT_VIDEO_CLIP_CORRECTION,
  type AspectRatio,
  type MediaAsset,
  type SerializedTimeline,
  type SerializedVideoClip,
  type SubtitlePreset,
  type SubtitleWordEffect,
  type TextClip,
  type TextClipColor,
  type TextClipFont,
  type TextClipKind,
  type TextClipPosition,
  type TextClipSize,
  type TextClipStyle,
  type VideoClip
} from './types/timeline';
import './App.css';

interface EditorTarget {
  projectId: string;
  source: string;
  sourceStorageKey: string;
  title: string;
  usesDefaultTitle: boolean;
  duration: number;
  aspectRatio: AspectRatio;
  returnToClippingProject: boolean;
  clippingProjectId: string;
  clippingSource: string;
  clippingVideo: string;
  clipId: string;
  clippingEditorContextId: string;
  storyboardEditorContextId: string;
  storyboardId: string;
  apiBase: string;
  localMode: boolean;
}

type StatusKind = 'neutral' | 'success' | 'error' | 'working';

const CLIPPING_EDITOR_CONTEXT_PREFIX = 'vidreum.clipping-editor-context.v1.';
const STORYBOARD_EDITOR_CONTEXT_PREFIX = 'vidreum.storyboard-editor-context.v1.';
const STORYBOARD_EDITOR_CONTEXT_TTL_MS = 60 * 60 * 1000;
const EDITABLE_GENERATED_VIDEO = /^\/generated\/[0-9a-f-]{36}(?:-e\d+)?\.mp4$/i;
const GENERATED_TRANSCRIPT_ARTIFACT = /^\/generated\/[0-9a-f-]{36}\.(srt|txt)$/i;
const MAX_CLIPPING_TRANSCRIPT_TOKENS = 1_500;
const MAX_CLIPPING_TRANSCRIPT_SECONDS = 12 * 60 * 60;
const PENDING_TIMELINE_RENDER_PREFIX = 'vidreum.timeline-render.pending.v1.';

function isLocalEditorMedia(value: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(value)
    || /^\/(?:assets|api\/storyboards)\//i.test(value);
}

function initialEditorLayoutPreference(): EditorLayoutPreference {
  const viewportWidth = typeof window === 'undefined' ? 1600 : window.innerWidth;
  if (typeof window === 'undefined') return readEditorLayoutPreference(null, viewportWidth);
  try {
    return readEditorLayoutPreference(window.localStorage, viewportWidth);
  } catch {
    return readEditorLayoutPreference(null, viewportWidth);
  }
}

interface PendingTimelineRender {
  version: 2;
  uid: string;
  projectId: string;
  jobId: string;
  clientRequestId: string;
  createdAt: number;
  snapshot: {
    title: string;
    resolution: string;
    aspectRatio: string;
  };
}

type PendingTimelineRenderIdentity = Pick<PendingTimelineRender, 'jobId' | 'clientRequestId'>;

interface ClippingSubtitleCue {
  text: string;
  startTime: number;
  endTime: number;
}

interface ClippingTranscriptWord {
  text: string;
  startTime: number;
  endTime: number;
  speaker?: string;
}

interface ClippingSubtitleOptions {
  preset: string;
  style: string;
  position: string;
  size: string;
  color: string;
  wordEffect: string;
}

interface ClippingEditorContext {
  sourceUrl: string;
  subtitleCues: ClippingSubtitleCue[];
  transcriptCues: ClippingSubtitleCue[];
  transcriptWords: ClippingTranscriptWord[];
  subtitleSrtUrl: string;
  transcriptUrl: string;
  clipStart: number;
  clipDuration: number;
  subtitleOptions: ClippingSubtitleOptions;
}

function editorAspectRatio(value: string | null): AspectRatio {
  return value === '1:1' || value === '16:9' || value === '4:5' || value === '9:16' ? value : '9:16';
}

function readEditorTarget(): EditorTarget {
  const params = new URLSearchParams(window.location.search);
  const requestedTitle = String(params.get('title') || '').slice(0, 120);
  return {
    projectId: String(params.get('projectId') || '').slice(0, 120),
    source: String(params.get('source') || ''),
    sourceStorageKey: String(params.get('sourceStorageKey') || '').trim().slice(0, 300),
    title: requestedTitle || t('Nuevo proyecto'),
    usesDefaultTitle: !requestedTitle,
    duration: Math.max(0.5, Number(params.get('duration')) || 5),
    aspectRatio: editorAspectRatio(params.get('aspectRatio')),
    returnToClippingProject: params.get('returnTo') === 'clipping-project',
    clippingProjectId: String(params.get('clippingProjectId') || '').slice(0, 160),
    clippingSource: String(params.get('clippingSource') || '').slice(0, 2048),
    clippingVideo: String(params.get('clippingVideo') || '').slice(0, 2048),
    clipId: String(params.get('clipId') || '').slice(0, 160),
    clippingEditorContextId: String(params.get('clippingEditorContextId') || '').slice(0, 160),
    storyboardEditorContextId: String(params.get('storyboardEditorContextId') || '').slice(0, 160),
    storyboardId: String(params.get('storyboardId') || '').slice(0, 160),
    apiBase: String(params.get('apiBase') || window.location.origin).replace(/\/$/, '').slice(0, 300),
    localMode: params.get('local') === '1'
  };
}

function contextRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function contextText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

// Los vídeos pesados ya respaldados se reproducen directamente desde R2 para
// que las peticiones de reproducción y búsqueda no atraviesen Cloud Run. El
// contexto de sesión solo acepta el host S3 propio de Cloudflare y una ruta
// MP4; cualquier otro HTTPS sigue rechazado.
function isTrustedR2VideoUrl(value: unknown): boolean {
  const source = contextText(value, 2048);
  try {
    const url = new URL(source);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com')
      && url.pathname.toLowerCase().endsWith('.mp4');
  } catch {
    return false;
  }
}

function contextNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeClippingSubtitleCue(value: unknown): ClippingSubtitleCue | null {
  const cue = contextRecord(value);
  if (!cue) return null;
  const text = contextText(cue.text, 80);
  const start = contextNumber(cue.start ?? cue.startTime ?? cue.start_time);
  const end = contextNumber(cue.end ?? cue.endTime ?? cue.end_time);
  if (!text || start == null || end == null) return null;
  const startTime = Math.min(90, Math.max(0, start));
  const endTime = Math.min(90, Math.max(0, end));
  return endTime - startTime >= .1 ? { text, startTime, endTime } : null;
}

function normalizeClippingTranscriptWord(value: unknown): ClippingTranscriptWord | null {
  const word = contextRecord(value);
  if (!word) return null;
  const text = contextText(word.text ?? word.word ?? word.token, 120);
  const start = contextNumber(word.start ?? word.startTime ?? word.start_time);
  const end = contextNumber(word.end ?? word.endTime ?? word.end_time);
  if (!text || start == null || end == null) return null;
  const startTime = Math.min(90, Math.max(0, start));
  const endTime = Math.min(90, Math.max(0, end));
  const speaker = contextText(word.speaker, 24);
  return endTime - startTime >= .04 ? { text, startTime, endTime, ...(speaker ? { speaker } : {}) } : null;
}

const SIGNED_R2_MEDIA_PROXY_URL = /^\/api\/r2\/media\?token=[A-Za-z0-9_-]+\.[a-f0-9]{64}$/;

function clippingTranscriptArtifactUrl(value: unknown, extension: 'srt' | 'txt'): string {
  const url = contextText(value, 2048);
  if (SIGNED_R2_MEDIA_PROXY_URL.test(url)) return url;
  const match = GENERATED_TRANSCRIPT_ARTIFACT.exec(url);
  return match?.[1].toLowerCase() === extension ? url : '';
}

function clippingContextSeconds(value: unknown, fallback: number, minimum = 0): number {
  const number = contextNumber(value);
  return number == null
    ? fallback
    : Math.min(MAX_CLIPPING_TRANSCRIPT_SECONDS, Math.max(minimum, number));
}

function readClippingEditorContext(contextId: string, userId = ''): ClippingEditorContext | null {
  if (!/^[a-z0-9_-]{1,160}$/i.test(contextId)) return null;
  try {
    const storageKey = `${CLIPPING_EDITOR_CONTEXT_PREFIX}${contextId}`;
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw || raw.length > 100_000) return null;
    const context = contextRecord(JSON.parse(raw));
    if (!context) return null;

    const expiresAt = contextNumber(context.expiresAt);
    const savedAt = contextNumber(context.savedAt);
    const expiry = expiresAt ?? (savedAt == null ? null : savedAt + 12 * 60 * 60 * 1000);
    if (expiry == null || expiry <= Date.now()) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    const ownerId = contextText(context.ownerId, 160);
    if (userId && ownerId && ownerId !== userId) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }

    const sourceUrl = contextText(context.sourceUrl, 2048);
    if (!EDITABLE_GENERATED_VIDEO.test(sourceUrl) && !isTrustedR2VideoUrl(sourceUrl)) return null;

    const options = contextRecord(context.subtitleOptions) || {};
    const subtitleOptions: ClippingSubtitleOptions = {
      preset: contextText(options.preset, 40),
      style: contextText(options.style ?? options.subtitleStyle, 24),
      position: contextText(options.position ?? options.subtitlePosition, 24),
      size: contextText(options.size ?? options.subtitleSize, 24),
      color: contextText(options.color ?? options.subtitleColor, 24),
      wordEffect: contextText(options.wordEffect, 24)
    };
    const subtitleCues = (Array.isArray(context.subtitleCues) ? context.subtitleCues : [])
      .slice(0, MAX_TIMELINE_TEXT_CLIPS)
      .map(normalizeClippingSubtitleCue)
      .filter((cue): cue is ClippingSubtitleCue => Boolean(cue))
      .sort((left, right) => left.startTime - right.startTime);
    const transcriptCues = (Array.isArray(context.transcriptCues) ? context.transcriptCues : [])
      .slice(0, 500)
      .map(normalizeClippingSubtitleCue)
      .filter((cue): cue is ClippingSubtitleCue => Boolean(cue))
      .sort((left, right) => left.startTime - right.startTime);
    const rawTranscriptWords = Array.isArray(context.transcriptWords)
      ? context.transcriptWords
      : Array.isArray(context.words)
        ? context.words
        : Array.isArray(context.wordTimings)
          ? context.wordTimings
          : [];
    const transcriptWords = rawTranscriptWords
      .slice(0, MAX_CLIPPING_TRANSCRIPT_TOKENS)
      .map(normalizeClippingTranscriptWord)
      .filter((word): word is ClippingTranscriptWord => Boolean(word))
      .sort((left, right) => left.startTime - right.startTime);
    const subtitleSrtUrl = clippingTranscriptArtifactUrl(context.subtitleSrtUrl, 'srt');
    const transcriptUrl = clippingTranscriptArtifactUrl(context.transcriptUrl, 'txt');
    const clipStart = clippingContextSeconds(context.clipStart ?? context.start, 0);
    const clipDuration = clippingContextSeconds(context.clipDuration ?? context.duration, 60, .5);

    return {
      sourceUrl,
      subtitleCues,
      transcriptCues,
      transcriptWords,
      subtitleSrtUrl,
      transcriptUrl,
      clipStart,
      clipDuration,
      subtitleOptions
    };
  } catch {
    return null;
  }
}

interface StoryboardEditorScene {
  index: number;
  sourceUrl: string;
  clipStorageKey: string;
  imageUrl: string;
  imageStorageKey: string;
  duration: number;
  narration: string;
}

// Lee el storyboard de stickmans guardado por dashboard.js
// (saveStoryboardEditorContext) y lo traduce directamente al formato
// SerializedTimeline que ya entiende buildTimeline(): un clip por escena
// (cada uno con su propio sourceUrl, algo que buildTimeline ya soporta) más
// un subtítulo por escena con la narración y la narración combinada como
// pista de audio. No hace falta ningún vídeo "fuente" único.
function readStoryboardEditorContext(contextId: string, userId = ''): Partial<SerializedTimeline> | null {
  if (!/^[a-z0-9_-]{1,160}$/i.test(contextId)) return null;
  try {
    const storageKey = `${STORYBOARD_EDITOR_CONTEXT_PREFIX}${contextId}`;
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw || raw.length > 200_000) return null;
    const context = contextRecord(JSON.parse(raw));
    if (!context) return null;

    const expiresAt = contextNumber(context.expiresAt);
    const savedAt = contextNumber(context.savedAt);
    const expiry = expiresAt ?? (savedAt == null ? null : savedAt + STORYBOARD_EDITOR_CONTEXT_TTL_MS);
    if (expiry == null || expiry <= Date.now()) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    const ownerId = contextText(context.ownerId, 160);
    if (userId && ownerId && ownerId !== userId) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }

    // El dashboard local guarda la instantánea completa del timeline en el
    // propio storyboard. Cuando existe, se reabre con todas las posiciones,
    // subtítulos y recortes que el usuario dejó guardados, sin reconstruir la
    // línea de tiempo desde cero.
    const savedEditorState = contextRecord(context.editorState);
    if (
      savedEditorState
      && contextText(savedEditorState.sourceUrl, 2048)
      && Array.isArray(savedEditorState.clips)
    ) {
      return savedEditorState as Partial<SerializedTimeline>;
    }

    const rawScenes = Array.isArray(context.scenes) ? context.scenes : [];
    const scenes = rawScenes
      .slice(0, MAX_TIMELINE_VIDEO_CLIPS)
      .map((value, index): StoryboardEditorScene | null => {
        const scene = contextRecord(value);
        if (!scene) return null;
        const sourceUrl = contextText(scene.sourceUrl, 2048);
        if (!EDITABLE_GENERATED_VIDEO.test(sourceUrl) && !/^https:\/\//i.test(sourceUrl) && !isLocalEditorMedia(sourceUrl)) return null;
        const imageUrl = contextText(scene.imageUrl, 2048);
        const duration = Math.max(0.5, contextNumber(scene.duration) ?? 5);
        return {
          index: Math.max(0, Math.floor(contextNumber(scene.index) ?? index)),
          sourceUrl,
          clipStorageKey: contextText(scene.clipStorageKey ?? scene.storageKey, 300),
          imageUrl: /^(?:\/generated\/[A-Za-z0-9._-]+|https:\/\/)/i.test(imageUrl) || isLocalEditorMedia(imageUrl) ? imageUrl : '',
          imageStorageKey: contextText(scene.imageStorageKey, 300),
          duration,
          narration: contextText(scene.narration, 240)
        };
      })
      .filter((value): value is StoryboardEditorScene => Boolean(value));
    if (!scenes.length) return null;

    let cursor = 0;
    const ranges = scenes.map((scene): [number, number, StoryboardEditorScene] => {
        const startTime = cursor;
        cursor += scene.duration;
        return [startTime, cursor, scene];
      });
    const totalDuration = Math.max(.5, cursor);
    const clips: SerializedVideoClip[] = [{
      id: 'storyboard-base',
      sourceUrl: scenes[0].sourceUrl,
      sourceDuration: totalDuration,
      sourceIn: 0,
      sourceOut: totalDuration,
      name: 'Base del storyboard'
    }];
    const brollClips = ranges
      .filter(([, , scene]) => Boolean(scene.imageUrl))
      .map(([startTime, endTime, scene], index) => ({
        id: `storyboard-image-${index + 1}`,
        sourceUrl: scene.imageUrl,
        name: `Imagen ${scene.index + 1}`,
        startTime,
        endTime,
        opacity: 1,
        x: .5,
        y: .5,
        width: 1,
        height: 1,
        blendMode: 'normal' as const
      }));
    // RacingMonos envía frases cortas ya sincronizadas con la narración; si no
    // llegan, se usa un subtítulo por escena como antes.
    const subtitleCues = (Array.isArray(context.subtitles) ? context.subtitles : [])
      .map((value) => {
        const cue = contextRecord(value);
        const text = contextText(cue?.text, 240);
        const startTime = contextNumber(cue?.start);
        const endTime = contextNumber(cue?.end);
        return text && startTime != null && endTime != null && endTime > startTime
          ? { text, startTime: Math.max(0, startTime), endTime: Math.min(totalDuration, endTime) }
          : null;
      })
      .filter((cue): cue is { text: string; startTime: number; endTime: number } => Boolean(cue && cue.endTime > cue.startTime));
    const captionSource = subtitleCues.length
      ? subtitleCues
      : ranges
        .filter(([, , scene]) => Boolean(scene.narration))
        .map(([startTime, endTime, scene]) => ({ text: scene.narration, startTime, endTime }));
    const textClips: TextClip[] = captionSource
      .slice(0, MAX_TIMELINE_SUBTITLE_CLIPS)
      .map(({ text, startTime, endTime }, index) => ({
        id: `storyboard-caption-${index + 1}`,
        kind: 'subtitle' as TextClipKind,
        text,
        startTime,
        endTime,
        style: 'outline' as TextClipStyle,
        font: 'display' as TextClipFont,
        position: 'bottom' as TextClipPosition,
        size: 'medium' as TextClipSize,
        color: 'blanco' as TextClipColor,
        x: 0.5,
        y: 0.84,
        width: 0.8,
        scale: 1,
        preset: 'karaoke' as SubtitlePreset,
        wordEffect: 'karaoke' as SubtitleWordEffect,
        entranceAnimation: 'none',
        entranceDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS,
        exitAnimation: 'none',
        exitDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS
      }));

    const audioUrl = contextText(context.audioUrl, 2048);
    const audioStorageKey = contextText(context.audioStorageKey, 300);
    const mediaAssets: MediaAsset[] = [{
      id: 'storyboard-base-video',
      name: 'Base del storyboard',
      type: 'video' as const,
      url: scenes[0].sourceUrl,
      duration: totalDuration,
    }, ...scenes.flatMap((scene, index) => [
      ...(scene.imageUrl ? [{
        id: `storyboard-image-${index + 1}`,
        name: `Viñeta ${scene.index + 1}`,
        type: 'image' as const,
        url: scene.imageUrl,
        duration: 0,
        ...(scene.imageStorageKey ? { storageKey: scene.imageStorageKey } : {})
      }] : [])
    ])];
    if (audioUrl) mediaAssets.push({
      id: 'storyboard-audio',
      name: 'Narración',
      type: 'audio',
      url: audioUrl,
      duration: 0,
      ...(audioStorageKey ? { storageKey: audioStorageKey } : {})
    });

    return {
      version: 2,
      sourceUrl: scenes[0].sourceUrl,
      sourceDuration: totalDuration,
      clips,
      textClips,
      brollClips,
      mediaAssets,
      audio: {
        mode: audioUrl ? 'replace' : 'keep',
        volume: 1,
        externalName: audioUrl ? 'Narración' : '',
        externalUrl: audioUrl
      }
    };
  } catch {
    return null;
  }
}

interface RecoveredClippingTranscript {
  words: ClippingTranscriptWord[];
  plainText: string;
  loading: boolean;
}

function srtTimestampSeconds(value: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4].padEnd(3, '0'));
  const timestamp = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function srtTokens(value: string): string[] {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\\[^}]*\}/g, ' ')
    .replace(/\\N/gi, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// Los SRT de clipping contienen frases con tiempos absolutos del vídeo de
// origen. Repartimos de forma proporcional cada frase para conservar una
// navegación palabra a palabra razonable en clips antiguos.
function clippingWordsFromSrt(document: string, clipStart: number, clipDuration: number): ClippingTranscriptWord[] {
  const source = document.replace(/^\uFEFF/, '').replace(/\r/g, '').slice(0, 240_000);
  const safeStart = Math.max(0, Math.min(MAX_CLIPPING_TRANSCRIPT_SECONDS, clipStart));
  const safeDuration = Math.max(.5, Math.min(MAX_CLIPPING_TRANSCRIPT_SECONDS, clipDuration));
  const clipEnd = safeStart + safeDuration;
  const words: ClippingTranscriptWord[] = [];

  for (const block of source.split(/\n\s*\n/)) {
    if (words.length >= MAX_CLIPPING_TRANSCRIPT_TOKENS) break;
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/.exec(lines[timingIndex]);
    if (!timing) continue;
    const cueStart = srtTimestampSeconds(timing[1]);
    const cueEnd = srtTimestampSeconds(timing[2]);
    if (cueStart == null || cueEnd == null || cueEnd <= cueStart || cueEnd <= safeStart || cueStart >= clipEnd) continue;
    const tokens = srtTokens(lines.slice(timingIndex + 1).join(' '));
    if (!tokens.length) continue;
    const totalWeight = tokens.reduce((total, token) => total + Math.max(1, token.length), 0);
    let consumedWeight = 0;
    for (const token of tokens) {
      if (words.length >= MAX_CLIPPING_TRANSCRIPT_TOKENS) break;
      const weight = Math.max(1, token.length);
      const tokenStart = cueStart + ((cueEnd - cueStart) * consumedWeight) / totalWeight;
      consumedWeight += weight;
      const tokenEnd = cueStart + ((cueEnd - cueStart) * consumedWeight) / totalWeight;
      if (tokenEnd <= safeStart || tokenStart >= clipEnd) continue;
      const startTime = Math.max(0, tokenStart - safeStart);
      const endTime = Math.min(safeDuration, Math.max(startTime + .01, tokenEnd - safeStart));
      if (endTime - startTime < .01) continue;
      words.push({
        text: token,
        startTime: Math.round(startTime * 1000) / 1000,
        endTime: Math.round(endTime * 1000) / 1000
      });
    }
  }

  return words.sort((left, right) => left.startTime - right.startTime);
}

function plainTranscriptFallback(document: string): string {
  const text = document
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= 2_400) return text;
  return `${text.slice(0, 2_399).trimEnd()}…`;
}

function clippingCaptionStyle(value: string): TextClipStyle {
  return value === 'box' || value === 'shadow' ? value : 'outline';
}

function clippingCaptionPosition(value: string): TextClipPosition {
  return value === 'top' || value === 'center' ? value : 'bottom';
}

function clippingCaptionSize(value: string): TextClipSize {
  return value === 'small' || value === 'large' ? value : 'medium';
}

function clippingCaptionWidth(size: TextClipSize): number {
  // Keep large captions to a deliberately shorter measure.  Together with
  // height-based font sizing this prevents a long cue from looking like a
  // shrunken paragraph in a vertical video.
  if (size === 'large') return .74;
  return size === 'small' ? .9 : .84;
}

function clippingCaptionColor(value: string): TextClipColor {
  const colors: TextClipColor[] = ['blanco', 'negro', 'amarillo', 'naranja', 'rojo', 'rosa', 'violeta', 'azul', 'cian', 'verde'];
  return colors.includes(value as TextClipColor) ? value as TextClipColor : 'blanco';
}

function clippingCaptionPreset(value: string): SubtitlePreset {
  const presets: SubtitlePreset[] = [
    'chrome-pink', 'gum-pop', 'pearl-gold', 'studio-wood',
    'none', 'beasty', 'youshaei', 'mozi', 'glitch', 'karaoke', 'deep', 'podp', 'popline',
    'seamless', 'think', 'focus', 'blur', 'backdrop', 'soft', 'baby', 'grow', 'breathe'
  ];
  return presets.includes(value as SubtitlePreset) ? value as SubtitlePreset : 'karaoke';
}

function clippingCaptionWordEffect(value: string): SubtitleWordEffect {
  const effects: SubtitleWordEffect[] = ['karaoke', 'pop', 'bounce', 'flash'];
  return effects.includes(value as SubtitleWordEffect) ? value as SubtitleWordEffect : 'karaoke';
}

function clippingCaptionFont(preset: string): TextClipFont {
  if (preset === 'chrome-pink' || preset === 'gum-pop') return 'rounded';
  if (preset === 'pearl-gold' || preset === 'studio-wood') return 'serif';
  if (preset === 'deep' || preset === 'blur' || preset === 'backdrop') return 'serif';
  if (preset === 'mozi' || preset === 'glitch') return 'mono';
  if (preset === 'soft' || preset === 'baby' || preset === 'breathe') return 'rounded';
  if (preset === 'podp') return 'condensed';
  return ['beasty', 'karaoke', 'popline', 'grow', 'think', 'focus'].includes(preset) ? 'display' : 'modern';
}

function clippingCaptionsToTextClips(context: ClippingEditorContext, duration: number): TextClip[] {
  const position = clippingCaptionPosition(context.subtitleOptions.position);
  const size = clippingCaptionSize(context.subtitleOptions.size);
  const y = position === 'top' ? .12 : position === 'center' ? .5 : .86;
  const safeDuration = Math.max(.5, duration);
  return context.subtitleCues.reduce<TextClip[]>((clips, cue, index) => {
    const startTime = Math.min(safeDuration, Math.max(0, cue.startTime));
    const endTime = Math.min(safeDuration, Math.max(startTime + .1, cue.endTime));
    if (endTime - startTime < .1) return clips;
    clips.push({
      id: `clipping-caption-${index + 1}`,
      kind: 'subtitle',
      text: cue.text,
      startTime,
      endTime,
      style: clippingCaptionStyle(context.subtitleOptions.style),
      font: clippingCaptionFont(context.subtitleOptions.preset),
      position,
      size,
      color: clippingCaptionColor(context.subtitleOptions.color),
      x: .5,
      y,
      width: clippingCaptionWidth(size),
      scale: 1,
      preset: clippingCaptionPreset(context.subtitleOptions.preset),
      wordEffect: clippingCaptionWordEffect(context.subtitleOptions.wordEffect),
      entranceAnimation: 'none',
      entranceDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS,
      exitAnimation: 'none',
      exitDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS
    });
    return clips;
  }, []);
}

function editorReturnHref(target: EditorTarget): string {
  if (target.localMode) return `${target.apiBase}/`;
  if (!target.returnToClippingProject) return '/';
  const params = new URLSearchParams({ view: 'clipping-project' });
  if (target.clippingProjectId) params.set('clippingProjectId', target.clippingProjectId);
  if (!target.clippingProjectId && target.clippingSource) params.set('clippingSource', target.clippingSource);
  if (!target.clippingProjectId && target.clippingVideo) params.set('clippingVideo', target.clippingVideo);
  if (target.clipId) params.set('clipId', target.clipId);
  return `/?${params.toString()}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select')) return true;
  const editableHost = target.closest('[contenteditable]');
  return editableHost instanceof HTMLElement && editableHost.isContentEditable;
}

function localStateKey(source: string): string {
  return `vidreum:timeline:${source}`;
}

function readLocalTimeline(source: string): SerializedTimeline | undefined {
  try {
    const value = localStorage.getItem(localStateKey(source));
    return value ? JSON.parse(value) as SerializedTimeline : undefined;
  } catch {
    return undefined;
  }
}

function pendingTimelineRenderKey(uid: string, projectId: string): string {
  return `${PENDING_TIMELINE_RENDER_PREFIX}${encodeURIComponent(uid)}.${encodeURIComponent(projectId)}`;
}

function readPendingTimelineRender(uid: string, projectId: string): PendingTimelineRender | null {
  if (!uid || !projectId) return null;
  try {
    const raw = localStorage.getItem(pendingTimelineRenderKey(uid, projectId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingTimelineRender>;
    const snapshot = value.snapshot && typeof value.snapshot === 'object' ? value.snapshot : null;
    const jobId = String(value.jobId || '').trim();
    const clientRequestId = String(value.clientRequestId || '').trim();
    if (
      ![1, 2].includes(Number(value.version))
      || value.uid !== uid
      || value.projectId !== projectId
      || (!/^[0-9a-f-]{36}$/i.test(jobId) && !/^[a-zA-Z0-9_-]{8,128}$/.test(clientRequestId))
      || !Number.isFinite(value.createdAt)
      || !snapshot
    ) {
      localStorage.removeItem(pendingTimelineRenderKey(uid, projectId));
      return null;
    }
    return {
      version: 2,
      uid,
      projectId,
      jobId: /^[0-9a-f-]{36}$/i.test(jobId) ? jobId : '',
      clientRequestId: /^[a-zA-Z0-9_-]{8,128}$/.test(clientRequestId) ? clientRequestId : '',
      createdAt: Number(value.createdAt),
      snapshot: {
        title: String(snapshot.title || '').slice(0, 120),
        resolution: String(snapshot.resolution || '').slice(0, 20),
        aspectRatio: String(snapshot.aspectRatio || '').slice(0, 20)
      }
    };
  } catch {
    localStorage.removeItem(pendingTimelineRenderKey(uid, projectId));
    return null;
  }
}

function writePendingTimelineRender(pending: PendingTimelineRender): void {
  try {
    // Solo se conserva identidad y metadatos pequeños. El payload del render,
    // los blobs y los data URL pertenecen al manifiesto R2, nunca a storage.
    localStorage.setItem(pendingTimelineRenderKey(pending.uid, pending.projectId), JSON.stringify(pending));
  } catch {
    // La exportación puede continuar aunque el navegador haya deshabilitado
    // localStorage; simplemente no podrá recuperarse tras cerrar esta pestaña.
  }
}

function clearPendingTimelineRender(
  uid: string,
  projectId: string,
  expected: Partial<PendingTimelineRenderIdentity> = {}
): void {
  try {
    const key = pendingTimelineRenderKey(uid, projectId);
    const current = JSON.parse(localStorage.getItem(key) || 'null') as Partial<PendingTimelineRender> | null;
    if (expected.jobId && String(current?.jobId || '') !== expected.jobId) return;
    if (expected.clientRequestId && String(current?.clientRequestId || '') !== expected.clientRequestId) return;
    localStorage.removeItem(key);
  } catch {
    // Nada más que limpiar.
  }
}

// Los vídeos y fotos capturados desde el móvil (cámara, galería) a menudo
// llegan con `file.type` vacío o genérico ("application/octet-stream"): el
// sistema operativo/navegador no siempre asocia un MIME al archivo recién
// grabado. Sin esto, `readMediaDuration` se salta la lectura de duración y
// el data URL que genera `fileToDataUrl` no coincide con ningún formato
// reconocido por el servidor, que responde con un error genérico al subir.
// Deducimos el tipo por extensión y reconstruimos el File antes de usarlo.
const UPLOAD_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/x-m4a',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif'
};

function resolveUploadFile(file: File): File {
  const hasUsableType = Boolean(file.type) && file.type !== 'application/octet-stream';
  if (hasUsableType) return file;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const resolvedType = UPLOAD_MIME_BY_EXTENSION[extension];
  return resolvedType ? new File([file], file.name, { type: resolvedType }) : file;
}

// El servidor solo almacena PNG/JPEG/WEBP, pero el usuario tiene a mano
// formatos que no están en esa lista: la propia web genera sus imágenes en
// AVIF y las fotos de iPhone llegan como HEIC. Antes esos archivos se
// rechazaban con "El archivo debe ser una imagen, un audio o un vídeo...".
// Aquí se reconvierten en el navegador a WEBP (o PNG si el navegador no sabe
// exportar WEBP) antes de subirlos, conservando la transparencia.
const SERVER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function normalizeImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || SERVER_IMAGE_TYPES.has(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // El navegador no sabe decodificar este formato (p. ej. HEIC fuera de
    // Safari): se sube tal cual y el servidor devuelve su error habitual.
    return file;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/webp', .92) || await canvasToBlob(canvas, 'image/png');
    if (!blob) return file;
    const extension = blob.type === 'image/png' ? 'png' : 'webp';
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'imagen';
    return new File([blob], `${baseName}.${extension}`, { type: blob.type });
  } finally {
    bitmap.close();
  }
}

function readMediaDuration(file: File): Promise<number> {
  if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) return Promise.resolve(0);
  return new Promise((resolve) => {
    const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const finish = (duration = 0) => {
      URL.revokeObjectURL(url);
      // Sin tope: este lector alimenta la importación general del editor de
      // timeline, no la funcionalidad de Clipping (que sí limita a 90s aparte).
      resolve(Number.isFinite(duration) ? Math.max(0, duration) : 0);
    };
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(media.duration);
    media.onerror = () => finish();
    media.src = url;
  });
}

function uniqueAssets(assets: MediaAsset[]): MediaAsset[] {
  const urls = new Set<string>();
  return assets.filter((asset) => {
    if (!asset.url || urls.has(asset.url)) return false;
    urls.add(asset.url);
    return true;
  // Un storyboard de 60 escenas conserva el vídeo y la viñeta original de
  // cada escena, además de su narración: 60 no bastaba y al guardar desde el
  // editor desaparecían las imageStorageKey de la segunda mitad.
  }).slice(0, 140);
}

function mediaResponseToAsset(result: EditorMediaResponse): MediaAsset {
  return {
    id: result.id,
    name: result.name,
    type: result.type,
    url: result.url,
    duration: result.duration || 0,
    ...(result.key ? { storageKey: result.key } : {}),
    ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {})
  };
}

export function App() {
  const auth = useAuth();
  const locale = useUiLocale();
  const target = useMemo(readEditorTarget, []);
  const clippingEditorContext = useMemo(
    () => readClippingEditorContext(target.clippingEditorContextId, auth.user?.uid || ''),
    [auth.user?.uid, target.clippingEditorContextId]
  );
  const storyboardEditorContext = useMemo(
    () => readStoryboardEditorContext(target.storyboardEditorContextId, auth.user?.uid || ''),
    [auth.user?.uid, target.storyboardEditorContextId]
  );
  const returnHref = editorReturnHref(target);
  const returnLabel = target.localMode
    ? 'Volver a RacingMonos'
    : target.returnToClippingProject ? 'Volver a los clips generados' : 'Volver a Vidreum.ai';
  const timeline = useTimelineStore((state) => state.timeline);
  const currentTime = useTimelineStore((state) => state.currentTime);
  const isDirty = useTimelineStore((state) => state.isDirty);
  const history = useTimelineStore((state) => state.history);
  const future = useTimelineStore((state) => state.future);
  const loadTimeline = useTimelineStore((state) => state.loadTimeline);
  const markSaved = useTimelineStore((state) => state.markSaved);
  const addTextClip = useTimelineStore((state) => state.addTextClip);
  const updateTextClip = useTimelineStore((state) => state.updateTextClip);
  const updateBrollClip = useTimelineStore((state) => state.updateBrollClip);
  const setAutoSubtitleClips = useTimelineStore((state) => state.setAutoSubtitleClips);
  const addVideoClip = useTimelineStore((state) => state.addVideoClip);
  const setSourceThumbnails = useTimelineStore((state) => state.setSourceThumbnails);
  const addBrollClip = useTimelineStore((state) => state.addBrollClip);
  const updateSettings = useTimelineStore((state) => state.updateSettings);
  const updateAudioTrack = useTimelineStore((state) => state.updateAudioTrack);
  const splitVideoClipAtPlayhead = useTimelineStore((state) => state.splitVideoClipAtPlayhead);
  const removeSelection = useTimelineStore((state) => state.removeSelection);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const setCurrentTime = useTimelineStore((state) => state.setCurrentTime);
  const togglePlaying = useTimelineStore((state) => state.togglePlaying);
  const rectangleSelectionActive = useTimelineStore((state) => state.rectangleSelectionActive);
  const undo = useTimelineStore((state) => state.undo);
  const redo = useTimelineStore((state) => state.redo);
  const clipboardCount = useTimelineStore((state) => state.clipboardCount);
  const copySelection = useTimelineStore((state) => state.copySelection);
  const pasteClipboard = useTimelineStore((state) => state.pasteClipboard);
  const duplicateSelection = useTimelineStore((state) => state.duplicateSelection);
  const appRef = useRef<HTMLDivElement>(null);
  const initializedForUser = useRef('');
  const defaultTitleActiveRef = useRef(target.usesDefaultTitle);
  const renderControllerRef = useRef<AbortController | null>(null);
  const activeRenderJobRef = useRef('');
  const activeRenderProjectRef = useRef('');
  const recoveryAttemptRef = useRef('');
  const recoveryRetryTimerRef = useRef<number | null>(null);

  // Los proyectos abiertos sin `?projectId=` (p.ej. "Nuevo proyecto" desde el
  // dashboard) no tenían id hasta ahora, así que persistProject los guardaba
  // solo en localStorage y nunca llegaban a R2/Cloudflare. Generamos un id
  // aquí en el primer guardado y lo reflejamos en la URL para que los
  // guardados siguientes reutilicen el mismo proyecto en la nube.
  const [projectId, setProjectId] = useState(target.projectId);
  const [title, setTitle] = useState(target.title);
  const [savedTitle, setSavedTitle] = useState(target.title);
  const [status, setStatus] = useState('Abriendo el proyecto…');
  const [statusKind, setStatusKind] = useState<StatusKind>('working');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCancellingExport, setIsCancellingExport] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [assetsDirty, setAssetsDirty] = useState(false);
  const [activePanel, setActivePanel] = useState<EditorPanel | null>(null);
  const [selectedTransitionClipId, setSelectedTransitionClipId] = useState<string | null>(null);
  const [timelineVisible, setTimelineVisible] = useState(true);
  const [editorLayout, setEditorLayout] = useState<EditorLayoutPreference>(initialEditorLayoutPreference);
  const [editorSize, setEditorSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1600 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight
  }));
  const [exportResult, setExportResult] = useState<RenderTimelineResponse | null>(null);
  const [exportSaved, setExportSaved] = useState(false);
  const [recoveryRetryTick, setRecoveryRetryTick] = useState(0);
  const [recoveredClippingTranscript, setRecoveredClippingTranscript] = useState<RecoveredClippingTranscript>({
    words: [],
    plainText: '',
    loading: false
  });
  const [ownTranscriptWords, setOwnTranscriptWords] = useState<ClippingTranscriptToken[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showOwnTranscript, setShowOwnTranscript] = useState(false);
  const latestAssetsRef = useRef(assets);
  const latestTitleRef = useRef(title);
  latestAssetsRef.current = assets;
  latestTitleRef.current = title;

  const transcriptBounds = useMemo(
    () => transcriptResizeBounds(editorSize.width, Boolean(activePanel)),
    [activePanel, editorSize.width]
  );
  const timelineBounds = useMemo(() => timelineResizeBounds(editorSize.height), [editorSize.height]);
  const chromeSizes = useMemo(() => editorChromeSizes(editorSize.width), [editorSize.width]);
  const resizeAvailability = useMemo(() => editorResizeAvailability(editorSize.width), [editorSize.width]);
  const transcriptResizeEnabled = resizeAvailability.transcript;
  const timelineResizeEnabled = resizeAvailability.timeline;
  const transcriptWidth = transcriptResizeEnabled
    ? clampResizeValue(editorLayout.transcriptWidth, transcriptBounds)
    : editorLayout.transcriptWidth;
  const timelineHeight = timelineResizeEnabled
    ? clampResizeValue(editorLayout.timelineHeight, timelineBounds)
    : editorLayout.timelineHeight;
  const appLayoutStyle = {
    '--transcript-panel-width': `${transcriptWidth}px`,
    '--timeline-height': `${timelineHeight}px`,
    '--canvas-min-width': `${chromeSizes.canvasMinimumWidth}px`,
    '--properties-panel-width': `${chromeSizes.propertiesPanelWidth}px`,
    '--editor-tool-rail-width': `${chromeSizes.toolRailWidth}px`
  } as CSSProperties;

  useEffect(() => {
    const node = appRef.current;
    if (!node) return;
    let animationFrame = 0;
    const updateSize = (width: number, height: number) => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setEditorSize((current) => current.width === width && current.height === height
          ? current
          : { width, height });
      });
    };
    const measure = () => {
      const rect = node.getBoundingClientRect();
      updateSize(Math.round(rect.width), Math.round(rect.height));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => {
        updateSize(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height));
      });
      observer.observe(node);
      return () => {
        observer.disconnect();
        window.cancelAnimationFrame(animationFrame);
      };
    }
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [auth.loading, auth.user?.uid]);

  useEffect(() => {
    try {
      writeEditorLayoutPreference(window.localStorage, editorLayout);
    } catch {
      // La preferencia es opcional; no debe bloquear el editor.
    }
  }, [editorLayout]);

  useEffect(() => {
    if (!defaultTitleActiveRef.current) return;
    const localizedDefault = t('Nuevo proyecto');
    setTitle(localizedDefault);
    setSavedTitle(localizedDefault);
  }, [locale]);

  const hasUnsavedChanges = isDirty || assetsDirty || title !== savedTitle;
  const clippingPanelCues = useMemo(() => {
    if (clippingEditorContext?.transcriptCues.length) return clippingEditorContext.transcriptCues;
    if (clippingEditorContext?.subtitleCues.length) return clippingEditorContext.subtitleCues;
    return [];
  }, [clippingEditorContext?.subtitleCues, clippingEditorContext?.transcriptCues]);
  const hasContextTranscript = Boolean(clippingEditorContext?.transcriptWords.length || clippingPanelCues.length);

  useEffect(() => {
    const context = clippingEditorContext;
    const shouldRecover = target.returnToClippingProject
      && Boolean(context)
      && !hasContextTranscript
      && Boolean(context?.subtitleSrtUrl || context?.transcriptUrl);
    if (!shouldRecover || !context) {
      setRecoveredClippingTranscript({ words: [], plainText: '', loading: false });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setRecoveredClippingTranscript({ words: [], plainText: '', loading: true });

    const fetchTranscriptDocument = async (url: string): Promise<string> => {
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`No se pudo descargar la transcripción (${response.status}).`);
      return response.text();
    };

    const recover = async () => {
      if (context.subtitleSrtUrl) {
        try {
          const document = await fetchTranscriptDocument(context.subtitleSrtUrl);
          const words = clippingWordsFromSrt(document, context.clipStart, context.clipDuration);
          if (words.length) {
            if (!cancelled) setRecoveredClippingTranscript({ words, plainText: '', loading: false });
            return;
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          console.warn('No se pudo recuperar el SRT del clip en el editor.', error);
        }
      }

      if (context.transcriptUrl) {
        try {
          const document = await fetchTranscriptDocument(context.transcriptUrl);
          const plainText = plainTranscriptFallback(document);
          if (!cancelled) setRecoveredClippingTranscript({ words: [], plainText, loading: false });
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          console.warn('No se pudo recuperar el TXT del clip en el editor.', error);
        }
      }

      if (!cancelled) setRecoveredClippingTranscript({ words: [], plainText: '', loading: false });
    };

    void recover();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [clippingEditorContext, hasContextTranscript, target.returnToClippingProject]);

  const clippingPanelWords = useMemo(() => {
    if (clippingEditorContext?.transcriptWords.length) return clippingEditorContext.transcriptWords;
    return clippingPanelCues.length ? [] : recoveredClippingTranscript.words;
  }, [clippingEditorContext?.transcriptWords, clippingPanelCues.length, recoveredClippingTranscript.words]);
  const clippingPanelPlainText = clippingPanelWords.length || clippingPanelCues.length
    ? ''
    : recoveredClippingTranscript.plainText;

  useEffect(() => {
    if (!auth.user && !target.localMode) return;
    const userId = auth.user?.uid || 'local';
    const loadKey = `${userId}:${target.projectId}:${target.storyboardEditorContextId}:${clippingEditorContext?.sourceUrl || target.source}`;
    if (initializedForUser.current === loadKey) return;
    initializedForUser.current = loadKey;
    let cancelled = false;

    const initialize = async () => {
      setIsLoading(true);
      setStatus(target.source ? 'Analizando el vídeo y preparando fotogramas…' : 'Añade un vídeo para empezar a editar.');
      setStatusKind('working');
      try {
        const cloudProject = !target.localMode && auth.user && target.projectId
          ? await loadCloudProject(auth.user.uid, target.projectId)
          : null;
        const resolvedTargetSource = target.localMode
          ? target.source
          : (!target.source && target.sourceStorageKey
            ? await resolveStoredMediaUrl(target.sourceStorageKey)
            : target.source);
        const contextSource = clippingEditorContext?.sourceUrl
          || resolvedTargetSource
          || storyboardEditorContext?.sourceUrl
          || '';
        const savedState = cloudProject?.editorState
          || storyboardEditorContext
          || readLocalTimeline(contextSource)
          || (contextSource !== target.source ? readLocalTimeline(target.source) : undefined);
        const source = savedState?.sourceUrl || clippingEditorContext?.sourceUrl || cloudProject?.videoUrl || resolvedTargetSource;
        const duration = savedState?.sourceDuration || cloudProject?.duration || target.duration;
        const savedAssets = savedState?.mediaAssets || [];
        const videoStorageKeyForUrl = (url: string): string => String(
          savedAssets.find((asset) => asset.type === 'video' && asset.url === url)?.storageKey
          || (url === cloudProject?.videoUrl ? cloudProject.videoStorageKey : '')
          || (url === target.source || url === resolvedTargetSource ? target.sourceStorageKey : '')
          || ''
        ).trim();
        // Un clip recién generado vive en el disco local del servidor
        // (/generated/...), pero en cuanto el proyecto se guarda una vez, ese
        // mismo clip pasa a servirse desde una URL firmada de R2
        // (https://...): reabrir un borrador ya guardado es el caso normal,
        // no uno inválido, así que también cuenta como editable.
        if (source && !target.localMode && !/^\/generated\/[0-9a-f-]{36}(?:-e\d+)?\.mp4$/i.test(source) && !/^https:\/\//i.test(source)) {
          throw new Error('Este proyecto no contiene un vídeo editable. Vuelve a generarlo primero.');
        }

        const firstThumbnails = source && !target.localMode
          ? await fetchVideoThumbnails(source, duration, auth.getToken, videoStorageKeyForUrl(source))
          : [];
        const nextTimeline = buildTimeline(source, duration, firstThumbnails, savedState, target.aspectRatio);
        if (
          clippingEditorContext
          && source === clippingEditorContext.sourceUrl
          && !nextTimeline.textTrack.clips.length
        ) {
          nextTimeline.textTrack.clips = clippingCaptionsToTextClips(clippingEditorContext, nextTimeline.duration);
        }
        const sourceData = new Map(nextTimeline.videoTrack.clips.map((clip) => [clip.sourceUrl, clip.sourceDuration]));
        const thumbnailSets = new Map<string, string[]>(source ? [[source, firstThumbnails]] : []);
        if (!target.localMode) {
          await Promise.all([...sourceData.entries()].map(async ([clipSource, clipDuration]) => {
            if (thumbnailSets.has(clipSource)) return;
            try {
              thumbnailSets.set(clipSource, await fetchVideoThumbnails(
                clipSource,
                clipDuration,
                auth.getToken,
                videoStorageKeyForUrl(clipSource)
              ));
            } catch {
              thumbnailSets.set(clipSource, []);
            }
          }));
        }
        nextTimeline.videoTrack.clips = nextTimeline.videoTrack.clips.map((clip) => ({
          ...clip,
          ...(videoStorageKeyForUrl(clip.sourceUrl) ? { storageKey: videoStorageKeyForUrl(clip.sourceUrl) } : {}),
          thumbnails: thumbnailSets.get(clip.sourceUrl) || []
        }));
        if (cancelled) return;
        loadTimeline(nextTimeline);

        const savedAssetKey = (url: string, type: MediaAsset['type'], fallback = '') => String(
          savedAssets.find((asset) => asset.type === type && asset.url === url)?.storageKey
          || fallback
          || ''
        ).trim();
        const withStorageKey = (asset: MediaAsset, fallback = ''): MediaAsset => {
          const storageKey = savedAssetKey(asset.url, asset.type, fallback);
          return storageKey ? { ...asset, storageKey } : asset;
        };
        const derivedAssets: MediaAsset[] = [
          ...nextTimeline.videoTrack.clips.map((clip, index) => withStorageKey({
            id: `video-${clip.id}`,
            name: clip.name,
            type: 'video' as const,
            url: clip.sourceUrl,
            duration: clip.sourceDuration
          }, index === 0
            ? (clip.sourceUrl === cloudProject?.videoUrl ? cloudProject.videoStorageKey || '' : '')
              || (clip.sourceUrl === target.source || clip.sourceUrl === resolvedTargetSource ? target.sourceStorageKey : '')
            : '')),
          ...nextTimeline.brollTrack.clips.map((clip) => withStorageKey({
            id: `image-${clip.id}`,
            name: clip.name,
            type: 'image' as const,
            url: clip.sourceUrl,
            duration: 0
          })),
          ...(nextTimeline.audioTrack.externalUrl ? [withStorageKey({
            id: 'project-audio',
            name: nextTimeline.audioTrack.externalName,
            type: 'audio' as const,
            url: nextTimeline.audioTrack.externalUrl,
            duration: 0
          }, cloudProject?.audioStorageKey || '')] : []),
          ...(nextTimeline.settings.brandLogoUrl ? [withStorageKey({
            id: 'brand-logo',
            name: nextTimeline.settings.brandLogoName,
            type: 'image' as const,
            url: nextTimeline.settings.brandLogoUrl,
            duration: 0
          })] : [])
        ];
        setAssets(uniqueAssets([...savedAssets, ...derivedAssets]));
        setAssetsDirty(false);
        defaultTitleActiveRef.current = !cloudProject?.title && target.usesDefaultTitle;
        const nextTitle = cloudProject?.title
          || (target.usesDefaultTitle ? t('Nuevo proyecto') : target.title);
        setTitle(nextTitle);
        setSavedTitle(nextTitle);
        setStatus(source ? '' : 'Añade un vídeo para empezar a editar.');
        setStatusKind('success');
      } catch (reason) {
        if (cancelled) return;
        setStatus(reason instanceof Error ? reason.message : 'No se pudo abrir el proyecto.');
        setStatusKind('error');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    initialize();
    return () => {
      cancelled = true;
      if (initializedForUser.current === loadKey) initializedForUser.current = '';
    };
  }, [auth.user, clippingEditorContext, storyboardEditorContext, loadTimeline, target]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Cerrar sesión o abandonar la vista solo detiene el sondeo local. El job y
  // su puntero pendiente se conservan para la misma cuenta/proyecto.
  useEffect(() => {
    setIsExporting(false);
    setIsCancellingExport(false);
    activeRenderJobRef.current = '';
    activeRenderProjectRef.current = '';
    return () => {
      renderControllerRef.current?.abort();
      renderControllerRef.current = null;
      if (recoveryRetryTimerRef.current != null) {
        window.clearTimeout(recoveryRetryTimerRef.current);
        recoveryRetryTimerRef.current = null;
      }
    };
  }, [auth.user?.uid]);

  const addClip = useCallback((kind: TextClipKind) => {
    const state = useTimelineStore.getState();
    if (!state.timeline) return;
    const limit = kind === 'subtitle' ? MAX_TIMELINE_SUBTITLE_CLIPS : MAX_TIMELINE_TEXT_CLIPS;
    const count = state.timeline.textTrack.clips.filter((clip) => clip.kind === kind).length;
    if (count >= limit) {
      setStatus(`Puedes añadir hasta ${limit} ${kind === 'subtitle' ? 'subtítulos' : 'frases'} por vídeo.`);
      setStatusKind('error');
      return;
    }
    const duration = state.timeline.duration;
    const startTime = Math.min(state.currentTime, Math.max(0, duration - .2));
    const position = kind === 'subtitle' ? 'bottom' : 'center';
    addTextClip({
      id: `text-${crypto.randomUUID()}`,
      kind,
      text: t(kind === 'subtitle' ? 'Nuevo subtítulo' : 'Nueva frase'),
      startTime,
      endTime: Math.min(duration, startTime + 2),
      style: 'outline',
      font: 'modern',
      position,
      size: 'medium',
      color: 'blanco',
      x: 0.5,
      y: position === 'bottom' ? .86 : .5,
      width: 0.72,
      scale: 1,
      preset: 'chrome-pink',
      wordEffect: 'karaoke',
      entranceAnimation: 'none',
      entranceDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS,
      exitAnimation: 'none',
      exitDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS
    });
    // Salta el playhead al inicio de la frase recién creada: si el usuario
    // estaba viendo otro punto del vídeo, de lo contrario no vería nada nuevo
    // en el lienzo y parecería que el subtítulo/texto no se añadió.
    setCurrentTime(startTime);
    setActivePanel(kind === 'subtitle' ? 'subtitles' : 'text');
  }, [addTextClip, setCurrentTime]);
  const addSubtitle = useCallback(() => addClip('subtitle'), [addClip]);
  const addTextOverlay = useCallback(() => addClip('text'), [addClip]);

  const mediaStorageKeyForUrl = useCallback((source: string, type?: MediaAsset['type']): string => String(
    assets.find((asset) => (!type || asset.type === type) && asset.url === source)?.storageKey
    || ((!type || type === 'video') && source === target.source ? target.sourceStorageKey : '')
    || ''
  ).trim(), [assets, target.source, target.sourceStorageKey]);

  const handleTranscribe = useCallback(async () => {
    const source = timeline?.videoTrack.clips[0]?.sourceUrl;
    if (!source || isTranscribing) return;
    setIsTranscribing(true);
    setStatus('Transcribiendo el vídeo…');
    setStatusKind('working');
    try {
      const token = await auth.getToken();
      const words = await transcribeMedia(source, token, mediaStorageKeyForUrl(source));
      setOwnTranscriptWords(words.map((word) => ({ text: word.text, startTime: word.start, endTime: word.end })));
      setShowOwnTranscript(true);
      setStatus(words.length ? 'Transcripción lista.' : 'No se detectó voz en el vídeo.');
      setStatusKind(words.length ? 'success' : 'error');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'No se pudo transcribir el vídeo.');
      setStatusKind('error');
    } finally {
      setIsTranscribing(false);
    }
  }, [auth, isTranscribing, mediaStorageKeyForUrl, timeline]);

  // Agrupa las palabras transcritas en frases cortas (mismo criterio que
  // SUBTITLE_LAYOUTS.medium en clipping-subtitles.js: hasta 5 palabras, 36
  // caracteres, 4.4 s, o un corte si hay más de 0.85 s de silencio) para que
  // cada grupo se convierta en un clip de subtítulo con su propio intervalo.
  const groupWordsIntoSubtitleClips = useCallback((words: ClippingTranscriptToken[], maxClips: number): TextClip[] => {
    const groups: ClippingTranscriptToken[][] = [];
    let current: ClippingTranscriptToken[] = [];
    const flush = () => {
      if (current.length) groups.push(current);
      current = [];
    };
    for (const word of words) {
      const text = word.text.trim();
      if (!text) continue;
      const previous = current[current.length - 1];
      const characters = current.reduce((total, item) => total + item.text.length + 1, 0);
      const wouldOverflow = current.length > 0 && (
        current.length >= 5
        || characters + text.length + 1 > 36
        || (previous && word.startTime - previous.endTime > 0.85)
        || (previous && word.endTime - current[0].startTime > 4.4)
      );
      if (wouldOverflow) flush();
      current.push({ ...word, text });
      if (/[.!?…]$/.test(text) && current.length >= 3) flush();
    }
    flush();
    return groups.slice(0, Math.max(0, maxClips)).map((group, index) => ({
      id: `subtitle-auto-${Date.now()}-${index}`,
      kind: 'subtitle' as const,
      text: group.map((word) => word.text).join(' ').slice(0, 80),
      startTime: group[0].startTime,
      endTime: Math.max(group[0].startTime + .3, group[group.length - 1].endTime),
      style: 'outline' as const,
      font: 'modern' as const,
      position: 'bottom' as const,
      size: 'medium' as const,
      color: 'blanco' as const,
      x: 0.5,
      y: .86,
      width: 0.72,
      scale: 1,
      preset: 'chrome-pink' as const,
      wordEffect: 'karaoke' as const,
      entranceAnimation: 'none' as const,
      entranceDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS,
      exitAnimation: 'none' as const,
      exitDurationMs: DEFAULT_TEXT_ANIMATION_DURATION_MS
    }));
  }, []);

  const handleAutoCaption = useCallback(async () => {
    const state = useTimelineStore.getState();
    const source = state.timeline?.videoTrack.clips[0]?.sourceUrl;
    if (!state.timeline || !source || isTranscribing) return;
    setIsTranscribing(true);
    setStatus('Transcribiendo el vídeo para generar los subtítulos…');
    setStatusKind('working');
    try {
      let words = ownTranscriptWords;
      if (!words.length) {
        const token = await auth.getToken();
        const fetched = await transcribeMedia(source, token, mediaStorageKeyForUrl(source));
        words = fetched.map((word) => ({ text: word.text, startTime: word.start, endTime: word.end }));
        setOwnTranscriptWords(words);
      }
      // setAutoSubtitleClips sustituye todos los subtítulos existentes, así
      // que el tope disponible es el máximo completo, no una resta sobre las
      // frases de texto libre (esas usan su propio límite, sin relación).
      const clips = groupWordsIntoSubtitleClips(words, MAX_TIMELINE_SUBTITLE_CLIPS);
      if (!clips.length) {
        setStatus('No se detectó voz en el vídeo.');
        setStatusKind('error');
        return;
      }
      setAutoSubtitleClips(clips);
      setActivePanel('subtitles');
      setStatus(`${clips.length} subtítulo${clips.length === 1 ? '' : 's'} generado${clips.length === 1 ? '' : 's'} desde la transcripción.`);
      setStatusKind('success');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'No se pudo transcribir el vídeo.');
      setStatusKind('error');
    } finally {
      setIsTranscribing(false);
    }
  }, [auth, groupWordsIntoSubtitleClips, isTranscribing, mediaStorageKeyForUrl, ownTranscriptWords, setAutoSubtitleClips]);

  const reportClipboardAction = useCallback((action: 'copiado' | 'pegado' | 'duplicado', count: number) => {
    if (count < 1) return;
    if (locale === 'en') {
      const actionLabel = action === 'copiado' ? 'copied' : action === 'pegado' ? 'pasted' : 'duplicated';
      setStatus(`${count} item${count === 1 ? '' : 's'} ${actionLabel}.`);
    } else {
      const suffix = count === 1 ? '' : 's';
      setStatus(`${count} elemento${suffix} ${action}${suffix}.`);
    }
    setStatusKind('success');
  }, [locale]);

  const handleCopySelection = useCallback((): number => {
    if (isLoading || isExporting) return 0;
    const count = copySelection();
    reportClipboardAction('copiado', count);
    return count;
  }, [copySelection, isExporting, isLoading, reportClipboardAction]);

  const handlePasteClipboard = useCallback((): number => {
    if (isLoading || isExporting) return 0;
    const expectedCount = useTimelineStore.getState().clipboardCount;
    const count = pasteClipboard();
    if (count > 0 && count < expectedCount) {
      setStatus(locale === 'en'
        ? `${count} of ${expectedCount} items pasted; a track has reached its limit.`
        : `${count} de ${expectedCount} elementos pegados; alguna pista ha alcanzado su límite.`);
      setStatusKind('error');
    } else if (count > 0) reportClipboardAction('pegado', count);
    else if (expectedCount > 0) {
      setStatus(locale === 'en'
        ? 'Could not paste: one of the tracks has reached its item limit.'
        : 'No se pudo pegar: una de las pistas ha alcanzado su límite de elementos.');
      setStatusKind('error');
    }
    return count;
  }, [isExporting, isLoading, locale, pasteClipboard, reportClipboardAction]);

  const handleDuplicateSelection = useCallback((): number => {
    if (isLoading || isExporting) return 0;
    const state = useTimelineStore.getState();
    const hadSelection = Boolean(state.selection || state.rangeSelection);
    const count = duplicateSelection();
    if (count > 0) reportClipboardAction('duplicado', count);
    else if (hadSelection) {
      setStatus(locale === 'en'
        ? 'Could not duplicate: the selection is empty or a track has reached its limit.'
        : 'No se pudo duplicar: la selección está vacía o una pista ha alcanzado su límite.');
      setStatusKind('error');
    }
    return count;
  }, [duplicateSelection, isExporting, isLoading, locale, reportClipboardAction]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target) || isLoading || isExporting) return;
      const key = event.key.toLowerCase();
      const hasCommandModifier = event.ctrlKey || event.metaKey;
      if (hasCommandModifier && !event.altKey && key === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (hasCommandModifier && !event.altKey && !event.shiftKey && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (hasCommandModifier && !event.altKey && !event.shiftKey) {
        const stateBeforeAction = useTimelineStore.getState();
        let affectedItems = 0;
        if (key === 'c') affectedItems = handleCopySelection();
        else if (key === 'v') affectedItems = handlePasteClipboard();
        else if (key === 'd') affectedItems = handleDuplicateSelection();
        else return;
        const internalActionWasAvailable = affectedItems > 0
          || (key === 'v' && stateBeforeAction.clipboardCount > 0)
          || (key === 'd' && Boolean(stateBeforeAction.selection || stateBeforeAction.rangeSelection));
        // Copiar sin objetos sigue disponible para el navegador. Pegar o
        // duplicar una selección interna sí se captura aunque una pista esté
        // llena, evitando que Ctrl/Cmd+D abra el marcador del navegador.
        if (internalActionWasAvailable) event.preventDefault();
        return;
      }
      // Ningún modificador puede caer en los atajos de una sola tecla: antes
      // Ctrl+S terminaba ejecutando "Dividir" además del atajo del navegador.
      if (hasCommandModifier || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlaying();
      } else if (key === 's') {
        event.preventDefault();
        splitVideoClipAtPlayhead();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelection();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentTime(currentTime - (event.shiftKey ? 1 : .1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentTime(currentTime + (event.shiftKey ? 1 : .1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentTime,
    handleCopySelection,
    handleDuplicateSelection,
    handlePasteClipboard,
    isExporting,
    isLoading,
    redo,
    removeSelection,
    setCurrentTime,
    splitVideoClipAtPlayhead,
    togglePlaying,
    undo
  ]);

  const persistProject = useCallback(async (
    includeRender?: RenderTimelineResponse,
    requestedProjectId = ''
  ): Promise<string> => {
    if (!timeline) throw new Error('No hay una línea de tiempo para guardar.');
    const editorState: SerializedTimeline = { ...serializeTimeline(timeline), mediaAssets: assets };
    const normalizedTitle = title.trim() || t('Proyecto sin título');
    // Se guarda siempre en R2/Cloudflare, generando el id de proyecto en el
    // primer guardado si el editor se abrió sin uno (p.ej. "Nuevo proyecto").
    const activeProjectId = requestedProjectId || target.storyboardId || projectId || crypto.randomUUID();
    if (target.localMode) {
      if (!target.storyboardId) throw new Error('Falta el identificador del storyboard local.');
      const response = await fetch(`${target.apiBase}/api/storyboards/${encodeURIComponent(activeProjectId)}/editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editorState, title: normalizedTitle })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.error || 'No se pudo guardar el timeline local.'));
    } else {
      if (!auth.user) throw new Error('Inicia sesión para guardar el proyecto.');
      await saveCloudProject(auth.user.uid, activeProjectId, {
      title: normalizedTitle,
      editorState,
      textOverlays: timeline.textTrack.clips,
      ...(includeRender ? {
        videoUrl: includeRender.videoUrl,
        videoStorageKey: includeRender.videoStorageKey,
        coverUrl: includeRender.coverUrl,
        coverStorageKey: includeRender.coverStorageKey,
        duration: includeRender.duration
      } : {})
      });
    }
    if (activeProjectId !== projectId) {
      setProjectId(activeProjectId);
      const params = new URLSearchParams(window.location.search);
      params.set('projectId', activeProjectId);
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    }
    // El usuario puede seguir editando durante una subida. Solo marcamos como
    // guardada cada parte que siga siendo exactamente la instantánea enviada;
    // una edición posterior debe conservar el aviso de cambios pendientes.
    const timelineUnchanged = useTimelineStore.getState().timeline === timeline;
    const assetsUnchanged = latestAssetsRef.current === assets;
    const titleUnchanged = latestTitleRef.current === title;
    if (timelineUnchanged) markSaved();
    if (assetsUnchanged) setAssetsDirty(false);
    if (titleUnchanged) {
      defaultTitleActiveRef.current = false;
      setTitle(normalizedTitle);
      setSavedTitle(normalizedTitle);
    }
    if (timelineUnchanged && assetsUnchanged && titleUnchanged) {
      localStorage.removeItem(localStateKey(editorState.sourceUrl));
    }
    return activeProjectId;
  }, [assets, auth.user, markSaved, projectId, target, timeline, title]);

  const applyCompletedRender = useCallback(async (
    result: RenderTimelineResponse,
    activeProjectId: string,
    resolution: string,
    requestIdentity: PendingTimelineRenderIdentity
  ): Promise<boolean> => {
    setExportResult(result);
    setExportSaved(false);
    try {
      await saveCloudProjectRender(activeProjectId, result);
      if (auth.user?.uid) clearPendingTimelineRender(auth.user.uid, activeProjectId, requestIdentity);
      setExportSaved(true);
      setStatus(`Exportación terminada · ${result.duration.toFixed(1)} s · ${resolution}`);
      setStatusKind('success');
      return true;
    } catch (reason) {
      if (isMissingCloudProjectError(reason)) {
        if (auth.user?.uid) clearPendingTimelineRender(auth.user.uid, activeProjectId, requestIdentity);
        setStatus('El vídeo se exportó, pero el proyecto fue eliminado antes de poder enlazar el resultado. Puedes descargarlo ahora.');
        setStatusKind('error');
        return true;
      }
      const detail = reason instanceof Error ? reason.message : 'Error desconocido';
      setStatus(`El vídeo se exportó, pero su proyecto todavía no se guardó en Cloudflare R2: ${detail}`);
      setStatusKind('error');
      return false;
    }
  }, [auth.user?.uid]);
  const applyCompletedRenderRef = useRef(applyCompletedRender);
  applyCompletedRenderRef.current = applyCompletedRender;
  const getAuthTokenRef = useRef(auth.getToken);
  getAuthTokenRef.current = auth.getToken;
  const timelineReady = Boolean(timeline);

  // Un render vive en el servidor, no en la pestaña. Si el navegador se
  // recarga o el equipo se apaga, retomamos exclusivamente el job asociado a
  // esta cuenta y a este proyecto. El registro no se elimina hasta confirmar
  // el manifiesto R2 o recibir un estado terminal inequívoco.
  useEffect(() => {
    const uid = auth.user?.uid || '';
    if (!uid || isLoading || !timelineReady || !projectId || renderControllerRef.current) return;
    const pending = readPendingTimelineRender(uid, projectId);
    if (!pending) return;
    const attemptKey = `${uid}:${projectId}:${pending.jobId || pending.clientRequestId}`;
    if (recoveryAttemptRef.current === attemptKey) return;
    recoveryAttemptRef.current = attemptKey;

    const controller = new AbortController();
    renderControllerRef.current = controller;
    activeRenderJobRef.current = pending.jobId;
    activeRenderProjectRef.current = projectId;
    setIsExporting(true);
    setExportResult(null);
    setExportSaved(false);
    setStatus('Reanudando la exportación pendiente…');
    setStatusKind('working');

    const retryLater = () => {
      if (recoveryRetryTimerRef.current != null) window.clearTimeout(recoveryRetryTimerRef.current);
      recoveryRetryTimerRef.current = window.setTimeout(() => {
        recoveryRetryTimerRef.current = null;
        recoveryAttemptRef.current = '';
        setRecoveryRetryTick((value) => value + 1);
      }, 30_000);
    };

    let recoveredJobId = pending.jobId;
    const recoverRender = async (): Promise<RenderTimelineResponse | null> => {
      if (!recoveredJobId) {
        const found = await lookupJobByClientRequestId(pending.clientRequestId, getAuthTokenRef.current, controller.signal);
        if (!found) {
          clearPendingTimelineRender(uid, projectId, { clientRequestId: pending.clientRequestId });
          setStatus('La solicitud anterior no llegó a crear una exportación. Ya puedes volver a exportar.');
          setStatusKind('neutral');
          return null;
        }
        recoveredJobId = found.jobId;
        activeRenderJobRef.current = recoveredJobId;
        writePendingTimelineRender({ ...pending, jobId: recoveredJobId, version: 2 });
      }
      return resumeTimelineRender(recoveredJobId, getAuthTokenRef.current, (progress, statusMessage) => {
        if (progress >= 0) setExportProgress(progress);
        setStatus(statusMessage || `Renderizando… ${progress}%`);
      }, controller.signal);
    };

    void recoverRender().then(async (result) => {
      if (controller.signal.aborted) return;
      if (!result) return;
      const handled = await applyCompletedRenderRef.current(
        result,
        projectId,
        pending.snapshot.resolution || 'exportación',
        { jobId: recoveredJobId, clientRequestId: pending.clientRequestId }
      );
      if (!handled && !controller.signal.aborted) retryLater();
    }).catch((reason) => {
      if (controller.signal.aborted) return;
      if (isTerminalTimelineRenderError(reason)) {
        clearPendingTimelineRender(uid, projectId, {
          jobId: recoveredJobId,
          clientRequestId: pending.clientRequestId
        });
        setStatus(reason instanceof Error ? reason.message : 'La exportación pendiente ya no está disponible.');
        setStatusKind('error');
        return;
      }
      setStatus(`${reason instanceof Error ? reason.message : 'No se pudo consultar la exportación.'} Se volverá a intentar automáticamente.`);
      setStatusKind('error');
      retryLater();
    }).finally(() => {
      if (renderControllerRef.current === controller) renderControllerRef.current = null;
      if (activeRenderJobRef.current === recoveredJobId) activeRenderJobRef.current = '';
      if (activeRenderProjectRef.current === projectId) activeRenderProjectRef.current = '';
      if (!controller.signal.aborted) setIsExporting(false);
    });

    return () => {
      controller.abort();
      if (renderControllerRef.current === controller) renderControllerRef.current = null;
      if (activeRenderJobRef.current === recoveredJobId) activeRenderJobRef.current = '';
      if (activeRenderProjectRef.current === projectId) activeRenderProjectRef.current = '';
      if (recoveryAttemptRef.current === attemptKey) recoveryAttemptRef.current = '';
      if (recoveryRetryTimerRef.current != null) {
        window.clearTimeout(recoveryRetryTimerRef.current);
        recoveryRetryTimerRef.current = null;
      }
      setIsExporting(false);
    };
  }, [auth.user?.uid, isLoading, projectId, recoveryRetryTick, timelineReady]);

  const handleSave = async () => {
    if (!timeline || isSaving || isExporting) return;
    setIsSaving(true);
    setStatus(target.localMode ? 'Guardando el timeline en la carpeta local…' : 'Guardando el proyecto en Cloudflare R2…');
    setStatusKind('working');
    try {
      await persistProject();
      setStatus(target.localMode ? 'Timeline guardado localmente.' : 'Proyecto guardado en Cloudflare R2.');
      setStatusKind('success');
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Error desconocido';
      setStatus(`${target.localMode ? 'No se pudo guardar localmente' : 'No se pudo guardar en Cloudflare R2'}: ${detail}`);
      setStatusKind('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadFiles = async (files: File[], options: { imageAsVideo?: boolean; insertFirstFile?: boolean } = {}) => {
    if (!auth.user || isUploading) return [];
    const uploaded: MediaAsset[] = [];
    setIsUploading(true);
    setStatus(`Subiendo ${files.length} archivo${files.length === 1 ? '' : 's'}…`);
    setStatusKind('working');
    try {
      const token = await auth.getToken();
      for (const rawFile of files.slice(0, 8)) {
        const file = await normalizeImageForUpload(resolveUploadFile(rawFile));
        const duration = await readMediaDuration(file);
        uploaded.push(mediaResponseToAsset(await uploadEditorMedia(file, token, duration, Boolean(options.imageAsVideo && file.type.startsWith('image/')))));
      }
      setAssets((current) => uniqueAssets([...uploaded, ...current]));
      setAssetsDirty(true);
      if (options.insertFirstFile && !timeline?.videoTrack.clips.length) {
        const initialVideo = uploaded.find((asset) => asset.type === 'video');
        const initialAudio = uploaded.find((asset) => asset.type === 'audio');
        if (initialVideo) await handleAddVideo(initialVideo);
        else if (initialAudio) handleUseAudio(initialAudio);
      }
      setStatus(`${uploaded.length} recurso${uploaded.length === 1 ? '' : 's'} añadido${uploaded.length === 1 ? '' : 's'} al proyecto.`);
      setStatusKind('success');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'No se pudo subir el archivo.');
      setStatusKind('error');
    } finally {
      setIsUploading(false);
    }
    return uploaded;
  };

  const handleAddVideo = async (asset: MediaAsset) => {
    if (!timeline || asset.type !== 'video') return;
    if (timeline.videoTrack.clips.length >= 12) {
      setStatus('La línea de tiempo admite un máximo de 12 clips.');
      setStatusKind('error');
      return;
    }
    setStatus('Preparando el vídeo importado…');
    setStatusKind('working');
    try {
      // Sin tope de 90s: ese límite es de la funcionalidad de Clipping, no del
      // editor de timeline general. Aplicarlo aquí truncaba cualquier vídeo
      // largo o medio al insertarlo como clip.
      const duration = Math.max(.5, asset.duration || 5);
      const clip: VideoClip = {
        id: `clip-${crypto.randomUUID()}`,
        sourceUrl: asset.url,
        ...(asset.storageKey ? { storageKey: asset.storageKey } : {}),
        sourceDuration: duration,
        thumbnails: [],
        sourceIn: 0,
        sourceOut: duration,
        startTime: timeline.duration,
        endTime: timeline.duration + duration,
        name: asset.name,
        transitionType: timeline.settings.transitionType,
        transitionDuration: timeline.settings.transitionDuration,
        ...DEFAULT_VIDEO_CLIP_CORRECTION
      };
      addVideoClip(clip);
      // buildTimeline (al reabrir un proyecto) siempre deriva
      // audioTrack.sourceUrl del vídeo base, pero addVideoClip no lo toca:
      // en una línea de tiempo vacía, el primer vídeo importado se quedaba
      // sin "Audio original" (ni forma de onda) hasta guardar y recargar,
      // momento en el que buildTimeline sí lo rellenaba. Aquí se iguala ese
      // comportamiento en el momento en que se añade, sin esperar a guardar.
      if (!timeline.audioTrack.sourceUrl) updateAudioTrack({ sourceUrl: asset.url });
      setActivePanel('enhance');
      // La generación de miniaturas puede tardar varios segundos en vídeos
      // largos. El clip entra de inmediato y la pista se completa al terminar.
      void fetchVideoThumbnails(asset.url, duration, auth.getToken, asset.storageKey)
        .then((thumbnails) => setSourceThumbnails(asset.url, thumbnails))
        .catch((error) => console.warn('No se pudieron preparar las miniaturas del vídeo.', error));
      setStatus('Vídeo añadido al final de la línea de tiempo.');
      setStatusKind('success');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'No se pudo preparar el vídeo.');
      setStatusKind('error');
    }
  };

  const handleAddImageClip = async (asset: MediaAsset) => {
    if (!timeline || asset.type !== 'image' || !auth.user) return;
    if (timeline.videoTrack.clips.length >= 12) {
      setStatus('La línea de tiempo admite un máximo de 12 clips.');
      setStatusKind('error');
      return;
    }
    setStatus('Convirtiendo la imagen en clip de vídeo…');
    setStatusKind('working');
    try {
      const token = await auth.getToken();
      const result = await convertImageAssetToVideo(asset.url, asset.name, token, 5, asset.storageKey);
      const videoAsset = mediaResponseToAsset(result);
      setAssets((current) => uniqueAssets([videoAsset, ...current]));
      setAssetsDirty(true);
      await handleAddVideo(videoAsset);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'No se pudo añadir la imagen a la línea de tiempo.');
      setStatusKind('error');
    }
  };

  const handleImportFiles = async (files: File[]) => {
    await handleUploadFiles(files, { imageAsVideo: true, insertFirstFile: true });
  };

  const handleUseAudio = (asset: MediaAsset) => {
    updateAudioTrack({
      mode: 'replace',
      externalName: asset.name,
      externalUrl: asset.url,
      externalStorageKey: asset.storageKey
    });
    setActivePanel('audio');
  };

  const handleUseLogo = (asset: MediaAsset) => {
    updateSettings({
      brandLogoUrl: asset.url,
      brandLogoStorageKey: asset.storageKey,
      brandLogoName: asset.name
    });
    setActivePanel('brand');
  };

  const handleAddBroll = (asset: MediaAsset) => {
    if (!timeline || asset.type !== 'image') return;
    const startTime = Math.min(currentTime, Math.max(0, timeline.duration - .2));
    addBrollClip({
      id: `broll-${crypto.randomUUID()}`,
      sourceUrl: asset.url,
      ...(asset.storageKey ? { storageKey: asset.storageKey } : {}),
      name: asset.name,
      startTime,
      endTime: Math.min(timeline.duration, startTime + 3),
      opacity: 1,
      x: 0.5,
      y: 0.5,
      width: 0.72,
      height: 0.56,
      blendMode: 'normal'
    });
    setActivePanel('broll');
  };

  const handleAddGraphic = (graphic: GraphicInsert) => {
    if (!timeline) return;
    const startTime = Math.min(currentTime, Math.max(0, timeline.duration - .2));
    addBrollClip({ id: `graphic-${crypto.randomUUID()}`, sourceUrl: graphic.url, name: graphic.name, startTime, endTime: Math.min(timeline.duration, startTime + 3), opacity: 1, x: .5, y: .5, width: graphic.width || .62, height: graphic.height || .48, blendMode: 'normal' });
    setStatus(`${graphic.name} añadido en ${startTime.toFixed(1)} s.`);
  };

  // Función 2 — Plantillas de motion graphics: convierte la plantilla +
  // valores elegidos por el usuario en clips reales (buildTemplateInsertion,
  // puro y testeado aparte) y los añade al store como un grupo, uno por
  // elemento de la plantilla, en el cabezal actual.
  const handleInsertTemplate: TemplatesPanelProps['onInsertTemplate'] = (template, values, durationMs) => {
    if (!timeline) return;
    const startTime = Math.min(currentTime, Math.max(0, timeline.duration - .2));
    const { textClips, brollClips } = buildTemplateInsertion(template, values, startTime, durationMs);
    textClips.forEach((clip) => addTextClip(clip));
    brollClips.forEach((clip) => addBrollClip(clip));
    setStatus(`Plantilla «${template.name}» añadida en ${startTime.toFixed(1)} s.`);
    setActivePanel('text');
  };

  // Función 5 — Tracking automático de texto/sticker: analiza el vídeo bajo
  // la posición ACTUAL del elemento (texto o B-Roll) — el usuario lo coloca
  // a mano sobre el sujeto antes de pulsar, igual que ya hace para editar su
  // posición estática — y sustituye sus keyframes por la trayectoria
  // detectada. El instante de análisis se ancla al `startTime` del propio
  // clip, así que los `timeMs` que devuelve el servidor (relativos a ese
  // instante) ya son directamente los keyframes en la convención de la
  // Función 1 (relativos al inicio del clip), sin conversión.
  const handleTrackRegion = async (clipKind: 'text' | 'broll', clipId: string, durationSec: number) => {
    if (!timeline) return;
    const clip = clipKind === 'text'
      ? timeline.textTrack.clips.find((item) => item.id === clipId)
      : timeline.brollTrack.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const activeVideoClip = clipAtProjectTime(timeline, clip.startTime);
    if (!activeVideoClip) throw new Error('No hay ningún clip de vídeo en ese instante para analizar.');
    const sourceIn = sourceTimeAtProjectTime(timeline, clip.startTime);
    const sourceOut = Math.min(activeVideoClip.sourceOut, sourceIn + durationSec);
    const region = clipKind === 'broll'
      ? { x: clip.x, y: clip.y, width: clip.width, height: (clip as { height: number }).height }
      // Un TextClip no guarda una altura explícita (depende del tamaño de
      // fuente); se aproxima con una caja pequeña centrada en su posición.
      : { x: clip.x, y: clip.y, width: clip.width, height: 0.1 };
    const points = await trackRegion({
      sourceUrl: activeVideoClip.sourceUrl,
      storageKey: activeVideoClip.storageKey || mediaStorageKeyForUrl(activeVideoClip.sourceUrl, 'video') || undefined,
      sourceIn,
      sourceOut,
      regionX: region.x,
      regionY: region.y,
      regionWidth: region.width,
      regionHeight: region.height
    }, async () => auth.user ? auth.user.getIdToken() : '');
    const baseScale = clipKind === 'text' ? (clip as { scale: number }).scale : 1;
    const keyframes = points.map((point) => ({
      id: createKeyframeId(),
      timeMs: point.timeMs,
      x: point.x,
      y: point.y,
      scale: baseScale,
      opacity: 1,
      rotation: 0,
      easing: 'linear' as const
    }));
    if (clipKind === 'text') updateTextClip(clipId, { keyframes });
    else updateBrollClip(clipId, { keyframes });
    setStatus(`Seguimiento aplicado: ${keyframes.length} puntos detectados. Corrígelo a mano si hace falta.`);
  };

  // RacingMonos: se guarda el montaje y FFmpeg lo renderiza en la app Next.js
  // local (vídeo 1080p, imágenes, subtítulos quemados, narración y música).
  const localRenderJobRef = useRef('');
  const handleLocalExport = async () => {
    if (!timeline) return;
    if (!timeline.duration || (!timeline.brollTrack.clips.length && !timeline.videoTrack.clips.length)) {
      setStatus('Añade imágenes o vídeo al timeline antes de exportar.');
      setStatusKind('error');
      return;
    }
    const controller = new AbortController();
    renderControllerRef.current = controller;
    setIsExporting(true);
    setExportResult(null);
    setExportSaved(false);
    setExportProgress(0);
    setStatus('Guardando el montaje antes de exportar…');
    setStatusKind('working');
    try {
      await persistProject();
      await waitForEditorFonts();
      const payload = buildLocalRenderPayload(timeline, target.storyboardId, title.trim() || 'RacingMonos');
      const result = await runLocalRender(target.apiBase, payload, (progress, message) => {
        setExportProgress(progress);
        setStatus(message);
      }, (jobId) => { localRenderJobRef.current = jobId; }, controller.signal);
      setExportResult({ videoUrl: result.videoUrl!, duration: result.duration });
      setExportSaved(true);
      setStatus(`Exportación terminada · ${result.duration.toFixed(1)} s · 1080p`);
      setStatusKind('success');
    } catch (reason) {
      if (controller.signal.aborted) {
        setStatus('Exportación cancelada.');
        setStatusKind('neutral');
        return;
      }
      setStatus(reason instanceof Error ? reason.message : 'No se pudo exportar el vídeo.');
      setStatusKind('error');
    } finally {
      localRenderJobRef.current = '';
      if (renderControllerRef.current === controller) renderControllerRef.current = null;
      setIsExporting(false);
    }
  };

  const handleExport = async () => {
    if (!timeline || isExporting || isSaving || renderControllerRef.current) return;
    if (target.localMode) {
      await handleLocalExport();
      return;
    }
    if (auth.user && projectId && readPendingTimelineRender(auth.user.uid, projectId)) {
      if (recoveryRetryTimerRef.current != null) {
        window.clearTimeout(recoveryRetryTimerRef.current);
        recoveryRetryTimerRef.current = null;
      }
      recoveryAttemptRef.current = '';
      setStatus('Ya hay una exportación pendiente. Reanudándola…');
      setStatusKind('working');
      setRecoveryRetryTick((value) => value + 1);
      return;
    }
    if (!timeline.videoTrack.clips.length) {
      setStatus('Añade un vídeo antes de exportar.');
      setStatusKind('error');
      setActivePanel('enhance');
      return;
    }
    if (timeline.audioTrack.mode === 'replace' && !timeline.audioTrack.externalUrl) {
      setStatus('Selecciona el archivo de audio que quieres usar antes de exportar.');
      setStatusKind('error');
      setActivePanel('audio');
      return;
    }
    setIsExporting(true);
    setExportResult(null);
    setExportSaved(false);
    setExportProgress(0);
    setStatus('Guardando el proyecto antes de exportar…');
    setStatusKind('working');
    const activeProjectId = projectId || crypto.randomUUID();
    const controller = new AbortController();
    renderControllerRef.current = controller;
    activeRenderProjectRef.current = activeProjectId;
    const clientRequestId = crypto.randomUUID();
    const pendingCreatedAt = Date.now();
    const pendingSnapshot = {
      title: (title.trim() || 'Proyecto sin título').slice(0, 120),
      resolution: timeline.settings.resolution,
      aspectRatio: timeline.settings.aspectRatio
    };
    try {
      // La instantánea editable queda primero en R2. En paralelo preparamos
      // solo las fuentes que el canvas necesita para rótulos libres; los
      // subtítulos se renderizan en el servidor y no requieren esta espera.
      const [saveResult, fontResult] = await Promise.allSettled([
        persistProject(undefined, activeProjectId),
        waitForEditorFonts(timeline.textTrack.clips.filter((clip) => clip.kind === 'text'))
      ]);
      if (controller.signal.aborted) {
        setStatus('Exportación cancelada.');
        setStatusKind('neutral');
        return;
      }
      if (saveResult.status === 'rejected') throw saveResult.reason;
      if (fontResult.status === 'rejected') throw fontResult.reason;
      // Se registra la clave antes del POST. Si se pierde exactamente la
      // respuesta 202, el reenvío usa la misma identidad y recupera el job.
      writePendingTimelineRender({
        version: 2,
        uid: auth.user!.uid,
        projectId: activeProjectId,
        jobId: '',
        clientRequestId,
        createdAt: pendingCreatedAt,
        snapshot: pendingSnapshot
      });
      setStatus('Renderizando… 0%');
      const result = await submitTimelineRender({
        clientRequestId,
        source: timeline.videoTrack.clips[0].sourceUrl,
        sourceStorageKey: timeline.videoTrack.clips[0].storageKey
          || mediaStorageKeyForUrl(timeline.videoTrack.clips[0].sourceUrl, 'video')
          || undefined,
        clips: timeline.videoTrack.clips.map((clip) => ({
          source: clip.sourceUrl,
          storageKey: clip.storageKey || mediaStorageKeyForUrl(clip.sourceUrl, 'video') || undefined,
          start: clip.sourceIn,
          end: clip.sourceOut,
          brightness: clip.brightness,
          contrast: clip.contrast,
          saturation: clip.saturation,
          sharpen: clip.sharpen,
          temperature: clip.temperature,
          focusX: clip.focusX,
          focusY: clip.focusY
        })),
        transitions: timeline.videoTrack.clips.slice(0, -1).map((clip) => ({
          type: clip.transitionType,
          duration: clip.transitionDuration
        })),
        music: timeline.audioTrack.mode,
        audioUrl: timeline.audioTrack.externalUrl || undefined,
        audioStorageKey: timeline.audioTrack.externalStorageKey
          || mediaStorageKeyForUrl(timeline.audioTrack.externalUrl, 'audio')
          || undefined,
        audioVolume: timeline.audioTrack.volume,
        audioCleanup: timeline.audioTrack.cleanup,
        // Función 6 — Editor de audio por capas: pista de música
        // independiente de la voz (el campo `music` de arriba es, pese al
        // nombre, el modo de la pista de VOZ — se deja como está para no
        // tocar un contrato ya usado en producción).
        ...(timeline.musicTrack ? {
          backgroundMusic: {
            sourceUrl: timeline.musicTrack.sourceUrl,
            storageKey: timeline.musicTrack.storageKey || mediaStorageKeyForUrl(timeline.musicTrack.sourceUrl, 'audio') || undefined,
            start: timeline.musicTrack.startTime,
            end: timeline.musicTrack.endTime,
            volume: timeline.musicTrack.volume,
            fadeInMs: timeline.musicTrack.fadeInMs,
            fadeOutMs: timeline.musicTrack.fadeOutMs,
            duckingEnabled: timeline.musicTrack.duckingEnabled,
            duckingAmount: timeline.musicTrack.duckingAmount,
            duckingRegions: timeline.musicTrack.duckingRegions.map((region) => ({ start: region.startTime, end: region.endTime }))
          }
        } : {}),
        aspectRatio: timeline.settings.aspectRatio,
        fitMode: timeline.settings.fitMode,
        layoutPreset: timeline.settings.layoutPreset,
        framePreset: timeline.settings.framePreset,
        focusX: timeline.settings.focusX,
        focusY: timeline.settings.focusY,
        roi: timeline.roi,
        transitionType: timeline.settings.transitionType,
        transitionDuration: timeline.settings.transitionDuration,
        startTransitionType: timeline.settings.startTransitionType,
        startTransitionDuration: timeline.settings.startTransitionDuration,
        endTransitionType: timeline.settings.endTransitionType,
        endTransitionDuration: timeline.settings.endTransitionDuration,
        brightness: timeline.settings.brightness,
        contrast: timeline.settings.contrast,
        saturation: timeline.settings.saturation,
        sharpen: timeline.settings.sharpen,
        temperature: timeline.settings.temperature,
        brandLogoUrl: timeline.settings.brandLogoUrl || undefined,
        brandLogoStorageKey: timeline.settings.brandLogoStorageKey
          || mediaStorageKeyForUrl(timeline.settings.brandLogoUrl, 'image')
          || undefined,
        brandLogoPosition: timeline.settings.brandLogoPosition,
        brandLogoScale: timeline.settings.brandLogoScale,
        broll: timeline.brollTrack.clips.map((clip) => ({
          sourceUrl: clip.sourceUrl,
          storageKey: clip.storageKey || mediaStorageKeyForUrl(clip.sourceUrl, 'image') || undefined,
          start: clip.startTime,
          end: clip.endTime,
          opacity: clip.opacity,
          x: clip.x,
          y: clip.y,
          width: clip.width,
          height: clip.height,
          // Función 1 — Keyframes: timeMs de cada keyframe es relativo al
          // inicio del propio clip (0 = clip.startTime), no al timeline.
          ...(clip.keyframes && clip.keyframes.length >= 2 ? { keyframes: clip.keyframes } : {})
        })),
        resolution: timeline.settings.resolution,
        ...(timeline.settings.coverTime == null ? {} : {
          coverTime: timeline.settings.coverTime,
          coverTitle: timeline.settings.coverTitle,
          coverTitlePosition: timeline.settings.coverTitlePosition,
          coverTitleColor: timeline.settings.coverTitleColor
        }),
        textOverlays: timeline.textTrack.clips.filter((clip) => clip.kind === 'text').map((clip) => {
          const exportKeyframes = resolveTextAnimationExportKeyframes(clip);
          const isAnimated = Boolean(exportKeyframes && exportKeyframes.length >= 2);
          return {
            text: clip.text,
            start: clip.startTime,
            end: clip.endTime,
            style: clip.style,
            font: clip.font,
            position: clip.position,
            size: clip.size,
            color: clip.color,
            x: clip.x,
            y: clip.y,
            width: clip.width,
            scale: clip.scale,
            preset: clip.preset,
            // El PNG conserva la escala estática del clip para que activar un
            // preset no cambie la tipografía ni el wrapping. Los keyframes de
            // export usan una escala relativa a esta capa base; timeMs sigue
            // siendo relativo al inicio de la propia frase.
            ...rasterizeTextOverlay(
              clip,
              timeline.settings.resolution,
              timeline.settings.aspectRatio
            ),
            ...(isAnimated ? { keyframes: exportKeyframes } : {})
          };
        }),
        subtitleClips: timeline.textTrack.clips.filter((clip) => clip.kind === 'subtitle').map((clip) => ({
          text: clip.text,
          start: clip.startTime,
          end: clip.endTime,
          style: clip.style,
          position: clip.position,
          size: clip.size,
          color: clip.color,
          font: clip.font,
          preset: clip.preset,
          wordEffect: clip.wordEffect,
          placement: {
            x: clip.x,
            y: clip.y,
            width: clip.width,
            scale: clip.scale
          }
        }))
      }, auth.getToken, (progress, statusMessage) => {
        // progress < 0 señala un reintento de red: se mantiene la última barra
        // conocida en vez de hacerla saltar a 0 y parecer que se reinició.
        if (progress >= 0) setExportProgress(progress);
        setStatus(statusMessage || `Renderizando… ${progress}%`);
      }, (jobId) => {
        activeRenderJobRef.current = jobId;
        writePendingTimelineRender({
          version: 2,
          uid: auth.user!.uid,
          projectId: activeProjectId,
          jobId,
          clientRequestId,
          createdAt: pendingCreatedAt,
          snapshot: pendingSnapshot
        });
      }, controller.signal);
      if (!controller.signal.aborted) {
        await applyCompletedRender(result, activeProjectId, timeline.settings.resolution, {
          jobId: activeRenderJobRef.current,
          clientRequestId
        });
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (isTerminalTimelineRenderError(reason)) {
        clearPendingTimelineRender(auth.user!.uid, activeProjectId, {
          jobId: activeRenderJobRef.current,
          clientRequestId
        });
      } else if (readPendingTimelineRender(auth.user!.uid, activeProjectId)) {
        if (recoveryRetryTimerRef.current != null) window.clearTimeout(recoveryRetryTimerRef.current);
        recoveryRetryTimerRef.current = window.setTimeout(() => {
          recoveryRetryTimerRef.current = null;
          recoveryAttemptRef.current = '';
          setRecoveryRetryTick((value) => value + 1);
        }, 30_000);
      }
      setStatus(reason instanceof Error ? reason.message : 'No se pudo exportar el vídeo.');
      setStatusKind('error');
    } finally {
      if (renderControllerRef.current === controller) {
        renderControllerRef.current = null;
        activeRenderJobRef.current = '';
        activeRenderProjectRef.current = '';
        setIsExporting(false);
      }
    }
  };

  const handleCancelExport = async () => {
    if (target.localMode) {
      const jobId = localRenderJobRef.current;
      renderControllerRef.current?.abort();
      if (jobId) await cancelLocalRender(target.apiBase, jobId);
      return;
    }
    if (!auth.user || isCancellingExport) return;
    const activeProjectId = activeRenderProjectRef.current || projectId;
    const pending = activeProjectId ? readPendingTimelineRender(auth.user.uid, activeProjectId) : null;
    const jobId = activeRenderJobRef.current || pending?.jobId || '';
    const clientRequestId = pending?.clientRequestId || '';
    const controller = renderControllerRef.current;

    // Todavía se estaba guardando la instantánea previa y el servidor no ha
    // creado ningún job: abortar localmente es una cancelación completa.
    if (!jobId && !clientRequestId) {
      controller?.abort();
      // La subida del manifiesto no se puede abortar sin dejar una escritura
      // huérfana. Mantenemos bloqueados otro guardado u otra exportación hasta
      // que esa promesa termine; handleExport cerrará entonces sin crear job.
      setStatus('Cancelando la exportación cuando termine el guardado en curso…');
      setStatusKind('working');
      return;
    }

    // El sondeo/POST local se detiene antes de esperar la confirmación remota.
    // Si el DELETE falla, el puntero permanece y se inicia una recuperación nueva.
    controller?.abort();
    if (renderControllerRef.current === controller) renderControllerRef.current = null;
    activeRenderJobRef.current = '';
    activeRenderProjectRef.current = '';
    if (recoveryRetryTimerRef.current != null) {
      window.clearTimeout(recoveryRetryTimerRef.current);
      recoveryRetryTimerRef.current = null;
    }
    setIsCancellingExport(true);
    setStatus('Cancelando la exportación…');
    setStatusKind('working');
    try {
      if (jobId) await cancelTimelineRender(jobId, auth.getToken);
      else await cancelTimelineRenderByClientRequestId(clientRequestId, auth.getToken);
      if (activeProjectId) {
        clearPendingTimelineRender(auth.user.uid, activeProjectId, { jobId, clientRequestId });
      }
      setIsExporting(false);
      setStatus('Exportación cancelada.');
      setStatusKind('neutral');
    } catch (reason) {
      if (isTerminalTimelineRenderError(reason)) {
        if (activeProjectId) {
          clearPendingTimelineRender(auth.user.uid, activeProjectId, { jobId, clientRequestId });
        }
        setIsExporting(false);
      } else {
        recoveryAttemptRef.current = '';
        setIsExporting(false);
        recoveryRetryTimerRef.current = window.setTimeout(() => {
          recoveryRetryTimerRef.current = null;
          setRecoveryRetryTick((value) => value + 1);
        }, 3000);
      }
      setStatus(reason instanceof Error ? reason.message : 'No se pudo cancelar la exportación.');
      setStatusKind('error');
    } finally {
      setIsCancellingExport(false);
    }
  };

  if (auth.loading && !target.localMode) return <div className="app app--loading">Comprobando la sesión…</div>;
  if (!auth.user && !target.localMode) return <AuthRedirect />;

  const externalAudioUrl = timeline?.audioTrack.mode === 'replace' ? timeline.audioTrack.externalUrl : '';

  return (
    <div
      ref={appRef}
      className={`app${timelineVisible ? '' : ' app--timeline-hidden'}${target.returnToClippingProject ? ' app--clipping-editor' : ''}${transcriptResizeEnabled ? '' : ' app--transcript-resize-disabled'}${timelineResizeEnabled ? '' : ' app--timeline-resize-disabled'}`}
      style={appLayoutStyle}
    >
      <header className="app__header">
        <a className="app__back" href={returnHref} aria-label={returnLabel} title={returnLabel}><ArrowLeft size={17} /></a>
        <label className="app__title"><input data-i18n-skip="" value={title} maxLength={120} onChange={(event) => { defaultTitleActiveRef.current = false; setTitle(event.target.value); }} aria-label={t('Nombre del proyecto')} /></label>
        <div className="app__history">
          <button type="button" onClick={undo} disabled={!history.length} title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><Undo2 size={16} /></button>
          <button type="button" onClick={redo} disabled={!future.length} title="Rehacer (Ctrl+Y)" aria-label="Rehacer"><Redo2 size={16} /></button>
        </div>
        <div className="app__actions">
          <span className={`app__save-state${hasUnsavedChanges ? ' is-dirty' : ''}`}>{hasUnsavedChanges ? 'Cambios sin guardar' : <><Check size={13} /> Guardado</>}</span>
          <button type="button" onClick={handleSave} disabled={!timeline || isSaving || isExporting || !hasUnsavedChanges}><Save size={15} /><span>{isSaving ? 'Guardando…' : 'Guardar cambios'}</span></button>
          <button
            type="button"
            className="app__export"
            onClick={isExporting ? handleCancelExport : handleExport}
            disabled={!timeline || isCancellingExport || (!isExporting && isSaving)}
          >
            {isExporting ? <X size={15} /> : <Download size={15} />}
            <span>{isCancellingExport ? 'Cancelando…' : isExporting ? 'Cancelar exportación' : 'Exportar'}</span>
          </button>
          <a className="app__brand-mark" href={returnHref} title={returnLabel}><img src="/assets/vidreum-logo.avif" alt="" /></a>
        </div>
      </header>

      <div className={`app__status app__status--${statusKind}`} role="status">
        {statusKind === 'working' && <span className="app__status-spinner" />}
        <span>{status}</span>
        {isExporting && <span className="app__render-progress" style={{ width: `${Math.max(2, exportProgress)}%` }} />}
      </div>

      <main id="timeline-editor-workspace" className={`app__workspace${activePanel ? '' : ' app__workspace--panel-collapsed'}`}>
        <div id="timeline-editor-transcript" className="app__transcript-column">
          {target.returnToClippingProject ? (
          <ClippingTranscriptPanel
            transcriptWords={clippingPanelWords}
            subtitleCues={clippingPanelCues}
            plainTranscript={clippingPanelPlainText}
            isLoadingTranscript={recoveredClippingTranscript.loading}
          />
        ) : showOwnTranscript ? (
          <div className="app__transcript-tabs">
            <button type="button" onClick={() => setShowOwnTranscript(false)}>← Volver a las frases</button>
            <ClippingTranscriptPanel
              transcriptWords={ownTranscriptWords}
              subtitleCues={[]}
              isLoadingTranscript={isTranscribing}
            />
          </div>
        ) : (
          <TranscriptPanel
            onAddText={addTextOverlay}
            onAddSubtitle={addSubtitle}
            onTranscribe={handleTranscribe}
            isTranscribing={isTranscribing}
            hasTranscript={Boolean(ownTranscriptWords.length)}
            onShowTranscript={() => setShowOwnTranscript(true)}
          />
          )}
        </div>
        <EditorResizeHandle
          axis="vertical"
          value={transcriptWidth}
          bounds={transcriptBounds}
          label={t('Redimensionar panel de textos y subtítulos')}
          instructions={t('Arrastra o usa las flechas. Doble clic para restablecer.')}
          controls="timeline-editor-transcript timeline-editor-canvas"
          cssVariable="--transcript-panel-width"
          onChange={(value) => setEditorLayout((current) => ({ ...current, transcriptWidth: value }))}
          onReset={() => setEditorLayout((current) => ({
            ...current,
            transcriptWidth: clampResizeValue(defaultTranscriptWidth(editorSize.width), transcriptBounds)
          }))}
        />
        <section id="timeline-editor-canvas" className="app__canvas-area">
          <CanvasToolbar />
          <div className="app__stage">
            {isLoading ? (
              <div className="app__stage-loading"><span /><strong>Preparando el editor</strong><p>Extrayendo fotogramas del vídeo</p></div>
            ) : timeline ? (
              <VideoPreview externalAudioUrl={externalAudioUrl} onImportFiles={handleImportFiles} rectangleSelectionActive={rectangleSelectionActive} />
            ) : (
              <div className="app__stage-error"><FileText size={28} /><strong>No se pudo abrir el proyecto</strong><p>{status}</p><a href={returnHref}>{target.returnToClippingProject ? 'Volver a los clips generados' : 'Volver al menú principal'}</a></div>
            )}
          </div>
        </section>
        {activePanel && (
          <PropertiesPanel
            panel={activePanel}
            selectedTransitionClipId={selectedTransitionClipId}
            assets={assets}
            isUploading={isUploading}
            hasExternalAudio={Boolean(externalAudioUrl)}
            onUploadFiles={(files) => handleUploadFiles(files, {
              imageAsVideo: !timeline?.videoTrack.clips.length,
              insertFirstFile: !timeline?.videoTrack.clips.length
            })}
            onAddVideo={handleAddVideo}
            onAddImageClip={handleAddImageClip}
            onUseAudio={handleUseAudio}
            onUseLogo={handleUseLogo}
            onAddBroll={handleAddBroll}
            onAddGraphic={handleAddGraphic}
            onInsertTemplate={handleInsertTemplate}
            onTrackRegion={handleTrackRegion}
            getAuthToken={async () => auth.user ? auth.user.getIdToken() : ''}
            onAddText={addTextOverlay}
            onAddSubtitle={addSubtitle}
            onAutoCaption={handleAutoCaption}
            isTranscribing={isTranscribing}
            onClearTransitionSelection={() => setSelectedTransitionClipId(null)}
          />
        )}
        <EditorToolRail active={activePanel} onChange={(panel) => {
          setActivePanel((current) => (current === panel ? null : panel));
          if (panel === 'transitions') setSelectedTransitionClipId(null);
          else if (panel === 'opening') setSelectedTransitionClipId('__timeline-start__');
          else if (panel === 'closing') setSelectedTransitionClipId('__timeline-end__');
        }} />
      </main>

      {timelineVisible && (
        <EditorResizeHandle
          axis="horizontal"
          reverse
          value={timelineHeight}
          bounds={timelineBounds}
          label={t('Redimensionar línea de tiempo')}
          instructions={t('Arrastra o usa las flechas. Doble clic para restablecer.')}
          controls="timeline-editor-workspace timeline-editor-timeline"
          cssVariable="--timeline-height"
          onChange={(value) => setEditorLayout((current) => ({ ...current, timelineHeight: value }))}
          onReset={() => setEditorLayout((current) => ({ ...current, timelineHeight: DEFAULT_TIMELINE_HEIGHT }))}
        />
      )}

      {timelineVisible ? (
        <Timeline
          clipboardCount={clipboardCount}
          clipboardActionsDisabled={isLoading || isExporting}
          externalAudioUrl={externalAudioUrl}
          onCopySelection={handleCopySelection}
          onPasteClipboard={handlePasteClipboard}
          onDuplicateSelection={handleDuplicateSelection}
          selectedTransitionClipId={activePanel === 'transitions' || activePanel === 'opening' || activePanel === 'closing' ? selectedTransitionClipId : null}
          onEditTransition={(clipId) => {
            setSelectedTransitionClipId(clipId);
            setActivePanel(clipId === '__timeline-start__' ? 'opening' : clipId === '__timeline-end__' ? 'closing' : 'transitions');
            selectClip(null);
          }}
          onHide={() => setTimelineVisible(false)}
        />
      ) : (
        <button type="button" className="timeline-reveal" onClick={() => setTimelineVisible(true)}><Eye size={15} /> Mostrar línea de tiempo</button>
      )}

      {exportResult && (
        <div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="exportTitle">
          <button className="export-dialog__backdrop" type="button" onClick={() => setExportResult(null)} aria-label="Cerrar" />
          <section className="export-dialog__panel">
            <button className="export-dialog__close" type="button" onClick={() => setExportResult(null)} aria-label="Cerrar"><X size={18} /></button>
            <span className="export-dialog__success"><Check size={19} /></span>
            <h2 id="exportTitle">Vídeo exportado</h2>
            <p>{target.localMode ? `Guardado en data/storyboards/${target.storyboardId}/ y listo para descargar.` : exportSaved ? 'El archivo se guardó en tu proyecto de Cloudflare R2 y ya está listo para descargar.' : 'El archivo está listo para descargar, aunque todavía no se pudo actualizar el proyecto en Cloudflare R2.'}</p>
            <video src={exportResult.videoUrl} controls playsInline preload="metadata" />
            <a
              className="export-dialog__download"
              href={exportResult.videoDownloadUrl || (exportResult.videoUrl.includes('?')
                ? exportResult.videoUrl
                : `${exportResult.videoUrl}?download=${encodeURIComponent(`${title || 'vidreum-video'}.mp4`)}`)}
              download
            ><Download size={17} /> Descargar MP4</a>
          </section>
        </div>
      )}
    </div>
  );
}

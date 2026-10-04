import type { Timeline, TimelineRangeSelection } from '../types/timeline';
import { getTimelineRangeTargets, type TimelineRangeTargets } from './timeline';

const EPSILON = 0.000_001;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export interface TimelineRangeMovePlan {
  targets: TimelineRangeTargets;
  /** Continuous, boundary-safe displacement used while following the pointer. */
  previewDeltaSeconds: number;
  /**
   * The single displacement that must be applied to every linked object.
   * When video clips are part of the selection, this is snapped to a valid
   * cut in the sequential video track.
   */
  deltaSeconds: number;
  /** Index at which the selected video block is inserted after removing it. */
  videoInsertionIndex: number | null;
}

interface VideoInsertionCandidate {
  deltaSeconds: number;
  insertionIndex: number;
}

/**
 * Plans one linked range move without mutating the timeline.
 *
 * Text and B-roll can move continuously. Video clips cannot leave a gap in
 * the primary track, so a selected contiguous video block snaps to one of the
 * cuts that remains after taking that block out. The returned delta is the
 * effective displacement of that video block and is intentionally shared by
 * every selected overlay and by the range itself.
 */
export function planTimelineRangeMove(
  timeline: Timeline,
  rangeSelection: TimelineRangeSelection,
  requestedDeltaSeconds: number
): TimelineRangeMovePlan | null {
  const targets = getTimelineRangeTargets(timeline, rangeSelection);
  const videoIds = new Set(targets.videoIds);
  const textIds = new Set(targets.textIds);
  const brollIds = new Set(targets.brollIds);
  const selectedVideos = timeline.videoTrack.clips.filter((clip) => videoIds.has(clip.id));
  const selectedText = timeline.textTrack.clips.filter((clip) => textIds.has(clip.id));
  const selectedBroll = timeline.brollTrack.clips.filter((clip) => brollIds.has(clip.id));

  if (!selectedVideos.length && !selectedText.length && !selectedBroll.length) return null;

  const selectedVideoIndexes = selectedVideos.map((clip) => (
    timeline.videoTrack.clips.findIndex((candidate) => candidate.id === clip.id)
  ));
  const videosAreContiguous = selectedVideoIndexes.every((index, position) => (
    position === 0 || index === selectedVideoIndexes[position - 1] + 1
  ));

  // A time-range over a sequential video track normally yields one contiguous
  // block. Refuse an invalid/disconnected block instead of previewing a move
  // that the timeline reflow cannot commit as a linked operation.
  if (selectedVideos.length && !videosAreContiguous) return null;

  const movableClips = [...selectedVideos, ...selectedText, ...selectedBroll];
  const lowerBounds = [
    -rangeSelection.startTime,
    ...movableClips.map((clip) => -clip.startTime)
  ];
  const upperBounds = [
    timeline.duration - rangeSelection.endTime,
    ...movableClips.map((clip) => timeline.duration - clip.endTime)
  ];
  const minimumDelta = Math.max(...lowerBounds);
  const maximumDelta = Math.min(...upperBounds);

  if (minimumDelta > maximumDelta + EPSILON) return null;

  const finiteRequest = Number.isFinite(requestedDeltaSeconds) ? requestedDeltaSeconds : 0;
  const desiredDelta = clamp(finiteRequest, minimumDelta, maximumDelta);

  if (!selectedVideos.length) {
    return {
      targets,
      previewDeltaSeconds: desiredDelta,
      deltaSeconds: desiredDelta,
      videoInsertionIndex: null
    };
  }

  const firstSelectedVideo = selectedVideos[0];
  const remainingVideos = timeline.videoTrack.clips.filter((clip) => !videoIds.has(clip.id));
  const candidates: VideoInsertionCandidate[] = [];
  let cutTime = 0;

  for (let insertionIndex = 0; insertionIndex <= remainingVideos.length; insertionIndex += 1) {
    const deltaSeconds = cutTime - firstSelectedVideo.startTime;
    if (deltaSeconds >= minimumDelta - EPSILON && deltaSeconds <= maximumDelta + EPSILON) {
      candidates.push({ deltaSeconds, insertionIndex });
    }
    const nextClip = remainingVideos[insertionIndex];
    if (nextClip) cutTime += Math.max(0, nextClip.endTime - nextClip.startTime);
  }

  if (!candidates.length) return null;

  const direction = Math.sign(desiredDelta);
  const selectedCandidate = candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(best.deltaSeconds - desiredDelta);
    const candidateDistance = Math.abs(candidate.deltaSeconds - desiredDelta);
    if (candidateDistance < bestDistance - EPSILON) return candidate;
    if (Math.abs(candidateDistance - bestDistance) > EPSILON) return best;
    if (direction > 0 && candidate.deltaSeconds > best.deltaSeconds) return candidate;
    if (direction < 0 && candidate.deltaSeconds < best.deltaSeconds) return candidate;
    return best;
  });

  return {
    targets,
    previewDeltaSeconds: desiredDelta,
    deltaSeconds: selectedCandidate.deltaSeconds,
    videoInsertionIndex: selectedCandidate.insertionIndex
  };
}

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { resizeFromKeyboard, resizeFromPointer, type EditorResizeAxis, type ResizeBounds } from '../utils/editorLayout';

interface EditorResizeHandleProps {
  axis: EditorResizeAxis;
  value: number;
  bounds: ResizeBounds;
  label: string;
  instructions: string;
  controls: string;
  cssVariable: '--transcript-panel-width' | '--timeline-height';
  reverse?: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
}

interface ActiveDrag {
  pointerId: number;
  startCoordinate: number;
  startValue: number;
  currentValue: number;
}

export function EditorResizeHandle({
  axis,
  value,
  bounds,
  label,
  instructions,
  controls,
  cssVariable,
  reverse = false,
  onChange,
  onReset
}: EditorResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const [liveValue, setLiveValue] = useState<number | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const previousBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null);
  const cursor = axis === 'vertical' ? 'col-resize' : 'row-resize';
  const displayedValue = liveValue ?? value;

  const restoreBody = useCallback(() => {
    document.body.classList.remove('is-editor-resizing', 'is-editor-resizing--vertical', 'is-editor-resizing--horizontal');
    const previous = previousBodyStyleRef.current;
    if (!previous) return;
    document.body.style.cursor = previous.cursor;
    document.body.style.userSelect = previous.userSelect;
    previousBodyStyleRef.current = null;
  }, []);

  const finishDrag = useCallback(() => {
    const drag = activeDragRef.current;
    activeDragRef.current = null;
    setDragging(false);
    setLiveValue(null);
    restoreBody();
    if (drag) onChange(drag.currentValue);
  }, [onChange, restoreBody]);

  useEffect(() => () => {
    activeDragRef.current = null;
    restoreBody();
  }, [restoreBody]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || activeDragRef.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    activeDragRef.current = {
      pointerId: event.pointerId,
      startCoordinate: axis === 'vertical' ? event.clientX : event.clientY,
      startValue: value,
      currentValue: value
    };
    previousBodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect
    };
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-editor-resizing', `is-editor-resizing--${axis}`);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = activeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const coordinate = axis === 'vertical' ? event.clientX : event.clientY;
    const nextValue = resizeFromPointer(drag.startValue, drag.startCoordinate, coordinate, bounds, reverse);
    drag.currentValue = nextValue;
    setLiveValue(nextValue);
    event.currentTarget.closest<HTMLElement>('.app')?.style.setProperty(cssVariable, `${nextValue}px`);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = activeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextValue = resizeFromKeyboard(displayedValue, event.key, axis, bounds, event.shiftKey);
    if (nextValue == null) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(nextValue);
  };

  return (
    <div
      className={`editor-resize-handle editor-resize-handle--${axis}${dragging ? ' is-dragging' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis}
      aria-controls={controls}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={Math.round(displayedValue)}
      aria-valuetext={`${Math.round(displayedValue)} px`}
      title={`${label}. ${instructions}`}
      onDoubleClick={(event) => {
        event.preventDefault();
        onReset();
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={finishDrag}
    />
  );
}

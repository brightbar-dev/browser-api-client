interface SplitterProps {
  /** `horizontal` splits top from bottom; `vertical` splits left from right. */
  orientation: 'horizontal' | 'vertical';
  label: string;
  value: number;
  min: number;
  max: number;
  onMove: (clientPos: number) => void;
  onStep: (direction: -1 | 1) => void;
}

export function Splitter({ orientation, label, value, min, max, onMove, onStep }: SplitterProps) {
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('bac-resizing');
    const move = (ev: PointerEvent) => onMove(orientation === 'horizontal' ? ev.clientY : ev.clientX);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.classList.remove('bac-resizing');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const back = orientation === 'horizontal' ? 'ArrowUp' : 'ArrowLeft';
    const forward = orientation === 'horizontal' ? 'ArrowDown' : 'ArrowRight';
    if (e.key === back) {
      e.preventDefault();
      onStep(-1);
    } else if (e.key === forward) {
      e.preventDefault();
      onStep(1);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      class={`bac-splitter bac-splitter-${orientation}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

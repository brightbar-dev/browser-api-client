import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { EnvVariable } from '@/utils/environment';
import { segmentVariables } from '@/utils/environment';
import { useApp } from '../store';

const NO_VARS: EnvVariable[] = [];

interface VarFieldProps {
  value: string;
  onValue: (value: string) => void;
  class: string;
  multiline?: boolean;
  'aria-label'?: string;
  placeholder?: string;
  spellcheck?: boolean;
  autocomplete?: string;
  list?: string;
  title?: string;
  onPaste?: (e: ClipboardEvent) => void;
}

/**
 * An input or textarea that colours `{{variables}}`: defined ones in the accent colour,
 * undefined ones in red. A mirror with identical metrics sits behind the transparent field.
 */
export function VarField({ value, onValue, class: className, multiline, title, ...rest }: VarFieldProps) {
  const variables = useApp((s) => s.environments.find((e) => e.id === s.activeEnvId)?.variables ?? NO_VARS);
  const hasVars = value.includes('{{');
  const segments = useMemo(() => (hasVars ? segmentVariables(value, variables) : null), [hasVars, value, variables]);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);

  const sync = () => {
    if (mirrorRef.current && fieldRef.current) {
      mirrorRef.current.scrollLeft = fieldRef.current.scrollLeft;
      mirrorRef.current.scrollTop = fieldRef.current.scrollTop;
    }
  };
  useLayoutEffect(sync);

  const unresolved: string[] = [];
  for (const seg of segments ?? []) if (seg.kind === 'variable' && !seg.resolved) unresolved.push(seg.name);

  const fieldProps = {
    ...rest,
    ref: fieldRef,
    class: className,
    value,
    title: unresolved.length ? `Not defined in the active environment: ${unresolved.join(', ')}` : title,
    'aria-invalid': unresolved.length > 0 ? true : undefined,
    onInput: (e: Event) => onValue((e.currentTarget as HTMLInputElement).value),
    onScroll: sync,
  };

  return (
    <span class={`bac-varfield${multiline ? ' is-multiline' : ''}${segments ? ' has-vars' : ''}`}>
      {segments && (
        <span class={`${className} bac-varfield-mirror`} ref={mirrorRef} aria-hidden="true">
          {segments.map((seg, i) =>
            seg.kind === 'text' ? (
              seg.text
            ) : (
              <mark key={i} class={`bac-var${seg.resolved ? ' is-resolved' : ' is-unresolved'}`}>
                {seg.text}
              </mark>
            ),
          )}
          {multiline ? '\n' : null}
        </span>
      )}
      {multiline ? (
        <textarea {...(fieldProps as unknown as JSX.HTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input {...(fieldProps as unknown as JSX.HTMLAttributes<HTMLInputElement>)} />
      )}
    </span>
  );
}

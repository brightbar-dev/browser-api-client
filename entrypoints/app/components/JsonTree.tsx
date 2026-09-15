import { useState } from 'preact/hooks';
import { IconChevronRight } from './icons';
import { t } from '@/utils/i18n';

const PAGE = 200;

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span class="j-literal">null</span>;
  if (typeof value === 'string') return <span class="j-string">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span class="j-number">{String(value)}</span>;
  if (typeof value === 'boolean') return <span class="j-literal">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function Node({ name, value, depth }: { name?: string | number; value: unknown; depth: number }) {
  const isContainer = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < 2);
  const [limit, setLimit] = useState(PAGE);
  const label =
    name === undefined ? null : typeof name === 'number' ? <span class="j-index">{name}</span> : <span class="j-key">{JSON.stringify(name)}</span>;

  if (!isContainer) {
    return (
      <li role="treeitem" class="bac-jt-leaf">
        {label}
        {label && <span class="j-punct">: </span>}
        <Primitive value={value} />
      </li>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string | number, unknown]> = isArray ? (value as unknown[]).map((v, i) => [i, v]) : Object.entries(value as object);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <li role="treeitem" aria-expanded={entries.length ? open : undefined} class="bac-jt-branch">
      <button type="button" class="bac-jt-toggle" onClick={() => setOpen(!open)} disabled={!entries.length}>
        <span class={`bac-jt-chevron${open ? ' is-open' : ''}`}>
          <IconChevronRight />
        </span>
        {label}
        {label && <span class="j-punct">: </span>}
        <span class="bac-jt-summary">{summary}</span>
      </button>
      {open && entries.length > 0 && (
        <ul role="group">
          {entries.slice(0, limit).map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} />
          ))}
          {entries.length > limit && (
            <li role="none">
              <button type="button" class="bac-link-btn" onClick={() => setLimit(limit + PAGE * 5)}>
                {t('jsonTreeShowMore', Math.min(PAGE * 5, entries.length - limit), entries.length - limit)}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export function JsonTree({ value }: { value: unknown }) {
  return (
    <ul role="tree" aria-label={t('jsonTreeLabel')} class="bac-jt bac-mono">
      <Node value={value} depth={0} />
    </ul>
  );
}

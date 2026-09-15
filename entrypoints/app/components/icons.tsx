const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
} as const;

export const IconSidebar = () => (
  <svg {...base}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6 3v10" />
  </svg>
);

export const IconSettings = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
  </svg>
);

export const IconPlus = () => (
  <svg {...base}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const IconClose = () => (
  <svg {...base} width={12} height={12}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const IconSearch = () => (
  <svg {...base}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
);

export const IconChevronUp = () => (
  <svg {...base}>
    <path d="M4 10l4-4 4 4" />
  </svg>
);

export const IconChevronDown = () => (
  <svg {...base}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

export const IconChevronRight = () => (
  <svg {...base} width={12} height={12}>
    <path d="M6 4l4 4-4 4" />
  </svg>
);

export const IconCopy = () => (
  <svg {...base}>
    <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
    <path d="M10.5 5V3.5A1.5 1.5 0 009 2H3.5A1.5 1.5 0 002 3.5V9A1.5 1.5 0 003.5 10.5H5" />
  </svg>
);

export const IconDownload = () => (
  <svg {...base}>
    <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" />
  </svg>
);

export const IconEye = () => (
  <svg {...base}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

export const IconEyeOff = () => (
  <svg {...base}>
    <path d="M2 2l12 12M6.6 3.7A6.8 6.8 0 018 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 01-2 2.5M4.2 5A11 11 0 001.5 8S4 12.5 8 12.5a6.6 6.6 0 003-.7" />
  </svg>
);

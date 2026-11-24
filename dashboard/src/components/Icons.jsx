const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
  className: 'icon',
};

export const ArrowUpRight = (props) => (
  <svg {...base} {...props}>
    <path d="M6 14 14 6M7 6h7v7" />
  </svg>
);

export const Chat = (props) => (
  <svg {...base} {...props}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3h0A1.5 1.5 0 0 1 4 11.5v-6Z" />
  </svg>
);

export const Bug = (props) => (
  <svg {...base} {...props}>
    <path d="M7 6.5a3 3 0 0 1 6 0M6 9.5a4 4 0 0 1 8 0v2a4 4 0 0 1-8 0v-2ZM10 8v8M3.5 9l2.5 1M16.5 9 14 10M3.5 14.5 6 13M16.5 14.5 14 13" />
  </svg>
);

export const Check = (props) => (
  <svg {...base} {...props}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </svg>
);

export const Refresh = (props) => (
  <svg {...base} {...props}>
    <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5V6h-2.5" />
  </svg>
);

export const Plus = (props) => (
  <svg {...base} {...props}>
    <path d="M10 4.5v11M4.5 10h11" />
  </svg>
);

export const Mark = ({ size = 28 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    aria-hidden="true"
    focusable="false"
    className="mark"
  >
    <rect width="32" height="32" rx="9" fill="currentColor" />
    <path d="M9 11h14M16 11v11" stroke="var(--paper)" strokeWidth="3.2" strokeLinecap="round" />
    <circle cx="23.5" cy="22.5" r="2.6" fill="var(--accent)" />
  </svg>
);

export const Filter = (props) => (
  <svg {...base} {...props}>
    <path d="M3.5 5.5h13M6 10h8M8.5 14.5h3" />
  </svg>
);

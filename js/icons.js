// Small hand-rolled line-icon set (24x24, stroke=currentColor) so the UI
// never depends on OS emoji rendering (which varies in color/style per
// platform and clashes with the app's own color system). Pure presentation
// helper — returns an SVG string, no state, no side effects.
const ICONS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v15.5a.5.5 0 0 1-.5.5H6a1 1 0 0 1-1-1V4.5Z"/><path d="M5 17.5A1.5 1.5 0 0 1 6.5 16H19"/>',
  star: '<path d="M12 3.5 14.5 9l6 .6-4.5 4 1.3 5.9L12 16.7 6.7 19.5 8 13.6l-4.5-4 6-.6L12 3.5Z"/>',
  starFilled: '<path d="M12 3.5 14.5 9l6 .6-4.5 4 1.3 5.9L12 16.7 6.7 19.5 8 13.6l-4.5-4 6-.6L12 3.5Z" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5c.1-.5.1-1 0-1.5l1.9-1.5-2-3.4-2.2.9c-.4-.3-.8-.6-1.3-.8L15.4 5h-4l-.4 2.2c-.5.2-.9.5-1.3.8l-2.2-.9-2 3.4L7.4 12c-.1.5-.1 1 0 1.5l-1.9 1.5 2 3.4 2.2-.9c.4.3.8.6 1.3.8l.4 2.2h4l.4-2.2c.5-.2.9-.5 1.3-.8l2.2.9 2-3.4-1.9-1.5Z"/>',
  chevronLeft: '<path d="m15 5-7 7 7 7"/>',
  chevronRight: '<path d="m9 5 7 7-7 7"/>',
  flame: '<path d="M12 2.5c1 3 .3 4-1 5.5-1.5 1.7-2.5 3-2.5 5A5.5 5.5 0 0 0 12 21a5.5 5.5 0 0 0 3.5-8c-.5.8-1.2 1.5-2 1.5.8-2 .3-3.3-1.5-5.5C11.6 8.5 12 5.5 12 2.5Z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="1.5"/><path d="M3.5 9.5h17M8 3v3.5M16 3v3.5"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/><path d="M12 14v3M9 21h6M9.5 21v-2.5a2.5 2.5 0 0 1 5 0V21"/>',
  play: '<path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="none"/>',
  translate: '<path d="M4 6h9M8.5 4v2c0 3.5-1.8 6.5-4.5 8M5 12c1.8 1.4 4 2 6.5 2M13 21l4-9 4 9M14.7 18h4.6"/>',
  fontSize: '<path d="M5 17 9 6l4 11M6.2 13.5h5.6"/><path d="M15 10v7M13 10h4M13 17h4"/>',
  speaker: '<path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z"/><path d="M17 9a4.5 4.5 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11"/>',
  trash: '<path d="M4.5 6.5h15M9 6.5V4.8c0-.5.4-.8.8-.8h4.4c.4 0 .8.3.8.8v1.7M18 6.5 17.2 19a1.5 1.5 0 0 1-1.5 1.4H8.3A1.5 1.5 0 0 1 6.8 19L6 6.5"/><path d="M10 10.5v6M14 10.5v6"/>',
  alertTriangle: '<path d="M12 4 22 20H2L12 4Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r="0.15" fill="currentColor"/>',
  check: '<path d="M4.5 12.5 9 17l10.5-10.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  download: '<path d="M12 3.5v11M8 11l4 4 4-4"/><path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
  upload: '<path d="M12 15.5v-11M8 8l4-4 4 4"/><path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
  wave: '<path d="M8 3.5c-2 2.5-2 5 0 7s2 4.5 0 7M13 3.5c-2 2.5-2 5 0 7s2 4.5 0 7M18 3.5c-2 2.5-2 5 0 7s2 4.5 0 7" stroke-width="1.6"/>',
};

function icon(name, opts) {
  const cls = (opts && opts.cls) || 'icon';
  const size = (opts && opts.size) || 20;
  const body = ICONS[name] || '';
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

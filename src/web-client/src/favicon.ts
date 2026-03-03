// Dynamic favicon — picks color-mode-aware favicon from pre-sliced assets
// Persists chosen color in cookie so it stays consistent across reloads

const COLORS = ['black', 'green', 'blue', 'pink', 'teal', 'gray'] as const;
export type FaviconColor = (typeof COLORS)[number];

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}

export function getColorScheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getFaviconColor(): FaviconColor {
  const saved = getCookie('fh-favicon-color') as FaviconColor | null;
  if (saved && (COLORS as readonly string[]).includes(saved)) return saved;
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  setCookie('fh-favicon-color', color);
  return color;
}

function applyFavicon() {
  const scheme = getColorScheme();
  const color = getFaviconColor();

  let link = document.getElementById('favicon-link') as HTMLLinkElement | null;
  if (!link) {
    link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.id = 'favicon-link';
  }
  link.type = 'image/png';
  link.href = `/favicon-${scheme}-${color}.png`;
}

// Init
applyFavicon();

// Listen for color scheme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  applyFavicon();
});

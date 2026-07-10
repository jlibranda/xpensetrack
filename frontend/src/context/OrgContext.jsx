import { contrastText } from '../lib/contrast';
// src/context/OrgContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from './AuthContext';

const OrgContext = createContext(null);

// Read the last-known branding (cached by the login page from /settings/public)
// so that right after sign-in we render the REAL company name + brand color
// instead of flashing the generic default.
const readCachedBranding = () => {
  try { const v = localStorage.getItem('cached_branding'); return v ? JSON.parse(v) : null; } catch { return null; }
};
const CACHED = readCachedBranding();

const DEFAULT = {
  companyName: CACHED?.companyName || 'Cashalo',
  primaryColor: CACHED?.primaryColor || '#1D9E75',
  logoUrl: CACHED?.logoUrl || null,
  wallpaperUrl: CACHED?.wallpaperUrl || null,
  darkMode: false,
  categories: ['Cleaning','Education and Training','Entertainment/Meals','Equipment','Facility Maintenance and Repair','Furniture and Fixtures','General Office Expense','Hardware','Miscellaneous','Mobile Device','Non-Capital Small Tools Equipment and Furniture','Office Rent','Parking','Printing','Recruiting','Travel - Air Ticket (International)','Travel - Air Ticket (Domestic)','Travel - Others','Travel - Hotel (Domestic)'],
  expenseTypes: ['REIMBURSEMENT','CASH_ADVANCE'],
  categoryGlCodes: {},
  defaultCurrency: 'PHP',
  receiptRequiredAbove: 500,
  approvalLevels: 2,
  defaultPassword: 'Welcome123',
};

// Inject or update the wallpaper background div
// Map a wallpaper style to background-size / repeat values.
function wallpaperStyleProps(style) {
  switch (style) {
    case 'tile-small': return { size: '120px', repeat: 'repeat' };
    case 'tile-big':   return { size: '320px', repeat: 'repeat' };
    case 'center':     return { size: 'auto',  repeat: 'no-repeat' };
    case 'stretch':    return { size: '100% 100%', repeat: 'no-repeat' };
    case 'cover':
    default:           return { size: 'cover', repeat: 'no-repeat' };
  }
}

function setWallpaperDiv(url, style) {
  let el = document.getElementById('wallpaper-bg');
  if (url) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'wallpaper-bg';
      document.body.prepend(el);
    }
    const { size, repeat } = wallpaperStyleProps(style || 'cover');
    el.style.setProperty('--wallpaper-url', `url('${url}')`);
    el.style.setProperty('--wallpaper-size', size);
    el.style.setProperty('--wallpaper-repeat', repeat);
    document.body.classList.add('has-wallpaper');
  } else {
    if (el) el.remove();
    document.body.classList.remove('has-wallpaper');
  }
}

export function applyThemeToDOM(s) {
  if (!s) return;
  // Brand color
  if (s.primaryColor) {
    document.documentElement.style.setProperty('--brand-color', s.primaryColor);
    // Readable text color on top of the brand color (dark text on light brands
    // like yellow, white text on dark brands) so button/toggle labels stay visible.
    document.documentElement.style.setProperty('--brand-contrast', contrastText(s.primaryColor));
  }
  // Dark mode: a personal per-device choice wins over the org default.
  const personal = (() => {
    try { const v = localStorage.getItem('personal_dark'); return v === null ? null : v === 'true'; } catch { return null; }
  })();
  // Default to DARK mode everywhere (page + login). Only a personal per-device
  // choice to use light mode overrides this.
  const useDark = personal !== null ? personal : true;
  if (useDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  // Wallpaper
  setWallpaperDiv(s.wallpaperUrl || null, s.wallpaperStyle || 'cover');
}

export function OrgProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const { user } = useAuth();

  const load = () => {
    if (!localStorage.getItem('token')) return;
    api.get('/settings').then(s => {
      if (s) {
        const parsed = {
          ...s,
          categories: Array.isArray(s.categories)
            ? s.categories
            : (s.categories?.split(',').map(c => c.trim()).filter(Boolean) || DEFAULT.categories),
          expenseTypes: Array.isArray(s.expenseTypes)
            ? s.expenseTypes
            : (s.expenseTypes?.split(',').map(t => t.trim()).filter(Boolean) || DEFAULT.expenseTypes),
          categoryGlCodes: s.categoryGlCodes || {},
        };
        setSettings(parsed);
        applyThemeToDOM(parsed);
      }
    }).catch(() => {}).finally(() => setLoaded(true));
  };

  // Reload settings whenever the authenticated user changes (covers login),
  // and on initial mount. This is what makes theme + wallpaper apply right
  // after logging in instead of only after a manual page refresh.
  useEffect(() => {
    if (user) {
      // Apply the cached brand color/wallpaper instantly so there's no green
      // flash between sign-in and the /settings fetch resolving.
      if (CACHED) applyThemeToDOM(CACHED);
      load();
    } else {
      // Logged out (or on the login screen): clear any applied theme/wallpaper
      applyThemeToDOM({ darkMode: false, primaryColor: CACHED?.primaryColor || '#1D9E75', wallpaperUrl: null });
      setSettings(DEFAULT);
      setLoaded(false);
    }
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, [user]);

  const applyTheme = (s) => {
    applyThemeToDOM(s);
    if (s) setSettings(prev => ({ ...prev, ...s }));
  };

  return (
    <OrgContext.Provider value={{ settings, loaded, refresh: load, applyTheme }}>
      {children}
    </OrgContext.Provider>
  );
}

export const useOrg = () => useContext(OrgContext);

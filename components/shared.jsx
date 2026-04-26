/* global React */
const { useState, useEffect, useRef, useMemo, createContext, useContext } = React;

// ============== Theme + Router context ==============
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

// ============== Icons (minimal stroke-based) ==============
const Icon = ({ name, size = 16, ...rest }) => {
  const paths = {
    plus: 'M12 5v14M5 12h14',
    x: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12l5 5L20 7',
    arrowRight: 'M5 12h14M13 6l6 6-6 6',
    arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
    chevronDown: 'M6 9l6 6 6-6',
    chevronUp: 'M6 15l6-6 6 6',
    upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
    download: 'M12 4v12M6 10l6 6 6-6M4 20h16',
    paperclip: 'M21 11.5l-9 9a5 5 0 11-7.07-7.07l9-9a3.5 3.5 0 014.95 4.95l-9 9a2 2 0 11-2.83-2.83l8.49-8.49',
    send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    sparkle: 'M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15z',
    settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
    user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
    file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6',
    sun: 'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4l1.4-1.4M17 7l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
    book: 'M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14zM4 19.5A2.5 2.5 0 006.5 22H20',
    search: 'M21 21l-4.3-4.3M10.8 18a7.2 7.2 0 110-14.4 7.2 7.2 0 010 14.4z',
    calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
    clock: 'M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    download: 'M12 16V4M8 12l4 4 4-4M4 20h16',
    thumbsUp: 'M14 9V5a3 3 0 00-3-3l-4 9v11h11.3a2 2 0 002-1.7l1.4-8A2 2 0 0019.7 10H14zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3',
    thumbsDown: 'M10 15v4a3 3 0 003 3l4-9V2H5.7a2 2 0 00-2 1.7l-1.4 8A2 2 0 004.3 14H10zM17 2h3a2 2 0 012 2v7a2 2 0 01-2 2h-3',
    minus: 'M5 12h14',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
    logOut: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
    rotateCcw: 'M3 12a9 9 0 109-9 9.8 9.8 0 00-6.4 2.3L3 8M3 3v5h5',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
};

// ============== Logo ==============
const Logo = ({ size = 18 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="2" width="9" height="9" rx="1.5" fill="var(--accent)" />
      <rect x="13" y="2" width="9" height="9" rx="1.5" fill="var(--text)" opacity="0.85" />
      <rect x="2" y="13" width="9" height="9" rx="1.5" fill="var(--text)" opacity="0.55" />
      <rect x="13" y="13" width="9" height="9" rx="1.5" fill="var(--accent)" opacity="0.55" />
    </svg>
    <span className="display" style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>
      fireroad<span style={{ color: 'var(--accent)' }}>.ai</span>
    </span>
  </div>
);

// ============== Match Score Bar ==============
const MatchBar = ({ score, animated = true, width = 120, showNumber = true, compact = false }) => {
  const [w, setW] = useState(animated ? 0 : score);
  useEffect(() => {
    if (!animated) return;
    const t = setTimeout(() => setW(score), 80);
    return () => clearTimeout(t);
  }, [score, animated]);

  const cls = score >= 90 ? 'green' : score >= 80 ? 'orange' : score >= 60 ? 'yellow' : 'red';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className={`match-bar ${cls}`} style={{ width, height: compact ? 4 : 6 }}>
        <span style={{ width: `${w}%` }} />
      </div>
      {showNumber && (
        <span className="mono" style={{ fontSize: compact ? 11 : 12, color: 'var(--text-secondary)', minWidth: 38 }}>
          {score}<span style={{ color: 'var(--text-tertiary)' }}>/100</span>
        </span>
      )}
    </div>
  );
};

// ============== Color dot for course area ==============
const AreaDot = ({ area, size = 8 }) => {
  const colorMap = {
    cs: 'var(--course-cs)', math: 'var(--course-math)', hass: 'var(--course-hass)',
    physics: 'var(--course-physics)', bio: 'var(--course-bio)', other: 'var(--course-other)',
  };
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: colorMap[area] || 'var(--course-other)', flexShrink: 0,
    }} />
  );
};

// ============== Theme toggle ==============
const ThemeToggle = () => {
  const { theme, setTheme } = useApp();
  return (
    <button
      className="btn-ghost"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      style={{
        width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8, color: 'var(--text-secondary)',
      }}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
    </button>
  );
};

const TopBar = ({ planningTermLabel }) => {
  const { setRoute, profile, authState, signOut, resetOnboarding, activeSem, setActiveSem, termOptions, planningTermLabel: activePlanningTermLabel } = useApp();
  const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const displayName = profile?.name || authState?.user?.email?.split('@')[0] || 'User';
  const initials = displayName.split(' ').map((s) => s[0]).join('');
  const termLabel = planningTermLabel || activePlanningTermLabel || 'Next Semester';
  const generatedTerms = Array.isArray(termOptions) && termOptions.length ? termOptions : [{ id: activeSem || termLabel, label: termLabel }];
  const allTerms = activeSem && !generatedTerms.some((term) => term.id === activeSem)
    ? [{ id: activeSem, label: termLabel }, ...generatedTerms]
    : generatedTerms;
  const terms = allTerms.filter((t) => !/^SU\d+$/i.test(t.id));
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 24px', borderBottom: '1px solid var(--border)',
      background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 50,
    }}>
      <div style={{ flex: '1 1 0', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => setRoute({ name: 'planner' })} style={{ display: 'flex', alignItems: 'center' }}>
          <Logo />
        </button>
        <button
          onClick={() => setRoute({ name: 'fouryear' })}
          className="btn-ghost"
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)' }}
        >
          <Icon name="grid" size={13} />
          4-Year Plan
        </button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
        borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)',
        color: 'var(--text-secondary)', fontSize: 12, position: 'relative',
      }}>
        <Icon name="calendar" size={14} />
        {setActiveSem ? (
          <select
            value={activeSem}
            onChange={(event) => setActiveSem(event.target.value)}
            className="mono"
            title="Planning term"
            style={{
              appearance: 'none',
              background: 'transparent',
              border: 0,
              color: 'var(--text)',
              fontSize: 12,
              padding: '0 18px 0 0',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {terms.map((term) => (
              <option key={term.id} value={term.id}>{term.label}</option>
            ))}
          </select>
        ) : (
          <span className="mono" style={{ color: 'var(--text)' }}>{termLabel}</span>
        )}
        <Icon name="chevronDown" size={13} style={{ position: 'absolute', right: 8, pointerEvents: 'none', color: 'var(--text-secondary)' }} />
      </div>

      <div style={{ flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        <ThemeToggle />
        {isLocalDev && resetOnboarding && (
          <button
            className="btn-ghost"
            onClick={resetOnboarding}
            title="Reset onboarding for this account"
            style={{
              width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8, color: 'var(--text-secondary)',
            }}
          >
            <Icon name="rotateCcw" size={15} />
          </button>
        )}
        <button
          onClick={() => setRoute({ name: 'profile' })}
          title={authState?.user?.email || 'Profile'}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '4px 10px 4px 4px',
            borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--border)',
            transition: 'border-color 160ms, background 160ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
        >
          <div style={{
            width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 11, fontWeight: 600,
          }}>
            {initials}
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{displayName}</span>
        </button>
        {signOut && (
          <button
            className="btn-ghost"
            onClick={signOut}
            title="Sign out"
            style={{
              width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8, color: 'var(--text-secondary)',
            }}
          >
            <Icon name="logOut" size={15} />
          </button>
        )}
      </div>
    </div>
  );
};

// ============== All MIT majors (from data/reqs.json, medium-title) ==============
const ALL_MAJORS = [
  ['major1-12','1-12 Major'],['major1','1-ENG Major'],['major10','10 Major'],
  ['major10b','10-B Major'],['major10c','10-C Major'],['major10-ENG','10-ENG Major'],
  ['major11','11 Major'],['major11-6','11-6 Major'],['major12','12 Major'],
  ['major14-1','14-1 Major'],['major14-2','14-2 Major'],
  ['major15-1','15-1 Major'],['major15-2','15-2 Major'],['major15-3','15-3 Major'],
  ['major16','16 Major'],['major16-ENG','16-ENG Major'],['major17','17 Major'],
  ['major18am','18 Major (Applied)'],['major18gm','18 Major (General)'],['major18pm','18 Major (Pure)'],['major18c','18-C Major'],
  ['major2','2 Major'],['major2a','2-A Major'],['major2oe','2-OE Major'],
  ['major20','20 Major'],
  ['majorAFADS','21 Major (African Studies)'],['majorAS','21 Major (American Studies)'],
  ['majorAMS','21 Major (AMS)'],['majorAADS','21 Major (Asian Studies)'],
  ['majorLALS','21 Major (LALS)'],['majorRES','21 Major (RES)'],['majorWGS','21 Major (WGS)'],
  ['major21a','21A Major'],['major21e','21E Major'],
  ['majorFrench','21G Major (French)'],['majorGerman','21G Major (German)'],['majorSpanish','21G Major (Spanish)'],
  ['major21h','21H Major'],['major21L','21L Major'],
  ['major21M-1','21M-1 Major'],['major21M-2','21M-2 Major'],
  ['major21S','21S Major'],['major21w','21W Major'],
  ['major22','22 Major - Focused'],['major22-ENG','22-ENG Major - Flexible'],
  ['major24-1','24-1 Major'],['major24-2Ling','24-2 Major (Linguistics)'],['major24-2Phil','24-2 Major (Philosophy)'],
  ['major3','3 Major'],['major3a','3-A Major'],['major3c','3-C Major'],
  ['major4','4 Major'],['major4b','4-B Major'],
  ['major5','5 Major'],['major5-7','5-7 Major'],['major5-flex','5-Flex Major'],
  ['major6-1','6-1 Major'],['major6-1-8-flex','6-1/8-Flex Major'],['major6-14','6-14 Major'],
  ['major6-2','6-2 Major'],['major6-2new','6-2 Major (New)'],
  ['major6-3','6-3 Major'],['major6-3new','6-3 Major (New)'],
  ['major6-4','6-4 Major'],['major6-5','6-5 Major'],['major6-7','6-7 Major'],['major6-9','6-9 Major'],
  ['major7','7 Major'],['major7a','7-A Major'],
  ['major8','8 Major'],['major8flex','8-Flex Major'],
  ['major9','9 Major'],
  ['majorCMS','CMS Major'],['majorSTS','STS Major'],
  ['undecided','Undecided / Exploring'],
];

// ============== Searchable major dropdown ==============
const MajorSearch = ({ value, onChange, placeholder = 'Search majors…' }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const selectedLabel = ALL_MAJORS.find(([k]) => k === value)?.[1] || value || '';
  const filtered = query.trim()
    ? ALL_MAJORS.filter(([k, label]) =>
        label.toLowerCase().includes(query.toLowerCase()) ||
        k.toLowerCase().includes(query.toLowerCase()))
    : ALL_MAJORS;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        border: '1px solid var(--border)', borderRadius: 8,
        background: 'var(--surface)', padding: '8px 10px',
      }}>
        <input
          value={open ? query : selectedLabel}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          placeholder={placeholder}
          style={{ flex: 1, background: 'transparent', border: 0, outline: 0, fontSize: 13, color: 'var(--text)' }}
        />
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0, pointerEvents: 'none' }} />
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 8, maxHeight: 220, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}>
          {filtered.length === 0
            ? <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-tertiary)' }}>No matches</div>
            : filtered.map(([key, label]) => (
              <button
                key={key}
                onMouseDown={(e) => { e.preventDefault(); onChange(key); setOpen(false); setQuery(''); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 13,
                  background: value === key ? 'var(--accent-soft)' : 'transparent',
                  color: value === key ? 'var(--accent)' : 'var(--text)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

// Export to window for other scripts
Object.assign(window, { Icon, Logo, MatchBar, AreaDot, ThemeToggle, TopBar, AppCtx, useApp, ALL_MAJORS, MajorSearch });

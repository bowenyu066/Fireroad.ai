/* global React, Icon, TopBar, useApp */
const { useState, useEffect } = React;

// Mirror the major options from onboarding so stored values match
const PROFILE_MAJORS = [
  ['Course 6-2', 'Course 6-2: Electrical Engineering and Computer Science'],
  ['Course 6-3', 'Course 6-3: Computer Science and Engineering'],
  ['Course 6-4', 'Course 6-4: Artificial Intelligence and Decision Making'],
  ['Course 6-7', 'Course 6-7: Computer Science and Molecular Biology'],
  ['Course 6-9', 'Course 6-9: Computation and Cognition'],
  ['Course 18',  'Course 18: Mathematics'],
  ['Course 8',   'Course 8: Physics'],
  ['Course 15',  'Course 15: Management'],
  ['Undecided',  'Undecided / exploring'],
  ['Other',      'Other'],
];

const SKILL_LEVELS = [
  ['pre-cracked',       'Olympiad / competition background — hard classes feel approachable'],
  ['competition-lite',  'Some competition experience — want ramp-aware recommendations'],
  ['high-school',       'High-school course level — start from a steady ramp'],
];

const STANDINGS = [
  ['Pre-freshman', 'Pre-freshman'],
  ['Freshman',     'Freshman'],
  ['Sophomore',    'Sophomore'],
  ['Junior',       'Junior'],
  ['Senior',       'Senior'],
  ['MEng',         'MEng'],
];

function makeDraft(profile) {
  return {
    ...profile,
    name:        profile.name        || '',
    major:       profile.major       || 'Course 6-3',
    year:        profile.year        || 'Sophomore',
    taken:       [...(profile.taken  || [])],
    preferences: { ...(profile.preferences || {}) },
  };
}

const ProfilePage = () => {
  const { profile, setProfile, setRoute } = useApp();
  const [draft, setDraft]       = useState(() => makeDraft(profile));
  const [newCourse, setNewCourse] = useState('');
  const [saved, setSaved]        = useState(false);

  // Re-sync whenever the context profile changes (e.g. after onboarding completes)
  useEffect(() => {
    setDraft(makeDraft(profile));
  }, [profile]);

  const upd     = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const updPref = (k, v) => setDraft(d => ({ ...d, preferences: { ...d.preferences, [k]: v } }));

  const save = () => {
    setProfile(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const removeCourse = (id) => upd('taken', draft.taken.filter(c => c !== id));
  const addCourse = () => {
    const id = newCourse.trim();
    if (!id || draft.taken.includes(id)) return;
    upd('taken', [...draft.taken, id]);
    setNewCourse('');
  };

  const initials = (draft.name || '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="fade-in" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <TopBar showTabs={false} />

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '48px 32px 80px' }}>

        {/* Avatar header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 44 }}>
          <div style={{
            width: 60, height: 60, borderRadius: '50%', background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 22, fontWeight: 600, flexShrink: 0,
          }}>
            {initials}
          </div>
          <div>
            <h1 className="display" style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>
              {draft.name || 'Your Profile'}
            </h1>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
              {draft.major} · {draft.year}
            </div>
          </div>
        </div>

        {/* Basic info */}
        <PSection title="Basic Info">
          <PField label="Name">
            <PInput value={draft.name} onChange={v => upd('name', v)} placeholder="Your name" />
          </PField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <PField label="Major / Program">
              <PSelect
                value={draft.major}
                onChange={v => upd('major', v)}
                options={PROFILE_MAJORS}
              />
            </PField>
            <PField label="Year">
              <PSelect
                value={draft.year}
                onChange={v => upd('year', v)}
                options={STANDINGS}
              />
            </PField>
          </div>
        </PSection>

        {/* Preferences */}
        <PSection title="Preferences">
          <PField label="Academic background">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SKILL_LEVELS.map(([v, l]) => (
                <PRadio key={v} value={v} current={draft.preferences.skillLevel} onClick={val => updPref('skillLevel', val)}>
                  {l}
                </PRadio>
              ))}
            </div>
          </PField>
          <PField label="Notes for the agent" hint="Free-text context used when generating recommendations">
            <textarea
              value={draft.preferences.notes || ''}
              onChange={e => updPref('notes', e.target.value)}
              rows={3}
              placeholder="e.g. Strong math background, aiming for PhD in ML, prefer theory-heavy classes..."
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 'var(--r-md)',
                border: '1px solid var(--border)', background: 'var(--surface)',
                fontSize: 13, resize: 'vertical', lineHeight: 1.5,
              }}
            />
          </PField>
        </PSection>

        {/* Completed courses */}
        <PSection title="Completed Courses">
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, padding: 14,
            border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', minHeight: 64,
          }}>
            {draft.taken.map(id => (
              <span key={id} className="mono" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 8px 5px 10px', borderRadius: 999,
                background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12,
              }}>
                {id}
                <button onClick={() => removeCourse(id)} style={{ display: 'inline-flex', color: 'var(--text-tertiary)' }}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                className="mono"
                placeholder="6.1010"
                value={newCourse}
                onChange={e => setNewCourse(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCourse()}
                style={{
                  fontSize: 12, width: 70, padding: '5px 8px',
                  border: '1px dashed var(--border-strong)', borderRadius: 999,
                  background: 'transparent',
                }}
              />
              <button onClick={addCourse} style={{ color: 'var(--text-secondary)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="plus" size={12} /> Add
              </button>
            </div>
          </div>
        </PSection>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={() => setRoute({ name: 'planner' })} style={{ padding: '10px 20px' }}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 8 }}>
            {saved ? <><Icon name="check" size={14} /> Saved!</> : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

const PSection = ({ title, children }) => (
  <div style={{ marginBottom: 36 }}>
    <div style={{ marginBottom: 18, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
      <span className="display" style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
    </div>
    {children}
  </div>
);

const PField = ({ label, hint, children }) => (
  <div style={{ marginBottom: 18 }}>
    <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {label}
    </label>
    {children}
    {hint && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>{hint}</div>}
  </div>
);

const PInput = ({ value, onChange, placeholder }) => (
  <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{
    width: '100%', padding: '11px 14px', borderRadius: 'var(--r-md)',
    border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 14,
  }} />
);

const PSelect = ({ value, onChange, options }) => (
  <select value={value} onChange={e => onChange(e.target.value)} style={{
    width: '100%', padding: '11px 14px', borderRadius: 'var(--r-md)',
    border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 14, appearance: 'none',
    backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8F9A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center',
  }}>
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);

const PRadio = ({ value, current, onClick, children }) => (
  <button type="button" onClick={() => onClick(value)} style={{
    width: '100%', textAlign: 'left', padding: '12px 16px', borderRadius: 'var(--r-md)',
    border: '1px solid ' + (current === value ? 'var(--accent)' : 'var(--border)'),
    background: current === value ? 'var(--accent-soft)' : 'var(--surface)',
    display: 'flex', alignItems: 'center', gap: 12, transition: 'all 140ms',
  }}>
    <span style={{
      width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
      border: '1.5px solid ' + (current === value ? 'var(--accent)' : 'var(--border-strong)'),
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {current === value && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />}
    </span>
    <span style={{ fontSize: 14, color: 'var(--text)' }}>{children}</span>
  </button>
);

window.ProfilePage = ProfilePage;

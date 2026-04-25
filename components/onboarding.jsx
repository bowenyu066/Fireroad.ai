/* global React, FRDATA, Icon, MatchBar, AreaDot, ThemeToggle, Logo, useApp */
const { useState, useEffect, useRef } = React;

const Onboarding = () => {
  const { setRoute, setProfile } = useApp();
  const [step, setStep] = useState(1);
  const [data, setData] = useState({
    name: '',
    major: '6-3',
    year: 'Sophomore',
    goal: 'both',
    taken: [],
    transcriptParsed: false,
    parsing: false,
    pref_ml: 'research',
    pref_style: 'theory',
    pref_math: 'strong',
    cal_course: '',
    cal_diff: 'normal',
  });

  const upd = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const handleFile = () => {
    upd('parsing', true);
    setTimeout(() => {
      setData((d) => ({
        ...d,
        parsing: false,
        transcriptParsed: true,
        taken: ['6.006', '18.06', '6.009', '8.02', '18.02', '6.100A', '21H.001'],
      }));
    }, 1800);
  };

  const finish = () => {
    setProfile((p) => ({
      ...p,
      name: data.name || p.name,
      major: `Course ${data.major}`,
      year: data.year,
      taken: data.taken,
      preferences: { goal: data.pref_ml, style: data.pref_style, math: data.pref_math },
    }));
    setRoute({ name: 'planner' });
  };

  return (
    <div className="fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top */}
      <div style={{ padding: '20px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Logo />
        <ThemeToggle />
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 24px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {['Profile', 'Transcript', 'Preferences'].map((label, i) => (
            <React.Fragment key={label}>
              <button
                onClick={() => setStep(i + 1)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  color: step === i + 1 ? 'var(--text)' : step > i + 1 ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  border: '1px solid ' + (step === i + 1 ? 'var(--accent)' : 'var(--border-strong)'),
                  background: step > i + 1 ? 'var(--accent)' : step === i + 1 ? 'var(--accent-soft)' : 'transparent',
                  color: step > i + 1 ? '#fff' : step === i + 1 ? 'var(--accent)' : 'var(--text-tertiary)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
                }}>
                  {step > i + 1 ? <Icon name="check" size={12} /> : i + 1}
                </span>
                {label}
              </button>
              {i < 2 && <span style={{ width: 28, height: 1, background: 'var(--border)' }} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '0 24px 64px' }}>
        <div style={{ width: '100%', maxWidth: 560 }}>
          {step === 1 && <Step1 data={data} upd={upd} onNext={() => setStep(2)} />}
          {step === 2 && <Step2 data={data} upd={upd} setData={setData} onFile={handleFile} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
          {step === 3 && <Step3 data={data} upd={upd} onFinish={finish} onBack={() => setStep(2)} />}
        </div>
      </div>
    </div>
  );
};

const StepHeader = ({ eyebrow, title, sub }) => (
  <div style={{ marginBottom: 28 }}>
    <div className="eyebrow" style={{ marginBottom: 10 }}>{eyebrow}</div>
    <h1 className="display" style={{ margin: 0, fontSize: 32, fontWeight: 600, lineHeight: 1.15 }}>{title}</h1>
    {sub && <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: 15 }}>{sub}</p>}
  </div>
);

const Field = ({ label, children, hint }) => (
  <div style={{ marginBottom: 20 }}>
    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {label}
    </label>
    {children}
    {hint && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>{hint}</div>}
  </div>
);

const TextInput = (props) => (
  <input
    {...props}
    style={{
      width: '100%', padding: '11px 14px', borderRadius: 'var(--r-md)',
      border: '1px solid var(--border)', background: 'var(--surface)',
      fontSize: 14, ...props.style,
    }}
  />
);

const Select = ({ value, onChange, options }) => (
  <select
    value={value} onChange={(e) => onChange(e.target.value)}
    style={{
      width: '100%', padding: '11px 14px', borderRadius: 'var(--r-md)',
      border: '1px solid var(--border)', background: 'var(--surface)',
      fontSize: 14, appearance: 'none',
      backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8F9A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
      backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center',
    }}
  >
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);

const Radio = ({ value, current, onClick, children }) => (
  <button
    type="button"
    onClick={() => onClick(value)}
    style={{
      width: '100%', textAlign: 'left', padding: '14px 16px',
      borderRadius: 'var(--r-md)',
      border: '1px solid ' + (current === value ? 'var(--accent)' : 'var(--border)'),
      background: current === value ? 'var(--accent-soft)' : 'var(--surface)',
      display: 'flex', alignItems: 'center', gap: 12,
      transition: 'all 140ms',
    }}
  >
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

const StepNav = ({ onNext, onBack, nextLabel = 'Continue', disabled = false }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32, gap: 12 }}>
    {onBack ? (
      <button className="btn btn-ghost" onClick={onBack} style={{ padding: '10px 14px' }}>
        <Icon name="arrowLeft" size={14} /> Back
      </button>
    ) : <span />}
    <button className="btn btn-primary" disabled={disabled} onClick={onNext} style={{ padding: '11px 22px', opacity: disabled ? 0.5 : 1 }}>
      {nextLabel} <Icon name="arrowRight" size={14} />
    </button>
  </div>
);

// ====== Step 1 ======
const Step1 = ({ data, upd, onNext }) => (
  <div className="slide-up">
    <StepHeader eyebrow="Step 1 of 3" title="Tell us about yourself" sub="So we can ground recommendations in your program and where you are in it." />

    <Field label="Name">
      <TextInput placeholder="Alex Chen" value={data.name} onChange={(e) => upd('name', e.target.value)} />
    </Field>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <Field label="Major / Program">
        <Select value={data.major} onChange={(v) => upd('major', v)} options={[
          ['6-2', 'Course 6-2 — EE & CS'], ['6-3', 'Course 6-3 — CS & Engineering'],
          ['6-7', 'Course 6-7 — CS & Molecular Biology'], ['6-9', 'Course 6-9 — Computation & Cognition'],
          ['18', 'Course 18 — Mathematics'], ['8', 'Course 8 — Physics'],
          ['16', 'Course 16 — AeroAstro'], ['Other', 'Other'],
        ]} />
      </Field>
      <Field label="Year">
        <Select value={data.year} onChange={(v) => upd('year', v)} options={[
          ['Freshman', 'Freshman'], ['Sophomore', 'Sophomore'],
          ['Junior', 'Junior'], ['Senior', 'Senior'], ['MEng', 'MEng'],
        ]} />
      </Field>
    </div>

    <Field label="Goal this semester">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Radio value="reqs" current={data.goal} onClick={(v) => upd('goal', v)}>Fulfill graduation requirements</Radio>
        <Radio value="explore" current={data.goal} onClick={(v) => upd('goal', v)}>Explore new areas</Radio>
        <Radio value="both" current={data.goal} onClick={(v) => upd('goal', v)}>Both — strategic mix</Radio>
      </div>
    </Field>

    <StepNav onNext={onNext} disabled={!data.name} />
  </div>
);

// ====== Step 2 ======
const Step2 = ({ data, upd, setData, onFile, onNext, onBack }) => {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const [newCourse, setNewCourse] = useState('');

  const removeCourse = (id) => setData((d) => ({ ...d, taken: d.taken.filter((c) => c !== id) }));
  const addCourse = () => {
    if (!newCourse.trim()) return;
    setData((d) => ({ ...d, taken: [...d.taken, newCourse.trim()] }));
    setNewCourse('');
  };

  return (
    <div className="slide-up">
      <StepHeader eyebrow="Step 2 of 3" title="Upload your transcript" sub="Drop your unofficial PDF — the agent extracts your completed courses. You can edit before continuing." />

      {!data.transcriptParsed && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(); }}
          onClick={() => onFile()}
          style={{
            border: '1.5px dashed ' + (drag ? 'var(--accent)' : 'var(--border-strong)'),
            background: drag ? 'var(--accent-soft)' : 'var(--surface)',
            borderRadius: 'var(--r-lg)', padding: '40px 24px',
            textAlign: 'center', cursor: 'pointer', transition: 'all 160ms',
          }}
        >
          {data.parsing ? (
            <div>
              <div style={{ display: 'inline-flex', gap: 4, marginBottom: 14 }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{
                    width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                    animation: `pulse 1s infinite ${i * 0.15}s`,
                  }} />
                ))}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text)' }}>Agent is reading your transcript…</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>Extracting course numbers and grades</div>
            </div>
          ) : (
            <div>
              <Icon name="upload" size={28} />
              <div style={{ marginTop: 12, fontSize: 15, fontWeight: 500 }}>Drop unofficial transcript PDF</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>or click to browse</div>
              <input ref={inputRef} type="file" accept=".pdf" hidden />
            </div>
          )}
        </div>
      )}

      {!data.transcriptParsed && !data.parsing && (
        <button
          onClick={() => setData((d) => ({ ...d, transcriptParsed: true, taken: [] }))}
          style={{
            marginTop: 14, fontSize: 13, color: 'var(--text-secondary)',
            textDecoration: 'underline', textUnderlineOffset: 3,
          }}
        >
          Or manually enter courses you've taken →
        </button>
      )}

      {data.transcriptParsed && (
        <div className="slide-up">
          {data.taken.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: 'var(--r-md)',
              background: 'var(--accent-soft)', border: '1px solid var(--accent)', marginBottom: 16,
            }}>
              <Icon name="check" size={14} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 13 }}>Found {data.taken.length} courses. Review and edit below.</span>
            </div>
          )}

          <Field label="Completed courses">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)', minHeight: 60 }}>
              {data.taken.map((id) => (
                <span key={id} className="mono" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px 5px 10px', borderRadius: 999,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  fontSize: 12,
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
                  placeholder="6.006"
                  value={newCourse}
                  onChange={(e) => setNewCourse(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCourse()}
                  style={{
                    fontSize: 12, width: 70, padding: '5px 8px',
                    border: '1px dashed var(--border-strong)', borderRadius: 999,
                    background: 'transparent',
                  }}
                />
                <button onClick={addCourse} style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                  <Icon name="plus" size={12} /> Add
                </button>
              </div>
            </div>
          </Field>
        </div>
      )}

      <StepNav onNext={onNext} onBack={onBack} disabled={!data.transcriptParsed} />
    </div>
  );
};

// ====== Step 3 ======
const Step3 = ({ data, upd, onFinish, onBack }) => (
  <div className="slide-up">
    <StepHeader eyebrow="Step 3 of 3" title="Calibrate the agent" sub="Four quick questions so the recommendations match how you actually learn." />

    <Field label="What's your goal with ML/AI courses?">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Radio value="research" current={data.pref_ml} onClick={(v) => upd('pref_ml', v)}>I want to do ML research</Radio>
        <Radio value="apply" current={data.pref_ml} onClick={(v) => upd('pref_ml', v)}>I want to apply ML to another field</Radio>
        <Radio value="engineer" current={data.pref_ml} onClick={(v) => upd('pref_ml', v)}>I want to work in ML engineering</Radio>
        <Radio value="curious" current={data.pref_ml} onClick={(v) => upd('pref_ml', v)}>Just curious / exploring</Radio>
      </div>
    </Field>

    <Field label="Learning style">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Radio value="theory" current={data.pref_style} onClick={(v) => upd('pref_style', v)}>Theory and proofs (psets, derivations)</Radio>
        <Radio value="build" current={data.pref_style} onClick={(v) => upd('pref_style', v)}>Building things (projects, implementations)</Radio>
        <Radio value="mix" current={data.pref_style} onClick={(v) => upd('pref_style', v)}>Mix of both</Radio>
      </div>
    </Field>

    <Field label="Math background">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Radio value="strong" current={data.pref_math} onClick={(v) => upd('pref_math', v)}>Very strong (math olympiad / real analysis)</Radio>
        <Radio value="solid" current={data.pref_math} onClick={(v) => upd('pref_math', v)}>Solid (18.06 felt manageable)</Radio>
        <Radio value="needs" current={data.pref_math} onClick={(v) => upd('pref_math', v)}>Needs work</Radio>
      </div>
    </Field>

    <Field label="Workload calibration" hint="Pick a course you've taken and how it felt — anchors the workload model.">
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Select
          value={data.cal_course || (data.taken[0] || '')}
          onChange={(v) => upd('cal_course', v)}
          options={[['', 'Pick a course…'], ...data.taken.map((c) => [c, c])]}
        />
        <Select
          value={data.cal_diff}
          onChange={(v) => upd('cal_diff', v)}
          options={[['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Very hard']]}
        />
      </div>
    </Field>

    <button className="btn btn-primary" onClick={onFinish} style={{
      width: '100%', padding: '14px', fontSize: 14, marginTop: 16,
    }}>
      Build my plan <Icon name="arrowRight" size={14} />
    </button>
    <button className="btn btn-ghost" onClick={onBack} style={{ width: '100%', padding: 10, marginTop: 8, fontSize: 13 }}>
      Back
    </button>
  </div>
);

// pulse animation
if (!document.getElementById('pulse-anim')) {
  const s = document.createElement('style');
  s.id = 'pulse-anim';
  s.textContent = `@keyframes pulse { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.4); } }`;
  document.head.appendChild(s);
}

window.Onboarding = Onboarding;

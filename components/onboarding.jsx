/* global React, FRDATA, Icon, ThemeToggle, Logo, useApp */
const { useState, useEffect, useMemo, useRef } = React;

const MIT_GRADES_URL = 'https://registrar.mit.edu/classes-grades-evaluations/grades';
const MIT_WEBSIS_URL = 'https://student.mit.edu/';

const SAMPLE_COURSES = [
  { id: '6.100A', name: 'Intro to CS Programming in Python', grade: 'A', term: 'F23', status: 'completed', source: 'transcript', preference: 'neutral' },
  { id: '18.02', name: 'Multivariable Calculus', grade: 'A-', term: 'F23', status: 'completed', source: 'transcript', preference: 'neutral' },
  { id: '8.02', name: 'Physics II', grade: 'B+', term: 'F23', status: 'completed', source: 'transcript', preference: 'neutral' },
  { id: '6.006', name: 'Introduction to Algorithms', grade: 'A-', term: 'S24', status: 'completed', source: 'transcript', preference: 'neutral' },
  { id: '18.06', name: 'Linear Algebra', grade: 'A', term: 'S24', status: 'completed', source: 'transcript', preference: 'neutral' },
  { id: '6.009', name: 'Fundamentals of Programming', grade: 'A', term: 'S24', status: 'completed', source: 'transcript', preference: 'neutral' },
  { id: '21H.001', name: 'How to Stage a Revolution', grade: 'P', term: 'S24', status: 'completed', source: 'transcript', preference: 'neutral' },
];

const MAJORS = [
  ['6-2', 'Course 6-2: Electrical Engineering and Computer Science'],
  ['6-3', 'Course 6-3: Computer Science and Engineering'],
  ['6-4', 'Course 6-4: Artificial Intelligence and Decision Making'],
  ['6-7', 'Course 6-7: Computer Science and Molecular Biology'],
  ['6-9', 'Course 6-9: Computation and Cognition'],
  ['18', 'Course 18: Mathematics'],
  ['8', 'Course 8: Physics'],
  ['15', 'Course 15: Management'],
  ['undecided', 'Undecided / exploring'],
  ['other', 'Other'],
];

const STANDINGS = [
  ['prefrosh', 'Pre-freshman'],
  ['freshman', 'Freshman'],
  ['sophomore', 'Sophomore'],
  ['junior', 'Junior'],
  ['senior', 'Senior'],
  ['meng', 'MEng'],
];

const SKILL_LEVELS = [
  {
    id: 'pre-cracked',
    title: 'Pre-cracked',
    body: 'Olympiad / serious competition background; hard technical classes usually feel approachable.',
  },
  {
    id: 'competition-lite',
    title: 'Some competition experience',
    body: 'You have done contests or advanced projects, but you still want ramp-aware recommendations.',
  },
  {
    id: 'high-school',
    title: 'High-school course level',
    body: 'Mostly AP, IB, A-level, or regular high-school coursework; start from a steadier ramp.',
  },
];

const emptyData = {
  name: '',
  major: '6-3',
  futureProgram: '',
  standing: 'sophomore',
  gpa: '',
  transcriptUploaded: false,
  transcriptFileName: '',
  transcriptParsed: false,
  transcriptParsing: false,
  resumeUploaded: false,
  resumeFileName: '',
  resumeParsed: false,
  resumeParsing: false,
  courseworkImported: false,
  courseworkText: '',
  courseworkSource: 'paste',
  courses: [],
  skillLevel: 'competition-lite',
  preferencesNote: '',
};

const courseName = (id) => {
  const course = FRDATA.getCourse(id);
  return course ? course.name : '';
};

const dedupeCourses = (courses) => {
  const seen = new Set();
  return courses.filter((course) => {
    const key = course.id.trim().toUpperCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const parseCourseworkText = (text, source = 'manual') => {
  const matches = text.match(/\b(?:[0-9]{1,2}\.[0-9A-Z]{2,5}|(?:CMS|MAS|STS|WGS|EC|ES|CC|CS|IDS|SP|AS|MS|NS|PE)\.?[0-9A-Z]{2,5})\b/g) || [];
  return dedupeCourses(matches.map((raw) => {
    const id = raw.toUpperCase();
    return {
      id,
      name: courseName(id),
      grade: '',
      term: '',
      status: 'completed',
      source,
      preference: 'neutral',
    };
  }));
};

const toPersonalCourseMarkdown = (data) => {
  const lines = [
    '# personalcourse.md',
    '',
    '## Basic Info',
    `- name: ${data.name || 'TBD'}`,
    `- major: ${data.major}`,
    `- future_program_space: ${data.futureProgram || 'TBD'}`,
    `- standing: ${data.standing}`,
    `- gpa: ${data.standing === 'prefrosh' ? 'N/A' : (data.gpa || 'TBD')}`,
    '',
    '## Inputs',
    `- transcript: ${data.transcriptUploaded ? data.transcriptFileName || 'uploaded' : 'not_provided'}`,
    `- resume: ${data.resumeUploaded ? data.resumeFileName || 'uploaded' : 'not_provided'}`,
    `- coursework_import: ${data.courseworkImported ? data.courseworkSource : 'not_provided'}`,
    '',
    '## Courses',
    '| course | name | term | grade | status | source | preference |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(data.courses.length ? data.courses.map((course) => (
      `| ${course.id} | ${course.name || ''} | ${course.term || ''} | ${course.grade || ''} | ${course.status || 'completed'} | ${course.source || ''} | ${course.preference || 'neutral'} |`
    )) : ['| TBD |  |  |  |  |  |  |']),
    '',
    '## Preferences',
    `- skill_level: ${data.skillLevel}`,
    `- notes: ${data.preferencesNote || 'TBD'}`,
  ];
  return lines.join('\n');
};

const Onboarding = () => {
  const { profile, setRoute, setProfile, completeOnboarding, authState, signOut } = useApp();
  const [data, setData] = useState(emptyData);
  const [active, setActive] = useState('profile');

  const isPrefrosh = data.standing === 'prefrosh';
  const hasRichSignal = data.transcriptUploaded || data.resumeUploaded || data.courseworkImported;
  const needsSkillStep = !hasRichSignal;

  const steps = useMemo(() => {
    const list = [{ key: 'profile', label: 'Profile' }];
    if (!isPrefrosh) list.push({ key: 'transcript', label: 'Transcript' });
    list.push({ key: 'resume', label: 'Resume' });
    if (!isPrefrosh) list.push({ key: 'coursework', label: 'Coursework' });
    if (needsSkillStep) list.push({ key: 'skill', label: 'Skill level' });
    if (!isPrefrosh && data.courses.length > 0) list.push({ key: 'ratings', label: 'Course feel' });
    return list;
  }, [isPrefrosh, needsSkillStep, data.courses.length]);

  useEffect(() => {
    if (!steps.some((s) => s.key === active)) setActive(steps[steps.length - 1].key);
  }, [steps, active]);

  useEffect(() => {
    localStorage.setItem('fr-personalcourse-draft', toPersonalCourseMarkdown(data));
  }, [data]);

  const upd = (key, value) => setData((prev) => ({ ...prev, [key]: value }));
  const mergeCourses = (incoming) => setData((prev) => ({
    ...prev,
    courses: dedupeCourses([...prev.courses, ...incoming]),
  }));
  const setCoursePreference = (id, preference) => setData((prev) => ({
    ...prev,
    courses: prev.courses.map((course) => course.id === id ? { ...course, preference } : course),
  }));

  const currentIndex = Math.max(0, steps.findIndex((s) => s.key === active));
  const goBack = () => currentIndex > 0 && setActive(steps[currentIndex - 1].key);
  const goNext = () => {
    if (active === 'profile' && !data.name.trim()) return;
    if (currentIndex >= steps.length - 1) {
      finish();
      return;
    }
    setActive(steps[currentIndex + 1].key);
  };
  const skipToNext = () => {
    if (currentIndex >= steps.length - 1) finish();
    else setActive(steps[currentIndex + 1].key);
  };

  const simulateTranscriptParse = (fileName = 'grade-report.pdf') => {
    setData((prev) => ({ ...prev, transcriptUploaded: true, transcriptFileName: fileName, transcriptParsing: true }));
    setTimeout(() => {
      setData((prev) => ({
        ...prev,
        transcriptParsed: true,
        transcriptParsing: false,
        courses: dedupeCourses([...prev.courses, ...SAMPLE_COURSES]),
      }));
    }, 900);
  };

  const simulateResumeParse = (fileName = 'resume.pdf') => {
    setData((prev) => ({ ...prev, resumeUploaded: true, resumeFileName: fileName, resumeParsing: true }));
    setTimeout(() => {
      setData((prev) => ({
        ...prev,
        resumeParsed: true,
        resumeParsing: false,
        skillLevel: prev.transcriptUploaded || prev.courseworkImported ? prev.skillLevel : 'competition-lite',
        preferencesNote: prev.preferencesNote || 'Resume parser placeholder: infer interests, projects, awards, and technical depth here.',
      }));
    }, 850);
  };

  const importCoursework = () => {
    const parsed = parseCourseworkText(data.courseworkText, data.courseworkSource);
    if (!parsed.length) return;
    mergeCourses(parsed);
    setData((prev) => ({ ...prev, courseworkImported: true }));
  };

  const finish = () => {
    const taken = data.courses.map((course) => course.id);
    const majorLabel = MAJORS.find(([id]) => id === data.major)?.[1] || data.major;
    const nextProfile = {
      ...profile,
      name: data.name || profile.name,
      major: data.major === 'undecided' ? 'Undecided' : data.major.startsWith('Course') ? data.major : `Course ${data.major}`,
      majorLabel,
      year: STANDINGS.find(([id]) => id === data.standing)?.[1] || data.standing,
      taken,
      preferences: {
        ...profile.preferences,
        skillLevel: data.skillLevel,
        notes: data.preferencesNote,
      },
    };

    setProfile(nextProfile);
    if (completeOnboarding) {
      completeOnboarding({
        profile: nextProfile,
        onboarding: data,
        personalCourseMarkdown: toPersonalCourseMarkdown(data),
      });
    } else {
      setRoute({ name: 'planner' });
    }
  };

  const stepProps = {
    data, upd, goNext, goBack, skipToNext, currentIndex, steps,
    simulateTranscriptParse, simulateResumeParse, importCoursework, mergeCourses, setCoursePreference,
    isPrefrosh,
  };

  return (
    <div className="fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Logo />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {authState?.user?.email && (
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{authState.user.email}</span>
          )}
          <ThemeToggle />
          {signOut && (
            <button className="btn btn-ghost" onClick={signOut} style={{ padding: '8px 10px' }}>
              <Icon name="logOut" size={14} /> Sign out
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 24px 26px' }}>
        <Stepper steps={steps} active={active} setActive={setActive} />
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '0 24px 56px' }}>
        <div style={{ width: '100%', maxWidth: 680 }}>
          {active === 'profile' && <StepProfile {...stepProps} />}
          {active === 'transcript' && <StepTranscript {...stepProps} />}
          {active === 'resume' && <StepResume {...stepProps} />}
          {active === 'coursework' && <StepCoursework {...stepProps} />}
          {active === 'skill' && <StepSkill {...stepProps} />}
          {active === 'ratings' && <StepRatings {...stepProps} />}
        </div>
      </div>
    </div>
  );
};

const Stepper = ({ steps, active, setActive }) => {
  const activeIndex = steps.findIndex((s) => s.key === active);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase' }}>
      {steps.map((step, index) => (
        <React.Fragment key={step.key}>
          <button
            onClick={() => index <= activeIndex && setActive(step.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: index === activeIndex ? 'var(--text)' : index < activeIndex ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              cursor: index <= activeIndex ? 'pointer' : 'default',
            }}
          >
            <span style={{
              width: 23,
              height: 23,
              borderRadius: '50%',
              border: '1px solid ' + (index === activeIndex ? 'var(--accent)' : 'var(--border-strong)'),
              background: index < activeIndex ? 'var(--accent)' : index === activeIndex ? 'var(--accent-soft)' : 'transparent',
              color: index < activeIndex ? '#fff' : index === activeIndex ? 'var(--accent)' : 'var(--text-tertiary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
            }}>
              {index < activeIndex ? <Icon name="check" size={12} /> : index + 1}
            </span>
            {step.label}
          </button>
          {index < steps.length - 1 && <span style={{ width: 22, height: 1, background: 'var(--border)' }} />}
        </React.Fragment>
      ))}
    </div>
  );
};

const StepHeader = ({ eyebrow, title, sub }) => (
  <div style={{ marginBottom: 26 }}>
    <div className="eyebrow" style={{ marginBottom: 10 }}>{eyebrow}</div>
    <h1 className="display" style={{ margin: 0, fontSize: 32, fontWeight: 600, lineHeight: 1.15, letterSpacing: 0 }}>{title}</h1>
    {sub && <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: 15 }}>{sub}</p>}
  </div>
);

const Field = ({ label, children, hint }) => (
  <div style={{ marginBottom: 19 }}>
    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
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
      width: '100%',
      padding: '11px 14px',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      fontSize: 14,
      ...props.style,
    }}
  />
);

const TextArea = (props) => (
  <textarea
    {...props}
    style={{
      width: '100%',
      minHeight: 112,
      resize: 'vertical',
      padding: '12px 14px',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      fontSize: 14,
      lineHeight: 1.45,
      ...props.style,
    }}
  />
);

const Select = ({ value, onChange, options }) => (
  <select
    value={value}
    onChange={(event) => onChange(event.target.value)}
    style={{
      width: '100%',
      padding: '11px 14px',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      fontSize: 14,
      appearance: 'none',
      backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8F9A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 14px center',
    }}
  >
    {options.map(([valueOption, label]) => <option key={valueOption} value={valueOption}>{label}</option>)}
  </select>
);

const Choice = ({ value, current, onClick, title, children }) => (
  <button
    type="button"
    onClick={() => onClick(value)}
    style={{
      width: '100%',
      textAlign: 'left',
      padding: '14px 16px',
      borderRadius: 'var(--r-md)',
      border: '1px solid ' + (current === value ? 'var(--accent)' : 'var(--border)'),
      background: current === value ? 'var(--accent-soft)' : 'var(--surface)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      transition: 'background 140ms, border-color 140ms',
    }}
  >
    <span style={{
      width: 16,
      height: 16,
      borderRadius: '50%',
      flexShrink: 0,
      marginTop: 2,
      border: '1.5px solid ' + (current === value ? 'var(--accent)' : 'var(--border-strong)'),
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {current === value && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />}
    </span>
    <span>
      <span style={{ display: 'block', color: 'var(--text)', fontWeight: 500 }}>{title}</span>
      <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 13, marginTop: 3 }}>{children}</span>
    </span>
  </button>
);

const StepNav = ({ onNext, onBack, onSkip, nextLabel = 'Continue', disabled = false, optional = false }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 30, gap: 12 }}>
    {onBack ? (
      <button className="btn btn-ghost" onClick={onBack} style={{ padding: '10px 14px' }}>
        <Icon name="arrowLeft" size={14} /> Back
      </button>
    ) : <span />}
    <div style={{ display: 'flex', gap: 8 }}>
      {optional && (
        <button className="btn btn-ghost" onClick={onSkip} style={{ padding: '10px 14px' }}>
          Skip
        </button>
      )}
      <button className="btn btn-primary" disabled={disabled} onClick={onNext} style={{ padding: '11px 22px', opacity: disabled ? 0.5 : 1 }}>
        {nextLabel} <Icon name="arrowRight" size={14} />
      </button>
    </div>
  </div>
);

const UploadZone = ({ icon = 'upload', title, sub, busy, busyTitle, busySub, onUpload, accept = '.pdf' }) => {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const pickFile = (file) => onUpload(file?.name);
  return (
    <div
      onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDrag(false);
        pickFile(event.dataTransfer.files?.[0]);
      }}
      onClick={() => !busy && inputRef.current?.click()}
      style={{
        border: '1.5px dashed ' + (drag ? 'var(--accent)' : 'var(--border-strong)'),
        background: drag ? 'var(--accent-soft)' : 'var(--surface)',
        borderRadius: 'var(--r-lg)',
        padding: '38px 24px',
        textAlign: 'center',
        cursor: busy ? 'default' : 'pointer',
        transition: 'background 160ms, border-color 160ms',
      }}
    >
      {busy ? (
        <div>
          <div style={{ display: 'inline-flex', gap: 4, marginBottom: 14 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent)',
                animation: `pulse 1s infinite ${i * 0.15}s`,
              }} />
            ))}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text)' }}>{busyTitle}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{busySub}</div>
        </div>
      ) : (
        <div>
          <Icon name={icon} size={28} />
          <div style={{ marginTop: 12, fontSize: 15, fontWeight: 500 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{sub}</div>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            hidden
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
        </div>
      )}
    </div>
  );
};

const StatusPill = ({ icon = 'check', children }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 'var(--r-md)',
    background: 'var(--accent-soft)',
    border: '1px solid var(--accent)',
    marginTop: 14,
  }}>
    <Icon name={icon} size={14} style={{ color: 'var(--accent)' }} />
    <span style={{ fontSize: 13 }}>{children}</span>
  </div>
);

const CourseList = ({ courses, setCoursePreference, compact = false }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {courses.map((course) => (
      <div
        key={course.id}
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '86px 1fr 120px' : '92px 1fr 70px 126px',
          gap: 12,
          alignItems: 'center',
          padding: '11px 12px',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <span className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>{course.id}</span>
        <span style={{ minWidth: 0, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {course.name || 'Course title pending parse'}
        </span>
        {!compact && <span className="mono" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{course.grade || '-'}</span>}
        <PreferenceButtons value={course.preference} onChange={(value) => setCoursePreference(course.id, value)} />
      </div>
    ))}
  </div>
);

const PreferenceButtons = ({ value, onChange }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: '36px 36px 36px',
    gap: 4,
    justifyContent: 'end',
  }}>
    {[
      ['like', 'thumbsUp', 'Liked it'],
      ['neutral', 'minus', 'Neutral'],
      ['dislike', 'thumbsDown', 'Disliked it'],
    ].map(([id, icon, title]) => (
      <button
        key={id}
        type="button"
        title={title}
        onClick={() => onChange(id)}
        style={{
          width: 34,
          height: 34,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px solid ' + (value === id ? 'var(--accent)' : 'var(--border)'),
          background: value === id ? 'var(--accent-soft)' : 'var(--surface-2)',
          color: value === id ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        <Icon name={icon} size={15} />
      </button>
    ))}
  </div>
);

const StepProfile = ({ data, upd, goNext }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Required"
      title="Basic student info"
      sub="This is the only required section. Everything after this can be skipped or inferred later."
    />
    <Field label="Your name">
      <TextInput placeholder="Alex Chen" value={data.name} onChange={(event) => upd('name', event.target.value)} />
    </Field>
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
      <Field label="Major / intended major">
        <Select value={data.major} onChange={(value) => upd('major', value)} options={MAJORS} />
      </Field>
      <Field label="Year">
        <Select value={data.standing} onChange={(value) => upd('standing', value)} options={STANDINGS} />
      </Field>
    </div>
    <Field label="Future double major / minor / concentration space" hint="Not active yet, but this keeps the data model ready.">
      <TextInput placeholder="Minor in 18, concentration in linguistics, etc." value={data.futureProgram} onChange={(event) => upd('futureProgram', event.target.value)} />
    </Field>
    {data.standing !== 'prefrosh' && (
      <Field label="GPA or academic standing" hint="Optional. Leave blank if you do not want recommendations to use it yet.">
        <TextInput placeholder="4.7 / 5.0, good standing, or leave blank" value={data.gpa} onChange={(event) => upd('gpa', event.target.value)} />
      </Field>
    )}
    {data.standing === 'prefrosh' && (
      <StatusPill icon="sparkle">Pre-freshman mode skips transcript, MIT coursework import, and course-rating calibration.</StatusPill>
    )}
    <StepNav onNext={goNext} disabled={!data.name.trim()} />
  </div>
);

const StepTranscript = ({ data, goNext, goBack, skipToNext, simulateTranscriptParse }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Optional"
      title="Upload transcript or grade report"
      sub="A PDF unlocks course and grade parsing. You can skip it and still continue."
    />
    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
      <a className="btn" href={MIT_GRADES_URL} target="_blank" rel="noreferrer">
        <Icon name="book" size={14} /> MIT grades
      </a>
      <a className="btn" href={MIT_WEBSIS_URL} target="_blank" rel="noreferrer">
        <Icon name="file" size={14} /> WebSIS
      </a>
    </div>
    <UploadZone
      title="Drop unofficial transcript or grade-report PDF"
      sub="or click to browse"
      busy={data.transcriptParsing}
      busyTitle="Reading transcript..."
      busySub="Placeholder parser extracts course ids, terms, and grades"
      onUpload={(fileName) => simulateTranscriptParse(fileName || 'grade-report.pdf')}
    />
    {data.transcriptParsed && <StatusPill>Found {data.courses.length} completed courses. Grades are shown again in the final course-feel step.</StatusPill>}
    <StepNav onNext={goNext} onBack={goBack} onSkip={skipToNext} optional nextLabel={data.transcriptUploaded ? 'Continue' : 'Continue without transcript'} />
  </div>
);

const StepResume = ({ data, goNext, goBack, skipToNext, simulateResumeParse }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Optional"
      title="Upload resume"
      sub="This will be saved for a backend parser to infer interests, competition background, projects, and skill level."
    />
    <UploadZone
      icon="paperclip"
      title="Drop resume PDF"
      sub="or click to browse"
      accept=".pdf,.doc,.docx"
      busy={data.resumeParsing}
      busyTitle="Reading resume..."
      busySub="Parser hook reserved for the upcoming prompt"
      onUpload={(fileName) => simulateResumeParse(fileName || 'resume.pdf')}
    />
    {data.resumeParsed && <StatusPill>Resume stored as {data.resumeFileName}. Backend parse hook is reserved.</StatusPill>}
    <StepNav onNext={goNext} onBack={goBack} onSkip={skipToNext} optional nextLabel={data.resumeUploaded ? 'Continue' : 'Continue without resume'} />
  </div>
);

const StepCoursework = ({ data, upd, goNext, goBack, skipToNext, importCoursework, setCoursePreference }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Optional"
      title="Import existing coursework"
      sub="For now, paste a list from Fireroad, a CSV, or notes. The importer extracts MIT subject numbers and merges them into personalcourse.md."
    />
    <Field label="Import format">
      <Select value={data.courseworkSource} onChange={(value) => upd('courseworkSource', value)} options={[
        ['paste', 'Paste from Fireroad / notes'],
        ['csv', 'CSV export'],
        ['manual', 'Manual list'],
      ]} />
    </Field>
    <Field label="Coursework text" hint="Example: 6.100A, 18.02, 8.02, 6.006, 18.06">
      <TextArea
        placeholder="Paste courses here..."
        value={data.courseworkText}
        onChange={(event) => upd('courseworkText', event.target.value)}
      />
    </Field>
    <button className="btn" onClick={importCoursework} disabled={!data.courseworkText.trim()} style={{ opacity: data.courseworkText.trim() ? 1 : 0.55 }}>
      <Icon name="download" size={14} /> Import coursework
    </button>
    {data.courses.length > 0 && (
      <div style={{ marginTop: 18 }}>
        <Field label="Current parsed courses">
          <CourseList courses={data.courses} setCoursePreference={setCoursePreference} compact />
        </Field>
      </div>
    )}
    <StepNav onNext={goNext} onBack={goBack} onSkip={skipToNext} optional nextLabel={data.courseworkImported ? 'Continue' : 'Continue without import'} />
  </div>
);

const StepSkill = ({ data, upd, goNext, goBack }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Fallback calibration"
      title="Choose skill level"
      sub="We ask this only when transcript, resume, and coursework signals are absent."
    />
    <Field label="Programming / math competition background">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {SKILL_LEVELS.map((level) => (
          <Choice key={level.id} value={level.id} current={data.skillLevel} onClick={(value) => upd('skillLevel', value)} title={level.title}>
            {level.body}
          </Choice>
        ))}
      </div>
    </Field>
    <Field label="Optional note">
      <TextArea
        placeholder="Anything the agent should know about your background?"
        value={data.preferencesNote}
        onChange={(event) => upd('preferencesNote', event.target.value)}
        style={{ minHeight: 84 }}
      />
    </Field>
    <StepNav onNext={goNext} onBack={goBack} nextLabel="Build my plan" />
  </div>
);

const StepRatings = ({ data, goNext, goBack, setCoursePreference }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Optional calibration"
      title="How did these classes feel?"
      sub="Every course starts neutral. Mark the ones you loved or hated so the recommender can learn your taste."
    />
    <Field label="Completed courses">
      <CourseList courses={data.courses} setCoursePreference={setCoursePreference} />
    </Field>
    <StepNav onNext={goNext} onBack={goBack} nextLabel="Build my plan" />
  </div>
);

if (!document.getElementById('pulse-anim')) {
  const style = document.createElement('style');
  style.id = 'pulse-anim';
  style.textContent = '@keyframes pulse { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.4); } }';
  document.head.appendChild(style);
}

window.FireroadPersonalCourse = { toMarkdown: toPersonalCourseMarkdown, parseCourseworkText };
window.Onboarding = Onboarding;

/* global React, ReactDOM, FRDATA, FRAuth, PersonalCourse, AuthGate, Onboarding, ProfilePage, TopBar, SchedulePanel, RequirementsPanel, FourYearPlanPage, AgentPanel, Recommendations, CourseDetail, AppCtx */
const { useState, useEffect, useRef, useCallback } = React;

// ============== Draggable column resizer ==============
const ColumnResizer = ({ onDrag, onDragEnd }) => {
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);

  const handleMouseDown = (event) => {
    event.preventDefault();
    draggingRef.current = true;
    lastXRef.current = event.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMove = (event) => {
      if (!draggingRef.current) return;
      const delta = event.clientX - lastXRef.current;
      lastXRef.current = event.clientX;
      if (delta !== 0) onDrag(delta);
    };
    const handleUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (onDragEnd) onDragEnd();
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [onDrag, onDragEnd]);

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        flex: '0 0 6px',
        width: 6,
        cursor: 'col-resize',
        background: 'transparent',
        position: 'relative',
        zIndex: 5,
        margin: '0 -3px',
      }}
      title="Drag to resize"
    >
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 3, width: 1,
        background: 'var(--border)', pointerEvents: 'none',
      }} />
    </div>
  );
};

// Section panel header, also resizable for requirements column
const SectionHeader = ({ label, right }) => (
  <div style={{
    padding: '14px 18px', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 50, boxSizing: 'border-box',
  }}>
    <div className="eyebrow">{label}</div>
    {right || null}
  </div>
);

const Planner = ({ schedule, setSchedule, messages, setMessages, planningTermLabel }) => {
  const { setRoute, profile } = React.useContext(AppCtx);
  const [justAddedId, setJustAddedId] = useState(null);
  const [viewMode, setViewMode] = useState('list');

  const onAddCourse = async (id) => {
    const courseId = String(id || '').trim().toUpperCase();
    if (!courseId || schedule.map((course) => String(course).toUpperCase()).includes(courseId)) return;
    const c = await FRDATA.fetchCurrentCourse(courseId);
    if (!c) return;
    const existingCourses = await Promise.all(schedule.map((course) => FRDATA.fetchCurrentCourse(course)));
    const newUnits = existingCourses.reduce((sum, course) => sum + (Number(course?.units) || 0), 0) + (Number(c.units) || 0);
    setSchedule((s) => [...s, courseId]);
    setJustAddedId(courseId);
    setTimeout(() => setJustAddedId(null), 800);
    setMessages((m) => [...m, {
      role: 'agent',
      text: `Added ${c.id} (${c.name}) to ${planningTermLabel}. You're at about ${newUnits} units. Want me to suggest something to balance the workload?`,
    }]);
  };

  const onRemoveCourse = async (id) => {
    const courseId = String(id || '').trim().toUpperCase();
    if (!schedule.includes(courseId)) return;
    const c = await FRDATA.fetchCurrentCourse(courseId) || FRDATA.getCourse(courseId) || { id: courseId, name: courseId };
    setSchedule((s) => s.filter((x) => x !== courseId));
    setMessages((m) => [...m, {
      role: 'agent',
      text: `Removed ${c.id} (${c.name}) from ${planningTermLabel}.`,
    }]);
  };

  const applyUiActions = (actions) => {
    if (!Array.isArray(actions) || actions.length === 0) return;

    const addActions = actions.filter((action) => action.type === 'add_course' || action.type === 'replace_course');
    const lastAdded = addActions.length ? addActions[addActions.length - 1].courseId : null;

    setSchedule((current) => {
      let next = [...current];
      actions.forEach((action) => {
        const courseId = String(action.courseId || '').trim().toUpperCase();
        const removeCourseId = String(action.removeCourseId || '').trim().toUpperCase();
        if (!courseId && action.type !== 'replace_course') return;

        if (action.type === 'add_course' && !next.includes(courseId)) {
          next = [...next, courseId];
        }

        if (action.type === 'remove_course') {
          next = next.filter((id) => id !== courseId);
        }

        if (action.type === 'replace_course' && removeCourseId && courseId) {
          next = next.filter((id) => id !== removeCourseId);
          if (!next.includes(courseId)) next = [...next, courseId];
        }
      });
      return next;
    });

    if (lastAdded) {
      setJustAddedId(lastAdded);
      setTimeout(() => setJustAddedId(null), 800);
    }
  };

  const onOpenCourse = (id) => setRoute({ name: 'course', id });

  const containerRef = useRef(null);
  const STORAGE_KEY = 'fr-planner-pane-fractions-v1';
  const DEFAULTS = { left: 0.32, middle: 0.30 };
  const MIN_FRACTIONS = { left: 0.16, middle: 0.18, right: 0.20 };

  const [fractions, setFractions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.middle === 'number') return saved;
    } catch (_) {}
    return DEFAULTS;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fractions));
  }, [fractions]);

  const adjustFraction = useCallback((boundary, deltaPx) => {
    const total = containerRef.current ? containerRef.current.clientWidth : 1200;
    if (!total) return;
    const deltaFr = deltaPx / total;
    setFractions((current) => {
      const right = Math.max(0, 1 - current.left - current.middle);
      let { left, middle } = current;
      if (boundary === 'left-middle') {
        const next = Math.min(1 - MIN_FRACTIONS.middle - MIN_FRACTIONS.right, Math.max(MIN_FRACTIONS.left, left + deltaFr));
        const consumed = next - left;
        const newMiddle = Math.max(MIN_FRACTIONS.middle, middle - consumed);
        return { left: next, middle: newMiddle };
      }
      if (boundary === 'middle-right') {
        const newMiddle = Math.min(1 - MIN_FRACTIONS.left - MIN_FRACTIONS.right, Math.max(MIN_FRACTIONS.middle, middle + deltaFr));
        // right shrinks to absorb; left stays fixed
        const newRight = Math.max(MIN_FRACTIONS.right, right - (newMiddle - middle));
        // re-derive middle from the actual constrained right so totals stay consistent
        const realMiddle = Math.max(MIN_FRACTIONS.middle, 1 - left - newRight);
        return { left, middle: realMiddle };
      }
      return current;
    });
  }, []);

  const leftPct = `${(fractions.left * 100).toFixed(3)}%`;
  const middlePct = `${(fractions.middle * 100).toFixed(3)}%`;

  return (
    <div className="fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar planningTermLabel={planningTermLabel} />

      <div
        ref={containerRef}
        style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 'calc(100vh - 65px)' }}
      >
        {/* LEFT — schedule (course cards only) */}
        <div style={{ width: leftPct, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <SchedulePanel
            schedule={schedule} setSchedule={setSchedule}
            justAddedId={justAddedId} onOpenCourse={onOpenCourse}
            onAddCourse={onAddCourse} onRemoveCourse={onRemoveCourse}
            viewMode={viewMode} setViewMode={setViewMode}
            planningTermLabel={planningTermLabel}
            hideRequirements
          />
        </div>

        <ColumnResizer onDrag={(delta) => adjustFraction('left-middle', delta)} />

        {/* MIDDLE — course requirements */}
        <div style={{ width: middlePct, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <SectionHeader label="Course requirements" />
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', background: 'var(--bg)' }}>
            <RequirementsPanel schedule={schedule} />
          </div>
        </div>

        <ColumnResizer onDrag={(delta) => adjustFraction('middle-right', delta)} />

        {/* RIGHT — agent */}
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <AgentPanel
            messages={messages} setMessages={setMessages}
            profile={profile} schedule={schedule}
            onAddCourse={onAddCourse} onOpenCourse={onOpenCourse}
            onApplyUiActions={applyUiActions}
          />
        </div>

        {/*
          Recommendations panel hidden per product decision (kept for future use):
          <Recommendations schedule={schedule} onAddCourse={onAddCourse} onOpenCourse={onOpenCourse} />
        */}
      </div>
    </div>
  );
};

const App = () => {
  const freshProfile = () => ({
    name: '',
    kerberos: '',
    major: '',
    majorLabel: '',
    year: '',
    gradYear: '',
    taken: [],
    calibration: 1,
    preferences: {},
    remainingReqs: [],
  });
  const personalizeAgentMessages = (nextProfile) => {
    const firstName = String(nextProfile?.name || 'there').trim().split(/\s+/)[0] || 'there';
    return [{
      role: 'agent',
      text: `Hi ${firstName}. I can use your saved course history and preferences to help plan this active semester. Ask me for recommendations, workload checks, or course tradeoffs.`,
      suggestions: [],
    }];
  };
  const emptyFourYearPlan = () => Object.fromEntries((FRDATA.semesterOrder || []).map((id) => [id, []]));
  const mergePlanWithMarkdown = (plan, markdown) => {
    const parsedCourseIds = new Set(PersonalCourse.parseCourseRows(markdown || '').map((course) => course.id));
    const completedPlan = PersonalCourse.planFromCompletedCourses(markdown || '');
    const next = Object.fromEntries(Object.entries(plan || {}).map(([termId, courseIds]) => [
      termId,
      Array.isArray(courseIds) ? courseIds.filter((courseId) => !parsedCourseIds.has(PersonalCourse.normalizeCourseId(courseId))) : [],
    ]));
    Object.entries(completedPlan).forEach(([termId, courseIds]) => {
      const existing = Array.isArray(next[termId]) ? next[termId] : [];
      next[termId] = [...existing];
      courseIds.forEach((courseId) => {
        if (!next[termId].includes(courseId)) next[termId].push(courseId);
      });
    });
    return next;
  };
  const defaultActiveSem = FRDATA.defaultActiveSem || 'S25';
  const termOptions = FRDATA.termOptions || [{ id: defaultActiveSem, label: FRDATA.semesterLabels?.[defaultActiveSem] || defaultActiveSem }];
  const demoFourYearPlan = JSON.stringify({
    F23: ['6.100A', '18.02', '8.02', '21H.001'],
    S24: ['6.006', '18.06', '6.009'],
    F24: [],
    S25: [],
    F25: [],
    S26: [],
    F26: [],
    S27: [],
  });
  const isDemoFourYearPlan = (plan) => {
    if (!plan || typeof plan !== 'object') return false;
    const demo = JSON.parse(demoFourYearPlan);
    const comparable = {};
    Object.entries(plan).forEach(([term, courses]) => {
      if (!demo[term] && Array.isArray(courses) && courses.length) comparable[term] = courses;
    });
    Object.keys(demo).forEach((term) => {
      comparable[term] = Array.isArray(plan[term]) ? plan[term] : [];
    });
    return JSON.stringify(comparable) === demoFourYearPlan;
  };
  const deriveProfileFromMarkdown = (profile, markdown) => {
    const summary = PersonalCourse.summarize(markdown || '');
    const parsedCourseIds = new Set(summary.courses.map((course) => course.id));
    if (!summary.courses.length) return profile;
    const manualTaken = (profile.taken || []).filter((courseId) => !parsedCourseIds.has(PersonalCourse.normalizeCourseId(courseId)));
    return {
      ...profile,
      taken: [...new Set([...manualTaken, ...summary.completedCourseIds])],
      preferences: {
        ...(profile.preferences || {}),
        courseRatings: {
          ...(profile.preferences?.courseRatings || {}),
          ...summary.coursePreferences,
        },
      },
    };
  };
  const resolveSavedActiveSem = (saved) => {
    const savedActiveSem = saved?.activeSem;
    if (!savedActiveSem) return defaultActiveSem;
    const savedSchedule = saved?.fourYearPlan && Array.isArray(saved.fourYearPlan[savedActiveSem])
      ? saved.fourYearPlan[savedActiveSem]
      : [];
    if (savedActiveSem === 'S25' && defaultActiveSem !== 'S25' && savedSchedule.length === 0) {
      return defaultActiveSem;
    }
    return savedActiveSem;
  };
  const normalizeSavedFourYearPlan = (saved, activeSem, markdown = '') => {
    const base = emptyFourYearPlan();
    let plan = base;
    if (saved?.fourYearPlan && typeof saved.fourYearPlan === 'object') {
      plan = isDemoFourYearPlan(saved.fourYearPlan) ? base : { ...base, ...saved.fourYearPlan };
      return mergePlanWithMarkdown(plan, markdown);
    }
    if (Array.isArray(saved?.semesterPlan)) {
      plan = { ...base, [activeSem]: [...saved.semesterPlan] };
      return mergePlanWithMarkdown(plan, markdown);
    }
    return mergePlanWithMarkdown(base, markdown);
  };

  const [theme, setTheme] = useState(() => localStorage.getItem('fr-theme') || 'light');
  const [route, setRoute] = useState({ name: 'onboarding' });
  const [profile, setProfile] = useState(freshProfile);
  const [personalCourseMarkdown, setPersonalCourseMarkdown] = useState(() => localStorage.getItem('fr-personalcourse-draft') || '');
  const [fourYearPlan, setFourYearPlan] = useState(emptyFourYearPlan);
  const [activeSem, setActiveSem] = useState(defaultActiveSem);
  const [messages, setMessages] = useState(() => personalizeAgentMessages(freshProfile()));
  const [authState, setAuthState] = useState(() => FRAuth.getState());
  const [dataReady, setDataReady] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [saveState, setSaveState] = useState('idle');

  useEffect(() => {
    const unsubscribe = FRAuth.subscribe(setAuthState);
    FRAuth.init();
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (authState.status !== 'signedIn') {
      setDataReady(false);
      setOnboardingCompleted(false);
      return () => { cancelled = true; };
    }

    setDataReady(false);
    FRAuth.loadUserData()
      .then((saved) => {
        if (cancelled) return;
        const completed = Boolean(saved?.onboardingCompleted);
        const baseProfile = freshProfile();
        const onboardingName = typeof saved?.onboarding?.name === 'string' ? saved.onboarding.name.trim() : '';
        let nextProfile = saved?.profile ? {
          ...baseProfile,
          ...saved.profile,
          name: saved.profile.name === 'Alex Chen'
            ? (onboardingName || authState.user.email.split('@')[0])
            : (saved.profile.name || onboardingName || authState.user.email.split('@')[0]),
          taken: [...(saved.profile.taken || [])],
          preferences: { ...(saved.profile.preferences || {}) },
          remainingReqs: Array.isArray(saved.profile.remainingReqs) ? saved.profile.remainingReqs : [],
        } : {
          ...baseProfile,
          name: authState.user.email.split('@')[0],
        };

        const nextActiveSem = resolveSavedActiveSem(saved);
        const nextPersonalCourseMarkdown = typeof saved?.personalCourseMarkdown === 'string'
          ? saved.personalCourseMarkdown
          : (saved?.onboarding?.personalCourseMarkdown
            || localStorage.getItem('fr-personalcourse-draft')
            || '');
        nextProfile = deriveProfileFromMarkdown(nextProfile, nextPersonalCourseMarkdown);
        setProfile(nextProfile);
        setPersonalCourseMarkdown(nextPersonalCourseMarkdown);
        if (nextPersonalCourseMarkdown) localStorage.setItem('fr-personalcourse-draft', nextPersonalCourseMarkdown);
        setMessages(personalizeAgentMessages(nextProfile));
        setActiveSem(nextActiveSem);
        setFourYearPlan(normalizeSavedFourYearPlan(saved, nextActiveSem, nextPersonalCourseMarkdown));
        setOnboardingCompleted(completed);
        setRoute({ name: completed ? 'planner' : 'onboarding' });
        setDataReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        const nextProfile = { ...freshProfile(), name: authState.user.email.split('@')[0] };
        const nextPersonalCourseMarkdown = localStorage.getItem('fr-personalcourse-draft') || '';
        setProfile(deriveProfileFromMarkdown(nextProfile, nextPersonalCourseMarkdown));
        setPersonalCourseMarkdown(nextPersonalCourseMarkdown);
        setMessages(personalizeAgentMessages(nextProfile));
        setActiveSem(defaultActiveSem);
        setFourYearPlan(emptyFourYearPlan());
        setOnboardingCompleted(false);
        setRoute({ name: 'onboarding' });
        setDataReady(true);
      });

    return () => { cancelled = true; };
  }, [authState.status, authState.user?.uid]);

  const schedule = fourYearPlan[activeSem] || [];
  const planningTermLabel = FRDATA.semesterLabels?.[activeSem] || FRDATA.planningTermLabel || activeSem;
  const setSchedule = (updater) => setFourYearPlan((currentPlan) => {
    const currentSchedule = currentPlan[activeSem] || [];
    const nextSchedule = typeof updater === 'function' ? updater(currentSchedule) : updater;
    return { ...currentPlan, [activeSem]: nextSchedule };
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fr-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (authState.status !== 'signedIn' || !dataReady) return undefined;
    const timer = setTimeout(() => {
      setSaveState('saving');
      FRAuth.saveUserData({
        onboardingCompleted,
        profile,
        personalCourseMarkdown,
        fourYearPlan,
        activeSem,
      }).then(() => {
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1000);
      }).catch((err) => {
        console.error(err);
        setSaveState('error');
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [authState.status, dataReady, onboardingCompleted, profile, personalCourseMarkdown, fourYearPlan, activeSem]);

  const addCourse = (id) => {
    if (schedule.includes(id)) return;
    setSchedule((s) => [...s, id]);
  };

  const completeOnboarding = async ({ profile: nextProfile, onboarding, personalCourseMarkdown }) => {
    const hydratedProfile = deriveProfileFromMarkdown(nextProfile, personalCourseMarkdown);
    const hydratedFourYearPlan = mergePlanWithMarkdown(fourYearPlan, personalCourseMarkdown);
    setOnboardingCompleted(true);
    setProfile(hydratedProfile);
    setPersonalCourseMarkdown(personalCourseMarkdown || '');
    setFourYearPlan(hydratedFourYearPlan);
    if (personalCourseMarkdown) localStorage.setItem('fr-personalcourse-draft', personalCourseMarkdown);
    setMessages(personalizeAgentMessages(hydratedProfile));
    setRoute({ name: 'planner' });
    setSaveState('saving');
    try {
      await FRAuth.saveUserData({
        onboardingCompleted: true,
        profile: hydratedProfile,
        fourYearPlan: hydratedFourYearPlan,
        activeSem,
        onboarding,
        personalCourseMarkdown,
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1000);
    } catch (err) {
      console.error(err);
      setSaveState('error');
    }
  };

  const resetOnboarding = async () => {
    await FRAuth.resetUserData();
    const nextProfile = { ...freshProfile(), name: authState.user?.email?.split('@')[0] || '' };
    setProfile(nextProfile);
    setPersonalCourseMarkdown('');
    localStorage.removeItem('fr-personalcourse-draft');
    setMessages(personalizeAgentMessages(nextProfile));
    setActiveSem(defaultActiveSem);
    setFourYearPlan(emptyFourYearPlan());
    setOnboardingCompleted(false);
    setRoute({ name: 'onboarding' });
  };

  const reparseTranscript = async () => {
    const parsedCourseIds = new Set(PersonalCourse.parseCourseRows(personalCourseMarkdown || '').map((course) => course.id));
    const nextProfile = {
      ...profile,
      taken: (profile.taken || []).filter((courseId) => !parsedCourseIds.has(PersonalCourse.normalizeCourseId(courseId))),
    };
    const nextFourYearPlan = Object.fromEntries(Object.entries(fourYearPlan || {}).map(([termId, courseIds]) => [
      termId,
      Array.isArray(courseIds) ? courseIds.filter((courseId) => !parsedCourseIds.has(PersonalCourse.normalizeCourseId(courseId))) : [],
    ]));
    setProfile(nextProfile);
    setPersonalCourseMarkdown('');
    localStorage.removeItem('fr-personalcourse-draft');
    setFourYearPlan(nextFourYearPlan);
    setOnboardingCompleted(false);
    setRoute({ name: 'onboarding' });
    setSaveState('saving');
    try {
      await FRAuth.saveUserData({
        onboardingCompleted: false,
        profile: nextProfile,
        fourYearPlan: nextFourYearPlan,
        activeSem,
        onboarding: null,
        personalCourseMarkdown: '',
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1000);
    } catch (err) {
      console.error(err);
      setSaveState('error');
    }
  };

  const ctx = {
    theme, setTheme, route, setRoute, profile, setProfile, personalCourseMarkdown, setPersonalCourseMarkdown, fourYearPlan, setFourYearPlan, activeSem, setActiveSem, termOptions, planningTermLabel,
    authState, dataReady, onboardingCompleted, saveState,
    completeOnboarding, resetOnboarding, reparseTranscript, signOut: FRAuth.signOut,
  };

  return (
    <AppCtx.Provider value={ctx}>
      <AuthGate authState={authState}>
        {!dataReady ? (
          <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>
            Loading your Fireroad data...
          </div>
        ) : (
          <>
            {route.name === 'onboarding' && <Onboarding />}
            {route.name === 'planner' && (
              <Planner schedule={schedule} setSchedule={setSchedule} messages={messages} setMessages={setMessages} planningTermLabel={planningTermLabel} />
            )}
            {route.name === 'course' && (
              <CourseDetail
                courseId={route.id}
                inSchedule={schedule.includes(route.id)}
                onBack={() => setRoute({ name: 'planner' })}
                onAdd={addCourse}
              />
            )}
            {route.name === 'profile' && <ProfilePage />}
            {route.name === 'fouryear' && <FourYearPlanPage />}
            {route.name === 'priorcredit' && <PriorCreditPage />}
          </>
        )}
      </AuthGate>
    </AppCtx.Provider>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

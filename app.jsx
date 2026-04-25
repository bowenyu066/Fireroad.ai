/* global React, ReactDOM, FRDATA, FRAuth, AuthGate, Onboarding, ProfilePage, TopBar, SchedulePanel, AgentPanel, Recommendations, CourseDetail, AppCtx */
const { useState, useEffect } = React;

const Planner = ({ schedule, setSchedule, messages, setMessages, planningTermLabel }) => {
  const { setRoute, profile } = React.useContext(AppCtx);
  const [justAddedId, setJustAddedId] = useState(null);
  const [viewMode, setViewMode] = useState('list');

  const onAddCourse = async (id) => {
    if (schedule.includes(id)) return;
    const c = await FRDATA.fetchCurrentCourse(id);
    if (!c) return;
    const newUnits = schedule.reduce((s, x) => s + (FRDATA.getCourse(x)?.units || 0), 0) + c.units;
    setSchedule((s) => [...s, id]);
    setJustAddedId(id);
    setTimeout(() => setJustAddedId(null), 800);
    setMessages((m) => [...m, {
      role: 'agent',
      text: `Added ${c.id} (${c.name}) to ${planningTermLabel}. You're at about ${newUnits} units. Want me to suggest something to balance the workload?`,
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

  return (
    <div className="fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar planningTermLabel={planningTermLabel} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 'calc(100vh - 65px)' }}>
        <div style={{ flex: '1.3', borderRight: '1px solid var(--border)', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <SchedulePanel
            schedule={schedule} setSchedule={setSchedule}
            justAddedId={justAddedId} onOpenCourse={onOpenCourse}
            viewMode={viewMode} setViewMode={setViewMode}
            planningTermLabel={planningTermLabel}
          />
        </div>
        <div style={{ flex: '1', minWidth: 380, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '1 1 0', minHeight: 0, borderBottom: '1px solid var(--border)' }}>
            <AgentPanel
              messages={messages} setMessages={setMessages}
              profile={profile} schedule={schedule}
              onAddCourse={onAddCourse} onOpenCourse={onOpenCourse}
              onApplyUiActions={applyUiActions}
            />
          </div>
          <div style={{ flex: '1 1 0', minHeight: 0 }}>
            <Recommendations schedule={schedule} onAddCourse={onAddCourse} onOpenCourse={onOpenCourse} />
          </div>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const freshProfile = () => ({
    ...FRDATA.profile,
    taken: [...FRDATA.profile.taken],
    preferences: { ...FRDATA.profile.preferences },
  });
  const personalizeAgentMessages = (nextProfile) => {
    const firstName = String(nextProfile?.name || 'there').trim().split(/\s+/)[0] || 'there';
    return FRDATA.agentMessages.map((message) => ({
      ...message,
      text: String(message.text || '').replace(/\bAlex\b/g, firstName),
    }));
  };
  const freshFourYearPlan = () => JSON.parse(JSON.stringify(FRDATA.fourYearPlan || {}));
  const defaultActiveSem = FRDATA.defaultActiveSem || 'S25';
  const normalizeSavedFourYearPlan = (saved, activeSem) => {
    const base = freshFourYearPlan();
    if (saved?.fourYearPlan && typeof saved.fourYearPlan === 'object') {
      return { ...base, ...saved.fourYearPlan };
    }
    if (Array.isArray(saved?.semesterPlan)) {
      return { ...base, [activeSem]: [...saved.semesterPlan] };
    }
    return base;
  };

  const [theme, setTheme] = useState(() => localStorage.getItem('fr-theme') || 'light');
  const [route, setRoute] = useState({ name: 'onboarding' });
  const [profile, setProfile] = useState(freshProfile);
  const [fourYearPlan, setFourYearPlan] = useState(freshFourYearPlan);
  const [activeSem, setActiveSem] = useState(defaultActiveSem);
  const [messages, setMessages] = useState(FRDATA.agentMessages);
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
        const nextProfile = saved?.profile ? {
          ...baseProfile,
          ...saved.profile,
          name: saved.profile.name === baseProfile.name && onboardingName ? onboardingName : saved.profile.name,
          taken: [...(saved.profile.taken || [])],
          preferences: { ...baseProfile.preferences, ...(saved.profile.preferences || {}) },
        } : {
          ...baseProfile,
          name: authState.user.email.split('@')[0],
        };

        const nextActiveSem = saved?.activeSem || defaultActiveSem;
        setProfile(nextProfile);
        setMessages(personalizeAgentMessages(nextProfile));
        setActiveSem(nextActiveSem);
        setFourYearPlan(normalizeSavedFourYearPlan(saved, nextActiveSem));
        setOnboardingCompleted(completed);
        setRoute({ name: completed ? 'planner' : 'onboarding' });
        setDataReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        const nextProfile = { ...freshProfile(), name: authState.user.email.split('@')[0] };
        setProfile(nextProfile);
        setMessages(personalizeAgentMessages(nextProfile));
        setActiveSem(defaultActiveSem);
        setFourYearPlan(freshFourYearPlan());
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
  }, [authState.status, dataReady, onboardingCompleted, profile, fourYearPlan, activeSem]);

  const addCourse = (id) => {
    if (schedule.includes(id)) return;
    setSchedule((s) => [...s, id]);
  };

  const completeOnboarding = async ({ profile: nextProfile, onboarding, personalCourseMarkdown }) => {
    setOnboardingCompleted(true);
    setProfile(nextProfile);
    setMessages(personalizeAgentMessages(nextProfile));
    setRoute({ name: 'planner' });
    setSaveState('saving');
    try {
      await FRAuth.saveUserData({
        onboardingCompleted: true,
        profile: nextProfile,
        fourYearPlan,
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
    setMessages(personalizeAgentMessages(nextProfile));
    setActiveSem(defaultActiveSem);
    setFourYearPlan(freshFourYearPlan());
    setOnboardingCompleted(false);
    setRoute({ name: 'onboarding' });
  };

  const ctx = {
    theme, setTheme, route, setRoute, profile, setProfile, fourYearPlan, setFourYearPlan, activeSem, setActiveSem, planningTermLabel,
    authState, dataReady, onboardingCompleted, saveState,
    completeOnboarding, resetOnboarding, signOut: FRAuth.signOut,
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
          </>
        )}
      </AuthGate>
    </AppCtx.Provider>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

/* global React, Icon, Logo, ThemeToggle, useApp, FRAuth */
const { useState: useAuthState } = React;

const AuthGate = ({ authState, children }) => {
  const [view, setView] = useAuthState('landing');

  if (authState.status === 'loading') {
    return <AuthShell><AuthLoading /></AuthShell>;
  }

  if (authState.status !== 'signedIn') {
    if (view === 'landing') {
      return <Landing onStart={() => setView('auth')} />;
    }
    return <AuthShell onBack={() => setView('landing')}><AuthForm /></AuthShell>;
  }

  if (FRAuth.options.requireEmailVerification && !authState.usingMock && !authState.user.emailVerified) {
    return <AuthShell><VerifyEmail user={authState.user} /></AuthShell>;
  }

  return children;
};

const AuthShell = ({ children, onBack }) => (
  <div className="fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '20px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Logo />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <button
            onClick={onBack}
            className="btn-ghost"
            style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '6px 10px', borderRadius: 8 }}
          >
            ← Back to overview
          </button>
        )}
        <ThemeToggle />
      </div>
    </div>
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '32px 24px 72px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {children}
      </div>
    </div>
  </div>
);

const AuthLoading = () => (
  <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
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
    <div>Checking session...</div>
  </div>
);

const AuthForm = () => {
  const [mode, setMode] = useAuthState('signin');
  const [email, setEmail] = useAuthState('');
  const [password, setPassword] = useAuthState('');
  const [busy, setBusy] = useAuthState(false);
  const [error, setError] = useAuthState('');

  const isSignup = mode === 'signup';
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isSignup) await FRAuth.signUp(email, password);
      else await FRAuth.signIn(email, password);
    } catch (err) {
      setError(err.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      background: 'var(--surface)',
      padding: 28,
    }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{FRAuth.getState().usingMock ? 'Local test auth' : 'MIT email login'}</div>
      <h1 className="display" style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: 0 }}>
        {isSignup ? 'Create your Fireroad.ai account' : 'Welcome back'}
      </h1>
      <p style={{ margin: '10px 0 24px', color: 'var(--text-secondary)' }}>
        Use an MIT email and password so your onboarding data can be restored next time.
      </p>

      <AuthField label="Email">
        <input
          type="email"
          autoComplete="email"
          placeholder="you@mit.edu"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={authInputStyle}
        />
      </AuthField>
      <AuthField label="Password">
        <input
          type="password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          placeholder="At least 6 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={authInputStyle}
        />
      </AuthField>

      {error && (
        <div style={{
          padding: '10px 12px',
          borderRadius: 'var(--r-md)',
          border: '1px solid rgba(163, 31, 52, 0.35)',
          background: 'var(--accent-soft)',
          color: 'var(--text)',
          fontSize: 13,
          marginBottom: 14,
        }}>
          {error}
        </div>
      )}

      <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', padding: 12, opacity: busy ? 0.65 : 1 }}>
        {busy ? 'Working...' : isSignup ? 'Create account' : 'Sign in'}
      </button>
      <button
        className="btn btn-ghost"
        type="button"
        onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setError(''); }}
        style={{ width: '100%', marginTop: 10, padding: 10 }}
      >
        {isSignup ? 'I already have an account' : 'Create a new account'}
      </button>

      {FRAuth.getState().usingMock && (
        <p style={{ margin: '16px 0 0', color: 'var(--text-tertiary)', fontSize: 12 }}>
          Firebase config is not set, so this branch is using localStorage-backed test auth.
        </p>
      )}
    </form>
  );
};

const VerifyEmail = ({ user }) => {
  const [sent, setSent] = useAuthState(false);
  const [error, setError] = useAuthState('');
  const send = async () => {
    setError('');
    try {
      await FRAuth.resendVerification();
      setSent(true);
    } catch (err) {
      setError(err.message || 'Could not send verification email.');
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 28 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Email verification</div>
      <h1 className="display" style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: 0 }}>Check your MIT email</h1>
      <p style={{ margin: '10px 0 22px', color: 'var(--text-secondary)' }}>
        Verify {user.email} before continuing. Refresh after clicking the verification link.
      </p>
      {error && <p style={{ color: 'var(--accent)' }}>{error}</p>}
      {sent && <p style={{ color: 'var(--text-secondary)' }}>Verification email sent.</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={send}>Resend email</button>
        <button className="btn" onClick={() => window.location.reload()}>Refresh</button>
        <button className="btn btn-ghost" onClick={() => FRAuth.signOut()}>Sign out</button>
      </div>
    </div>
  );
};

const AuthField = ({ label, children }) => (
  <label style={{ display: 'block', marginBottom: 14 }}>
    <span style={{ display: 'block', marginBottom: 7, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase' }}>{label}</span>
    {children}
  </label>
);

const authInputStyle = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  fontSize: 14,
};

// ============== Landing / marketing page ==============
const DIFFERENTIATORS = [
  {
    eyebrow: 'Generic AI',
    headline: "ChatGPT doesn't know your degree audit.",
    body: 'A generic LLM can suggest classes, but it cannot tell you whether 6.4610 finishes your CI-M or whether dropping 8.231 leaves you a HASS short. Fireroad.ai runs the official MIT requirement checker on every recommendation, so each suggestion actually moves your degree forward.',
    icon: 'sparkle',
  },
  {
    eyebrow: 'Scattered information',
    headline: 'Course information lives in five tabs.',
    body: 'Subject listings, evaluations, prereqs, the registrar, the calendar — every plan today means tabbing between sites and re-typing your transcript. Fireroad.ai pulls the live catalog, your transcript, and your major into one chat, so the agent already has the full picture.',
    icon: 'book',
  },
  {
    eyebrow: 'Manual planners',
    headline: 'CourseRoad and Hydrant make you do the work.',
    body: 'CourseRoad lets you sketch a four-year plan but does not recommend. Hydrant lets you build a calendar but does not plan. Both want you to type every course yourself. Fireroad.ai starts from your real history, recommends, and edits the schedule when you say "swap 8.04 for 8.05."',
    icon: 'grid',
  },
];

const DifferentiatorCard = ({ eyebrow, headline, body, icon }) => (
  <div style={{
    padding: 28,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    transition: 'border-color 160ms, transform 160ms',
  }}
  onMouseEnter={(event) => {
    event.currentTarget.style.borderColor = 'var(--border-strong)';
    event.currentTarget.style.transform = 'translateY(-2px)';
  }}
  onMouseLeave={(event) => {
    event.currentTarget.style.borderColor = 'var(--border)';
    event.currentTarget.style.transform = 'translateY(0)';
  }}
  >
    <div style={{
      width: 38, height: 38, borderRadius: 10,
      background: 'var(--accent-soft)',
      border: '1px solid var(--accent)',
      color: 'var(--accent)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon name={icon} size={18} />
    </div>
    <div className="eyebrow">{eyebrow}</div>
    <h3 className="display" style={{ margin: 0, fontSize: 19, fontWeight: 600, lineHeight: 1.3 }}>
      {headline}
    </h3>
    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
      {body}
    </p>
  </div>
);

const Landing = ({ onStart }) => (
  <div className="fade-in" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
    {/* Top nav */}
    <nav style={{
      padding: '20px 40px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: '1px solid var(--border)',
    }}>
      <Logo />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ThemeToggle />
        <button
          onClick={onStart}
          className="btn btn-primary"
          style={{ padding: '9px 18px' }}
        >
          Sign in
        </button>
      </div>
    </nav>

    {/* Hero */}
    <section style={{
      padding: '88px 40px 56px',
      maxWidth: 980,
      width: '100%',
      margin: '0 auto',
      textAlign: 'center',
    }}>
      <div className="eyebrow" style={{ marginBottom: 18, color: 'var(--accent)' }}>
        For MIT undergraduates
      </div>
      <h1 className="display" style={{
        margin: 0,
        fontSize: 56,
        fontWeight: 600,
        lineHeight: 1.08,
        letterSpacing: '-0.025em',
      }}>
        Plan your MIT semester with an agent that{' '}
        <span style={{ color: 'var(--accent)' }}>actually knows MIT.</span>
      </h1>
      <p style={{
        margin: '26px auto 36px',
        maxWidth: 640,
        fontSize: 18,
        lineHeight: 1.6,
        color: 'var(--text-secondary)',
      }}>
        Upload your transcript once. Fireroad reads your history, tracks every degree
        requirement, and recommends courses that fit your major, your workload, and your time.
      </p>
      <div style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={onStart}
          className="btn btn-primary"
          style={{ padding: '14px 26px', fontSize: 15 }}
        >
          Get started →
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          Free for MIT students · Sign in with your <span className="mono">@mit.edu</span>
        </span>
      </div>
    </section>

    {/* Differentiators */}
    <section style={{
      padding: '40px 40px 80px',
      maxWidth: 1180,
      width: '100%',
      margin: '0 auto',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Why Fireroad.ai</div>
        <h2 className="display" style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: '-0.015em' }}>
          The tools you have today don't work for MIT.
        </h2>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 20,
      }}>
        {DIFFERENTIATORS.map((card) => (
          <DifferentiatorCard key={card.eyebrow} {...card} />
        ))}
      </div>
    </section>

    {/* Bottom CTA */}
    <section style={{
      padding: '64px 40px 96px',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface)',
      textAlign: 'center',
    }}>
      <h2 className="display" style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: '-0.015em' }}>
        Ready to plan smarter?
      </h2>
      <p style={{ margin: '12px 0 26px', color: 'var(--text-secondary)', fontSize: 15 }}>
        Sign in with your MIT email. Onboarding takes about a minute.
      </p>
      <button
        onClick={onStart}
        className="btn btn-primary"
        style={{ padding: '14px 28px', fontSize: 15 }}
      >
        Sign in to get started →
      </button>
    </section>
  </div>
);

window.AuthGate = AuthGate;

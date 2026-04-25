/* global React, Icon, Logo, ThemeToggle, useApp, FRAuth */
const { useState: useAuthState } = React;

const AuthGate = ({ authState, children }) => {
  if (authState.status === 'loading') {
    return <AuthShell><AuthLoading /></AuthShell>;
  }

  if (authState.status !== 'signedIn') {
    return <AuthShell><AuthForm /></AuthShell>;
  }

  if (FRAuth.options.requireEmailVerification && !authState.usingMock && !authState.user.emailVerified) {
    return <AuthShell><VerifyEmail user={authState.user} /></AuthShell>;
  }

  return children;
};

const AuthShell = ({ children }) => (
  <div className="fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '20px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Logo />
      <ThemeToggle />
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
        {isSignup ? 'Create your Fireroad account' : 'Welcome back'}
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

window.AuthGate = AuthGate;

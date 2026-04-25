/* global FIREBASE_CONFIG, FIREBASE_AUTH_OPTIONS */
(function () {
  const FIREBASE_VERSION = '10.12.5';
  const LOCAL_SESSION_KEY = 'fr-auth-session';
  const LOCAL_USERS_KEY = 'fr-auth-users';
  const USER_DOC_VERSION = 1;

  const defaultOptions = {
    requireMitEmail: true,
    allowNonMitEmails: false,
    requireEmailVerification: false,
  };
  const options = { ...defaultOptions, ...(window.FIREBASE_AUTH_OPTIONS || {}) };
  const hasFirebaseConfig = Boolean(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && window.FIREBASE_CONFIG.projectId);

  let state = {
    status: 'loading',
    user: null,
    usingMock: !hasFirebaseConfig,
    firebaseReady: false,
    error: null,
  };
  const listeners = new Set();
  let firebaseApi = null;
  let firebaseReadyPromise = null;
  let unsubscribeFirebase = null;

  const emit = () => listeners.forEach((listener) => listener(state));
  const setState = (patch) => {
    state = { ...state, ...patch };
    emit();
  };

  const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
  const isMitEmail = (email) => normalizeEmail(email).endsWith('@mit.edu');
  const shouldAllowEmail = (email) => !options.requireMitEmail || options.allowNonMitEmails || isMitEmail(email);
  const emailError = (email) => shouldAllowEmail(email) ? null : 'Use an @mit.edu email address.';

  const toPublicUser = (user, source = 'firebase') => ({
    uid: user.uid,
    email: normalizeEmail(user.email),
    emailVerified: source === 'mock' ? true : Boolean(user.emailVerified),
    source,
  });

  const readLocalUsers = () => {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '{}');
    } catch (err) {
      return {};
    }
  };

  const writeLocalUsers = (users) => {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  };

  const localUid = (email) => `mock:${normalizeEmail(email)}`;

  const requireSignedIn = () => {
    if (!state.user) throw new Error('You must be signed in first.');
    return state.user;
  };

  async function loadFirebase() {
    if (!hasFirebaseConfig) return null;
    if (firebaseReadyPromise) return firebaseReadyPromise;

    firebaseReadyPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
    ]).then(([appMod, authMod, firestoreMod]) => {
      const app = appMod.initializeApp(window.FIREBASE_CONFIG);
      firebaseApi = {
        auth: authMod.getAuth(app),
        db: firestoreMod.getFirestore(app),
        authMod,
        firestoreMod,
      };
      setState({ firebaseReady: true, usingMock: false });
      return firebaseApi;
    }).catch((err) => {
      setState({ status: 'signedOut', usingMock: true, firebaseReady: false, error: err.message });
      return null;
    });

    return firebaseReadyPromise;
  }

  const firestoreUserRef = (uid) => {
    const { firestoreMod, db } = firebaseApi;
    return firestoreMod.doc(db, 'users', uid);
  };

  async function init() {
    if (!hasFirebaseConfig) {
      const email = localStorage.getItem(LOCAL_SESSION_KEY);
      setState({
        status: email ? 'signedIn' : 'signedOut',
        user: email ? toPublicUser({ uid: localUid(email), email }, 'mock') : null,
        usingMock: true,
        firebaseReady: false,
        error: null,
      });
      return;
    }

    const api = await loadFirebase();
    if (!api) return;

    if (unsubscribeFirebase) unsubscribeFirebase();
    unsubscribeFirebase = api.authMod.onAuthStateChanged(api.auth, (user) => {
      setState({
        status: user ? 'signedIn' : 'signedOut',
        user: user ? toPublicUser(user, 'firebase') : null,
        error: null,
      });
    });
  }

  async function signUp(email, password) {
    const normalized = normalizeEmail(email);
    const domainError = emailError(normalized);
    if (domainError) throw new Error(domainError);
    if (!password || password.length < 6) throw new Error('Use a password with at least 6 characters.');

    if (!hasFirebaseConfig || state.usingMock) {
      const users = readLocalUsers();
      if (users[normalized]) throw new Error('This email already has a local test account.');
      users[normalized] = {
        uid: localUid(normalized),
        email: normalized,
        password,
        data: null,
        createdAt: new Date().toISOString(),
      };
      writeLocalUsers(users);
      localStorage.setItem(LOCAL_SESSION_KEY, normalized);
      setState({ status: 'signedIn', user: toPublicUser(users[normalized], 'mock'), error: null });
      return state.user;
    }

    const api = await loadFirebase();
    const result = await api.authMod.createUserWithEmailAndPassword(api.auth, normalized, password);
    if (options.requireEmailVerification && !result.user.emailVerified) {
      await api.authMod.sendEmailVerification(result.user);
    }
    return toPublicUser(result.user, 'firebase');
  }

  async function signIn(email, password) {
    const normalized = normalizeEmail(email);
    const domainError = emailError(normalized);
    if (domainError) throw new Error(domainError);

    if (!hasFirebaseConfig || state.usingMock) {
      const users = readLocalUsers();
      const account = users[normalized];
      if (!account || account.password !== password) throw new Error('Email or password is incorrect.');
      localStorage.setItem(LOCAL_SESSION_KEY, normalized);
      setState({ status: 'signedIn', user: toPublicUser(account, 'mock'), error: null });
      return state.user;
    }

    const api = await loadFirebase();
    const result = await api.authMod.signInWithEmailAndPassword(api.auth, normalized, password);
    if (options.requireEmailVerification && !result.user.emailVerified) {
      throw new Error('Please verify your MIT email before continuing.');
    }
    return toPublicUser(result.user, 'firebase');
  }

  async function signOut() {
    if (!hasFirebaseConfig || state.usingMock) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
      setState({ status: 'signedOut', user: null, error: null });
      return;
    }
    const api = await loadFirebase();
    await api.authMod.signOut(api.auth);
  }

  async function resendVerification() {
    if (!hasFirebaseConfig || state.usingMock) return;
    const api = await loadFirebase();
    if (!api.auth.currentUser) throw new Error('You must be signed in first.');
    await api.authMod.sendEmailVerification(api.auth.currentUser);
  }

  async function loadUserData() {
    const user = requireSignedIn();
    if (!hasFirebaseConfig || state.usingMock) {
      const users = readLocalUsers();
      return users[user.email]?.data || null;
    }

    const api = await loadFirebase();
    const snap = await api.firestoreMod.getDoc(firestoreUserRef(user.uid));
    return snap.exists() ? snap.data() : null;
  }

  async function saveUserData(data) {
    const user = requireSignedIn();
    const payload = {
      ...data,
      schemaVersion: USER_DOC_VERSION,
      email: user.email,
      updatedAtClient: new Date().toISOString(),
    };

    if (!hasFirebaseConfig || state.usingMock) {
      const users = readLocalUsers();
      if (!users[user.email]) {
        users[user.email] = { uid: user.uid, email: user.email, password: '', createdAt: new Date().toISOString() };
      }
      users[user.email].data = payload;
      writeLocalUsers(users);
      return payload;
    }

    const api = await loadFirebase();
    await api.firestoreMod.setDoc(firestoreUserRef(user.uid), {
      ...payload,
      updatedAt: api.firestoreMod.serverTimestamp(),
    }, { merge: true });
    return payload;
  }

  async function resetUserData() {
    const user = requireSignedIn();
    if (!hasFirebaseConfig || state.usingMock) {
      const users = readLocalUsers();
      if (users[user.email]) {
        users[user.email].data = null;
        writeLocalUsers(users);
      }
      return;
    }

    const api = await loadFirebase();
    await api.firestoreMod.setDoc(firestoreUserRef(user.uid), {
      onboardingCompleted: false,
      profile: null,
      fourYearPlan: null,
      activeSem: null,
      onboarding: null,
      personalCourseMarkdown: null,
      resetAt: api.firestoreMod.serverTimestamp(),
    }, { merge: true });
  }

  window.FRAuth = {
    options,
    hasFirebaseConfig,
    init,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    signUp,
    signIn,
    signOut,
    resendVerification,
    loadUserData,
    saveUserData,
    resetUserData,
    isMitEmail,
  };
})();

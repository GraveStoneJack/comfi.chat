import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const SESSION_TOKEN = 'authToken';
const SESSION_USER = 'user';
const PENDING_TOKEN = 'pendingTempToken';

const genderOptions = ['male', 'female', 'non-binary', 'other', 'prefer not to say'];
const sexualityOptions = ['straight', 'gay', 'lesbian', 'bisexual', 'other', 'prefer not to say'];
const hairTypeOptions = ['straight', 'wavy', 'curly', 'coily', 'other'];
const hairColorOptions = ['black', 'brown', 'blonde', 'red', 'grey', 'white', 'other'];
const eyeColorOptions = ['brown', 'blue', 'green', 'hazel', 'grey', 'other'];
const ethnicityOptions = ['asian', 'black', 'hispanic', 'white', 'mixed', 'other'];
const lookingForOptions = ['friendship', 'dating', 'relationship', 'casual', 'networking'];

function getSession() {
  try {
    return {
      token: sessionStorage.getItem(SESSION_TOKEN),
      user: JSON.parse(sessionStorage.getItem(SESSION_USER) || 'null')
    };
  } catch (_) {
    return { token: null, user: null };
  }
}

function saveSession({ token, user }) {
  sessionStorage.setItem(SESSION_TOKEN, token);
  sessionStorage.setItem(SESSION_USER, JSON.stringify(user));
  sessionStorage.setItem('tempUser', JSON.stringify({ username: user.username }));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_TOKEN);
  sessionStorage.removeItem(SESSION_USER);
  sessionStorage.removeItem('tempUser');
}

async function api(path, options = {}) {
  const headers = options.body instanceof FormData
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error((payload && payload.error) || payload || 'Request failed');
  }
  return payload;
}

function authHeaders() {
  const token = sessionStorage.getItem(SESSION_TOKEN);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function navigate(path) {
  history.pushState({}, '', path);
  window.dispatchEvent(new Event('comfi:navigate'));
}

function useRoute() {
  const [route, setRoute] = useState({ path: location.pathname, search: location.search });
  useEffect(() => {
    const update = () => setRoute({ path: location.pathname, search: location.search });
    window.addEventListener('popstate', update);
    window.addEventListener('comfi:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('comfi:navigate', update);
    };
  }, []);
  return route;
}

function useTheme() {
  const [mode, setMode] = useState(localStorage.getItem('comfi.theme') || 'auto');
  useEffect(() => {
    const resolved = mode === 'auto' && window.matchMedia
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    document.body.classList.toggle('dark', resolved === 'dark');
    localStorage.setItem('comfi.theme', mode);
  }, [mode]);
  return [mode, setMode];
}

function cycleTheme(mode) {
  if (mode === 'auto') return 'light';
  if (mode === 'light') return 'dark';
  return 'auto';
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, char => char.toUpperCase());
}

function SelectField({ label, name, value, onChange, options, required = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} value={value || ''} onChange={onChange} required={required}>
        <option value="">Select</option>
        {options.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
      </select>
    </label>
  );
}

function Shell({ children, session, onLogout }) {
  const [themeMode, setThemeMode] = useTheme();
  const resolvedLabel = themeMode === 'auto' ? 'Auto' : titleCase(themeMode);
  return (
    <div className="app-frame">
      <button className="theme-toggle-btn" onClick={() => setThemeMode(cycleTheme(themeMode))}>
        {resolvedLabel}
      </button>
      <main className="app-card">
        <nav className="top-nav">
          <button className="brand-link" onClick={() => navigate('/app')}>ComfiChat</button>
          <div className="nav-actions">
            {session.user ? (
              <>
                <button onClick={() => navigate('/profile')}>Profile</button>
                <button onClick={onLogout}>Logout</button>
              </>
            ) : (
              <>
                <button onClick={() => navigate('/signup')}>Sign up</button>
                <button onClick={() => navigate('/login')}>Sign in</button>
              </>
            )}
          </div>
        </nav>
        {children}
      </main>
    </div>
  );
}

function Welcome({ session }) {
  return (
    <section className="hero">
      <p className="eyebrow">Migration preview</p>
      <h1>{session.user ? `Welcome back, ${session.user.displayName || session.user.username}` : 'Build your ComfiChat profile'}</h1>
      <p>
        The user app is moving into React, starting with account creation, verification, and profile completion.
      </p>
      <div className="button-row">
        {session.user ? (
          <>
            <button className="primary" onClick={() => navigate('/profile')}>Edit profile</button>
            <a className="secondary" href="/chat">Open current chat</a>
          </>
        ) : (
          <>
            <button className="primary" onClick={() => navigate('/signup')}>Create account</button>
            <button className="secondary" onClick={() => navigate('/login')}>Sign in</button>
          </>
        )}
      </div>
    </section>
  );
}

function Signup() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(event) {
    setForm(prev => ({ ...prev, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const data = await api('/api/auth/email/signup', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setStatus(`Check your email for a verification link.${data.preview ? ` Preview: ${data.preview}` : ''}`);
    } catch (err) {
      setError(err.message || 'Failed to start signup');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <p className="eyebrow">Email account</p>
      <h1>Create your account</h1>
      <p className="muted">Email is the first supported account path. Google and Apple can plug into this flow later.</p>
      <form className="form-grid single" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" value={form.email} onChange={update} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" minLength="6" value={form.password} onChange={update} required />
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Sending...' : 'Send verification'}</button>
      </form>
      <div className="oauth-grid">
        <button disabled>Continue with Google - not configured yet</button>
        <button disabled>Continue with Apple - not configured yet</button>
      </div>
      {status && <div className="notice success">{status}</div>}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}

function Login({ onAuthed }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(event) {
    setForm(prev => ({ ...prev, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/users/login', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      saveSession(data);
      onAuthed(data.user);
      navigate('/profile');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <p className="eyebrow">Welcome back</p>
      <h1>Sign in</h1>
      <form className="form-grid single" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" value={form.email} onChange={update} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" value={form.password} onChange={update} required />
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}

function Verify({ search }) {
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const token = params.get('token');
  const [state, setState] = useState({ loading: true, error: '', done: false });

  useEffect(() => {
    let alive = true;
    async function verify() {
      if (!token) {
        setState({ loading: false, error: 'Missing verification token.', done: false });
        return;
      }
      try {
        const data = await api('/api/auth/email/verify', {
          method: 'POST',
          body: JSON.stringify({ token })
        });
        sessionStorage.setItem(PENDING_TOKEN, data.tempToken);
        if (alive) setState({ loading: false, error: '', done: true });
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message || 'Verification failed', done: false });
      }
    }
    verify();
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <section className="stack">
      <p className="eyebrow">Email verification</p>
      <h1>Verify your email</h1>
      {state.loading && <div className="notice">Verifying...</div>}
      {state.error && <div className="notice error">{state.error}</div>}
      {state.done && (
        <>
          <div className="notice success">Verified. Continue to complete your profile.</div>
          <button className="primary" onClick={() => navigate('/profile')}>Continue to profile</button>
        </>
      )}
    </section>
  );
}

function emptyProfile() {
  return {
    username: '',
    displayName: '',
    age: '',
    gender: '',
    sexuality: '',
    lookingFor: [],
    hairType: '',
    hairColor: '',
    eyeColor: '',
    ethnicity: '',
    hobbies: '',
    profilePicture: ''
  };
}

function normalizeProfile(user) {
  return {
    ...emptyProfile(),
    ...user,
    age: user?.age || '',
    hobbies: Array.isArray(user?.hobbies) ? user.hobbies.join(', ') : (user?.hobbies || ''),
    lookingFor: Array.isArray(user?.lookingFor) ? user.lookingFor : []
  };
}

function Profile({ session, onAuthed }) {
  const [profile, setProfile] = useState(emptyProfile);
  const [loading, setLoading] = useState(Boolean(session.token));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pendingToken = sessionStorage.getItem(PENDING_TOKEN);
  const isEditing = Boolean(session.token);
  const canCreate = Boolean(pendingToken);

  useEffect(() => {
    let alive = true;
    async function loadProfile() {
      if (!session.token) return;
      setLoading(true);
      try {
        const me = await api('/api/users/me', { headers: authHeaders() });
        if (alive) setProfile(normalizeProfile(me));
      } catch (err) {
        if (alive) setError(err.message || 'Failed to load profile');
      } finally {
        if (alive) setLoading(false);
      }
    }
    loadProfile();
    return () => {
      alive = false;
    };
  }, [session.token]);

  function update(event) {
    const { name, value } = event.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  }

  function updateMulti(event) {
    const values = Array.from(event.target.selectedOptions).map(option => option.value);
    setProfile(prev => ({ ...prev, lookingFor: values }));
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const data = await api('/api/upload', { method: 'POST', body });
      const rawUrl = data.fileUrl || '';
      const url = rawUrl.startsWith('http') || rawUrl.startsWith('data:') ? rawUrl : `${API_BASE}${rawUrl}`;
      setProfile(prev => ({ ...prev, profilePicture: url }));
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function buildPayload() {
    return {
      username: profile.username.trim(),
      displayName: profile.displayName.trim() || profile.username.trim(),
      age: Number(profile.age),
      gender: profile.gender,
      sexuality: profile.sexuality || undefined,
      lookingFor: profile.lookingFor,
      hairType: profile.hairType || undefined,
      hairColor: profile.hairColor || undefined,
      eyeColor: profile.eyeColor || undefined,
      ethnicity: profile.ethnicity || undefined,
      hobbies: profile.hobbies,
      profilePicture: profile.profilePicture || undefined
    };
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    const payload = buildPayload();
    if (!payload.username || !payload.age || !payload.gender) {
      setSaving(false);
      setError('Username, age, and gender are required.');
      return;
    }

    try {
      if (isEditing) {
        const saved = await api('/api/users/me', {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify(payload)
        });
        sessionStorage.setItem(SESSION_USER, JSON.stringify(saved));
        onAuthed(saved);
        setNotice('Profile saved.');
      } else {
        const data = await api('/api/auth/email/finalize', {
          method: 'POST',
          body: JSON.stringify({ tempToken: pendingToken, ...payload })
        });
        sessionStorage.removeItem(PENDING_TOKEN);
        saveSession(data);
        onAuthed(data.user);
        setNotice('Profile created. You can now start chatting.');
      }
    } catch (err) {
      setError(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  if (!isEditing && !canCreate) {
    return (
      <section className="stack">
        <p className="eyebrow">Profile</p>
        <h1>Complete your account first</h1>
        <p className="muted">Create an email account and verify it before building your profile.</p>
        <button className="primary" onClick={() => navigate('/signup')}>Start signup</button>
      </section>
    );
  }

  if (loading) {
    return <section className="stack"><div className="notice">Loading profile...</div></section>;
  }

  return (
    <section className="profile-layout">
      <div className="profile-intro">
        <p className="eyebrow">{isEditing ? 'Your profile' : 'Profile setup'}</p>
        <h1>{isEditing ? 'Edit your profile' : 'Create your profile'}</h1>
        <p className="muted">This profile will become the source of truth for the chat experience as the React migration continues.</p>
        <div className="avatar-card">
          {profile.profilePicture ? (
            <img src={profile.profilePicture} alt="Profile preview" />
          ) : (
            <div className="avatar-placeholder">{(profile.displayName || profile.username || 'C').slice(0, 1).toUpperCase()}</div>
          )}
          <label className="secondary file-button">
            {uploading ? 'Uploading...' : 'Upload photo'}
            <input type="file" accept="image/*" onChange={upload} disabled={uploading} />
          </label>
        </div>
      </div>

      <form className="form-grid" onSubmit={submit}>
        <label className="field">
          <span>Username</span>
          <input name="username" value={profile.username} onChange={update} required minLength="3" maxLength="30" disabled={isEditing} />
        </label>
        <label className="field">
          <span>Display name</span>
          <input name="displayName" value={profile.displayName || ''} onChange={update} maxLength="50" />
        </label>
        <label className="field">
          <span>Age</span>
          <select name="age" value={profile.age} onChange={update} required>
            <option value="">Select</option>
            {Array.from({ length: 88 }, (_, idx) => idx + 13).map(age => <option key={age} value={age}>{age}</option>)}
          </select>
        </label>
        <SelectField label="Gender" name="gender" value={profile.gender} onChange={update} options={genderOptions} required />
        <SelectField label="Sexuality" name="sexuality" value={profile.sexuality} onChange={update} options={sexualityOptions} />
        <label className="field">
          <span>Looking for</span>
          <select multiple value={profile.lookingFor} onChange={updateMulti}>
            {lookingForOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
          </select>
        </label>
        <SelectField label="Hair type" name="hairType" value={profile.hairType} onChange={update} options={hairTypeOptions} />
        <SelectField label="Hair color" name="hairColor" value={profile.hairColor} onChange={update} options={hairColorOptions} />
        <SelectField label="Eye color" name="eyeColor" value={profile.eyeColor} onChange={update} options={eyeColorOptions} />
        <SelectField label="Ethnicity" name="ethnicity" value={profile.ethnicity} onChange={update} options={ethnicityOptions} />
        <label className="field span-2">
          <span>Hobbies</span>
          <input name="hobbies" value={profile.hobbies} onChange={update} placeholder="music, travel, fitness" />
        </label>
        <div className="form-actions span-2">
          <button type="button" className="secondary" onClick={() => navigate('/app')}>Back</button>
          <button className="primary" disabled={saving}>{saving ? 'Saving...' : isEditing ? 'Save profile' : 'Save and continue'}</button>
        </div>
        {notice && <div className="notice success span-2">{notice}</div>}
        {error && <div className="notice error span-2">{error}</div>}
      </form>
    </section>
  );
}

function NotFound() {
  return (
    <section className="stack">
      <h1>Page not found</h1>
      <button className="primary" onClick={() => navigate('/app')}>Go to app</button>
    </section>
  );
}

function App() {
  const route = useRoute();
  const [session, setSession] = useState(getSession);

  function onLogout() {
    clearSession();
    setSession({ token: null, user: null });
    navigate('/login');
  }

  function onAuthed(user) {
    setSession({ token: sessionStorage.getItem(SESSION_TOKEN), user });
  }

  let screen;
  if (route.path === '/' || route.path === '/app') screen = <Welcome session={session} />;
  else if (route.path === '/signup' || route.path === '/signup.html') screen = <Signup />;
  else if (route.path === '/login') screen = <Login onAuthed={onAuthed} />;
  else if (route.path === '/verify' || route.path === '/verify.html') screen = <Verify search={route.search} />;
  else if (route.path === '/profile' || route.path === '/profile.html') screen = <Profile session={session} onAuthed={onAuthed} />;
  else screen = <NotFound />;

  return <Shell session={session} onLogout={onLogout}>{screen}</Shell>;
}

createRoot(document.getElementById('root')).render(<App />);

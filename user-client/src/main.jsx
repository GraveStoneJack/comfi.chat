import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CHAT_ACTIONS,
  CHAT_STATUS,
  chatReducer,
  createDeleteImageMessage,
  createImageMessage,
  createClientMessage,
  createReport,
  fetchHistory,
  getImageCandidates,
  getActiveConversation,
  getVisibleConversations,
  getVisibleRoster,
  initialChatState,
  isImageMessage,
  loadBlockedDevices,
  loadHiddenChats,
  loadPreferences,
  logoff,
  recordBlock,
  restoreChatSession,
  saveBlockedDevices,
  saveHiddenChats,
  savePreferences,
  stripImageToken,
  uploadChatImage,
  useChatSocket,
  useOnlineRoster,
  usePresence
} from './chat';
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
            <button className="primary" onClick={() => navigate('/app/chat')}>Open React chat</button>
            <a className="secondary" href="/chat">Open legacy chat</a>
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

function ChatImage({ message }) {
  const candidates = useMemo(() => getImageCandidates(message), [message]);
  const [index, setIndex] = useState(0);
  const src = candidates[index] || '';
  if (!src) return <span>Photo unavailable</span>;
  return (
    <img
      className="react-message-image"
      src={src}
      alt="Chat attachment"
      onError={() => setIndex(prev => Math.min(prev + 1, candidates.length - 1))}
    />
  );
}

const IMAGE_EXPIRY_OPTIONS = [
  { value: 0, label: 'Forever' },
  { value: 2, label: '2 seconds' },
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '60 seconds' }
];

function ChatShell() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageExpirySeconds, setImageExpirySeconds] = useState(0);
  const [reportForm, setReportForm] = useState({ open: false, reason: 'harassment', additionalInfo: '', alsoBlock: false });
  const [actionNotice, setActionNotice] = useState('');
  const imageExpiryTimers = useRef(new Map());
  const soundRef = useRef(null);
  const activeConversation = getActiveConversation(state);
  const visibleRoster = getVisibleRoster(state);
  const visibleConversations = getVisibleConversations(state);
  const availableCountries = useMemo(
    () => Array.from(new Set(state.roster.users.map(user => user.country).filter(Boolean))).sort(),
    [state.roster.users]
  );
  const currentUser = state.session.currentUser;
  const handleIncomingMessage = useCallback((message) => {
    if (state.preferences.soundEnabled) {
      try {
        if (!soundRef.current) {
          soundRef.current = new Audio('/sounds/bubblepop.mp3');
          soundRef.current.volume = 0.5;
        }
        soundRef.current.currentTime = 0;
        soundRef.current.play().catch(() => {});
      } catch (_) {}
    }
    if (state.preferences.notifications && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`New message from ${message.sender}`, {
        body: isImageMessage(message.message) ? 'Photo' : message.message
      });
    }
  }, [state.preferences.notifications, state.preferences.soundEnabled]);
  const socket = useChatSocket({
    currentUser,
    authToken: state.session.authToken,
    dispatch,
    enabled: Boolean(currentUser?.username),
    onIncomingMessage: handleIncomingMessage
  });

  useEffect(() => {
    const restored = restoreChatSession();
    dispatch({ type: CHAT_ACTIONS.sessionRestored, payload: restored });
    dispatch({ type: CHAT_ACTIONS.preferencesLoaded, payload: loadPreferences() });
    if (restored.currentUser?.username) {
      dispatch({
        type: CHAT_ACTIONS.blockedDevicesLoaded,
        payload: { deviceIds: loadBlockedDevices(restored.currentUser.username) }
      });
      dispatch({
        type: CHAT_ACTIONS.hiddenChatsLoaded,
        payload: { usernames: loadHiddenChats(restored.currentUser.username) }
      });
    }
  }, []);

  usePresence({
    currentUser,
    deviceId: state.session.deviceId,
    enabled: Boolean(currentUser?.username)
  });
  useOnlineRoster({ dispatch, enabled: Boolean(currentUser?.username) });

  useEffect(() => () => {
    for (const timer of imageExpiryTimers.current.values()) window.clearTimeout(timer);
    imageExpiryTimers.current.clear();
  }, []);

  async function openPeer(peer) {
    if (!peer?.username || !currentUser?.username) return;
    dispatch({ type: CHAT_ACTIONS.chatOpened, payload: { peer } });
    try {
      const messages = await fetchHistory(currentUser.username, peer.username);
      dispatch({ type: CHAT_ACTIONS.historyLoaded, payload: { username: peer.username, messages } });
    } catch (err) {
      setSendError(err.message || 'Failed to load conversation history.');
    }
  }

  function openExistingConversation(conversation) {
    openPeer(conversation.profile || { username: conversation.username });
  }

  function sendText(event) {
    event.preventDefault();
    setSendError('');
    if (!draft.trim() || !activeConversation || !currentUser?.username) return;
    const message = createClientMessage({
      sender: currentUser.username,
      recipient: activeConversation.username,
      message: draft
    });
    try {
      socket.sendMessage({
        sender: message.sender,
        recipient: message.recipient,
        message: message.message
      });
      dispatch({ type: CHAT_ACTIONS.messageSentOptimistic, payload: { message } });
      setDraft('');
    } catch (err) {
      dispatch({
        type: CHAT_ACTIONS.messageSendFailed,
        payload: { username: activeConversation.username, clientId: message.clientId, error: err.message }
      });
      setSendError(err.message || 'Failed to send message.');
    }
  }

  function sendChatMessage(messageText) {
    if (!activeConversation || !currentUser?.username) return;
    const message = createClientMessage({
      sender: currentUser.username,
      recipient: activeConversation.username,
      message: messageText
    });
    socket.sendMessage({
      sender: message.sender,
      recipient: message.recipient,
      message: message.message
    });
    dispatch({ type: CHAT_ACTIONS.messageSentOptimistic, payload: { message } });
  }

  function sendDeleteImage(imageUrl, reason = 'manual', recipientUsername = activeConversation?.username) {
    if (!recipientUsername || !currentUser?.username) return;
    const token = createDeleteImageMessage(imageUrl, reason);
    socket.sendMessage({
      sender: currentUser.username,
      recipient: recipientUsername,
      message: token
    });
    dispatch({
      type: CHAT_ACTIONS.messageDeleted,
      payload: { username: recipientUsername, imageUrl, reason: reason === 'expired' ? 'Image expired' : 'Message removed' }
    });
  }

  function scheduleImageExpiry(imageUrl, seconds, recipientUsername) {
    if (!seconds) return;
    const existing = imageExpiryTimers.current.get(imageUrl);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      imageExpiryTimers.current.delete(imageUrl);
      sendDeleteImage(imageUrl, 'expired', recipientUsername);
      dispatch({ type: CHAT_ACTIONS.imageExpiryCleared, payload: { url: imageUrl } });
    }, seconds * 1000);
    imageExpiryTimers.current.set(imageUrl, timer);
    dispatch({
      type: CHAT_ACTIONS.imageExpiryScheduled,
      payload: { url: imageUrl, expiresAt: Date.now() + seconds * 1000 }
    });
  }

  async function sendImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !activeConversation || !currentUser?.username) return;
    setUploadingImage(true);
    setSendError('');
    try {
      const result = await uploadChatImage(file, currentUser.username);
      const fileUrl = result.fileUrl || result.url;
      if (!fileUrl) throw new Error('Upload did not return a file URL');
      sendChatMessage(createImageMessage(fileUrl));
      scheduleImageExpiry(fileUrl, Number(imageExpirySeconds), activeConversation.username);
    } catch (err) {
      setSendError(err.message || 'Failed to send image.');
    } finally {
      setUploadingImage(false);
    }
  }

  async function updatePreference(patch) {
    const next = { ...state.preferences, ...patch };
    if (patch.notifications && 'Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') next.notifications = false;
    }
    savePreferences(next);
    dispatch({ type: CHAT_ACTIONS.preferencesChanged, payload: next });
  }

  async function logoutFromChat() {
    if (currentUser?.username) {
      try { await logoff(currentUser.username); } catch (_) {}
    }
    for (const timer of imageExpiryTimers.current.values()) window.clearTimeout(timer);
    imageExpiryTimers.current.clear();
    clearSession();
    navigate('/login');
  }

  async function blockActivePeer() {
    if (!activeConversation || !currentUser?.username) return;
    const peer = activeConversation.profile || {};
    const deviceId = peer.deviceId || state.roster.usernameToDeviceId[activeConversation.username] || '';
    if (!confirm(`Block ${activeConversation.username}? They will be hidden locally and recorded for moderation.`)) return;
    setActionNotice('');
    setSendError('');
    try {
      await recordBlock({
        blockerUsername: currentUser.username,
        blockerDeviceId: state.session.deviceId,
        blockedUsername: activeConversation.username,
        blockedDeviceId: deviceId,
        source: 'react_chat_block',
        reason: 'user_blocked'
      });
      const nextBlocked = Array.from(new Set([...state.conversations.blockedDeviceIds, deviceId].filter(Boolean)));
      saveBlockedDevices(currentUser.username, nextBlocked);
      dispatch({ type: CHAT_ACTIONS.peerBlocked, payload: { username: activeConversation.username, deviceId } });
      setActionNotice(`${activeConversation.username} was blocked.`);
    } catch (err) {
      setSendError(err.message || 'Failed to block user.');
    }
  }

  function hideActiveChat() {
    if (!activeConversation || !currentUser?.username) return;
    const nextHidden = Array.from(new Set([...state.conversations.hiddenUsernames, activeConversation.username]));
    saveHiddenChats(currentUser.username, nextHidden);
    dispatch({ type: CHAT_ACTIONS.chatHidden, payload: { username: activeConversation.username } });
    setActionNotice(`${activeConversation.username} was hidden from chats.`);
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!activeConversation || !currentUser?.username) return;
    const peer = activeConversation.profile || {};
    const reportedDeviceId = peer.deviceId || state.roster.usernameToDeviceId[activeConversation.username] || '';
    setSendError('');
    setActionNotice('');
    try {
      await createReport({
        reportingUser: currentUser.username,
        reportingDeviceId: state.session.deviceId,
        reportedUser: activeConversation.username,
        reportedDeviceId,
        reason: reportForm.reason,
        additionalInfo: reportForm.additionalInfo,
        alsoBlock: reportForm.alsoBlock
      });
      if (reportForm.alsoBlock) {
        const nextBlocked = Array.from(new Set([...state.conversations.blockedDeviceIds, reportedDeviceId].filter(Boolean)));
        saveBlockedDevices(currentUser.username, nextBlocked);
        dispatch({ type: CHAT_ACTIONS.peerBlocked, payload: { username: activeConversation.username, deviceId: reportedDeviceId } });
      }
      setReportForm({ open: false, reason: 'harassment', additionalInfo: '', alsoBlock: false });
      setActionNotice('Report submitted.');
    } catch (err) {
      setSendError(err.message || 'Failed to submit report.');
    }
  }

  if (!currentUser?.username) {
    return (
      <section className="stack">
        <p className="eyebrow">React chat preview</p>
        <h1>Complete your account first</h1>
        <p className="muted">Sign in or create a profile before opening chat.</p>
        <button className="primary" onClick={() => navigate('/login')}>Sign in</button>
      </section>
    );
  }

  return (
    <section className="react-chat-shell">
      <header className="react-chat-header">
        <div>
          <p className="eyebrow">React chat preview</p>
          <h1>Chat</h1>
          <p className="muted">This is the new React shell using the live presence, roster, history, and websocket contracts.</p>
        </div>
        <div className="react-chat-top-actions">
          <div className={`connection-pill ${state.connection.status}`}>
            {state.connection.status === CHAT_STATUS.connected ? 'Connected' : titleCase(state.connection.status)}
          </div>
          <label className="toggle-pill">
            <input type="checkbox" checked={!!state.preferences.soundEnabled} onChange={e => updatePreference({ soundEnabled: e.target.checked })} />
            Sound
          </label>
          <label className="toggle-pill">
            <input type="checkbox" checked={!!state.preferences.notifications} onChange={e => updatePreference({ notifications: e.target.checked })} />
            Notifications
          </label>
          <button className="secondary" onClick={logoutFromChat}>Logout</button>
        </div>
      </header>

      <div className="react-chat-grid">
        <aside className="react-chat-sidebar">
          <div className="chat-sidebar-section">
            <h3>Online Now</h3>
            <div className="react-chat-filters">
              <select value={state.roster.filters.gender} onChange={e => dispatch({ type: CHAT_ACTIONS.filtersChanged, payload: { gender: e.target.value } })}>
                <option value="all">All genders</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="non-binary">Non-binary</option>
              </select>
              <select value={state.roster.filters.country} onChange={e => dispatch({ type: CHAT_ACTIONS.filtersChanged, payload: { country: e.target.value } })}>
                <option value="all">All countries</option>
                {availableCountries.map(country => <option key={country} value={country}>{country}</option>)}
              </select>
              <div className="age-filter-row">
                <input type="number" min="13" max="100" placeholder="Min" value={state.roster.filters.ageMin} onChange={e => dispatch({ type: CHAT_ACTIONS.filtersChanged, payload: { ageMin: e.target.value } })} />
                <input type="number" min="13" max="100" placeholder="Max" value={state.roster.filters.ageMax} onChange={e => dispatch({ type: CHAT_ACTIONS.filtersChanged, payload: { ageMax: e.target.value } })} />
              </div>
              <button className="secondary" onClick={() => dispatch({ type: CHAT_ACTIONS.filtersChanged, payload: { gender: 'all', country: 'all', ageMin: '', ageMax: '' } })}>Clear filters</button>
            </div>
            <div className="chat-list">
              {visibleRoster.length === 0 && <div className="empty-chat-list">No users online yet.</div>}
              {visibleRoster.map(user => (
                <button
                  className={`chat-list-item ${activeConversation?.username === user.username ? 'active' : ''}`}
                  key={user._id || user.username}
                  onClick={() => openPeer(user)}
                >
                  <strong>{user.username}</strong>
                  <span>{[user.age, user.gender, user.country].filter(Boolean).join(' | ') || 'Online'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="chat-sidebar-section">
            <h3>Chats</h3>
            <div className="chat-list">
              {visibleConversations.length === 0 && <div className="empty-chat-list">No active chats yet.</div>}
              {visibleConversations.map(conversation => (
                <button
                  className={`chat-list-item ${activeConversation?.username === conversation.username ? 'active' : ''}`}
                  key={conversation.username}
                  onClick={() => openExistingConversation(conversation)}
                >
                  <strong>{conversation.username}{conversation.unread ? ' •' : ''}</strong>
                  <span>{conversation.lastMessage || 'Open conversation'}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="react-chat-panel">
          {activeConversation ? (
            <>
              <div className="react-chat-thread-header">
                <div>
                  <h2>{activeConversation.profile?.displayName || activeConversation.username}</h2>
                  <p>{[activeConversation.profile?.age, activeConversation.profile?.country].filter(Boolean).join(' | ')}</p>
                </div>
                <div className="react-chat-actions">
                  <button className="secondary" onClick={() => setReportForm(prev => ({ ...prev, open: !prev.open }))}>Report</button>
                  <button className="secondary" onClick={blockActivePeer}>Block</button>
                  <button className="secondary" onClick={hideActiveChat}>Hide</button>
                  <button className="secondary" onClick={() => dispatch({ type: CHAT_ACTIONS.chatClosed })}>Close</button>
                </div>
              </div>
              {reportForm.open && (
                <form className="react-report-form" onSubmit={submitReport}>
                  <label>
                    Reason
                    <select value={reportForm.reason} onChange={e => setReportForm(prev => ({ ...prev, reason: e.target.value }))}>
                      <option value="harassment">Harassment or bullying</option>
                      <option value="spam">Spam or scam</option>
                      <option value="inappropriate-content">Sexual/inappropriate content</option>
                      <option value="hate-speech">Hate speech or discrimination</option>
                      <option value="violence-threats">Violence or threats</option>
                      <option value="impersonation">Impersonation</option>
                      <option value="self-harm">Self-harm or suicide concerns</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    Additional information
                    <textarea value={reportForm.additionalInfo} onChange={e => setReportForm(prev => ({ ...prev, additionalInfo: e.target.value }))} placeholder="Optional context for moderators" />
                  </label>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={reportForm.alsoBlock} onChange={e => setReportForm(prev => ({ ...prev, alsoBlock: e.target.checked }))} />
                    Also block this user
                  </label>
                  <div className="button-row compact">
                    <button className="primary">Submit report</button>
                    <button type="button" className="secondary" onClick={() => setReportForm(prev => ({ ...prev, open: false }))}>Cancel</button>
                  </div>
                </form>
              )}
              <div className="react-chat-messages">
                {activeConversation.messages.length === 0 && <div className="empty-thread">No messages yet. Say hello.</div>}
                {activeConversation.messages.map((message, index) => {
                  const mine = message.sender === currentUser.username;
                  const imageUrl = isImageMessage(message.message) ? stripImageToken(message.message) : '';
                  return (
                    <div className={`react-message ${mine ? 'mine' : 'theirs'} ${message.status === 'failed' ? 'failed' : ''}`} key={message.id || message.clientId || `${message.timestamp}-${index}`}>
                      {message.deleted ? (
                        <span className="deleted-message">{message.deleteReason || 'Message removed'}</span>
                      ) : isImageMessage(message.message) ? (
                        <>
                          <ChatImage message={message.message} />
                          {mine && (
                            <button className="message-inline-action" type="button" onClick={() => sendDeleteImage(imageUrl, 'manual')}>
                              Delete photo
                            </button>
                          )}
                        </>
                      ) : (
                        <span>{message.message}</span>
                      )}
                      <small>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{message.status === 'failed' ? ' | failed' : ''}</small>
                    </div>
                  );
                })}
              </div>
              <form className="react-chat-input" onSubmit={sendText}>
                <label className="attachment-button">
                  {uploadingImage ? 'Uploading...' : 'Photo'}
                  <input type="file" accept="image/*" onChange={sendImage} disabled={uploadingImage} />
                </label>
                <select className="image-expiry-select" value={imageExpirySeconds} onChange={e => setImageExpirySeconds(Number(e.target.value))}>
                  {IMAGE_EXPIRY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Message ${activeConversation.username}...`} />
                <button className="primary" disabled={!draft.trim()}>Send</button>
              </form>
              {actionNotice && <div className="notice success">{actionNotice}</div>}
              {sendError && <div className="notice error">{sendError}</div>}
            </>
          ) : (
            <div className="empty-thread large">
              <h2>Select someone online</h2>
              <p>Open a user from the online list to start the React chat flow.</p>
            </div>
          )}
        </main>
      </div>
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
  else if (route.path === '/app/chat') screen = <ChatShell />;
  else screen = <NotFound />;

  return <Shell session={session} onLogout={onLogout}>{screen}</Shell>;
}

createRoot(document.getElementById('root')).render(<App />);

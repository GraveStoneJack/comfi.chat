import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  Activity,
  BarChart3,
  Blocks,
  CheckCircle2,
  ChevronRight,
  Eye,
  Image,
  LogOut,
  MessageSquare,
  Moon,
  Search,
  Shield,
  Sun,
  Trash2,
  Users
} from 'lucide-react';
import './styles.css';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'users', label: 'User States', icon: Users },
  { id: 'reports', label: 'Reports', icon: Shield },
  { id: 'blocks', label: 'Blocks', icon: Blocks },
  { id: 'chats', label: 'Chats', icon: MessageSquare }
];

const COLORS = ['#9b5cff', '#d79aff', '#7dd3fc', '#34d399', '#f59e0b', '#fb7185', '#a78bfa', '#22d3ee'];

async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(path, { credentials: 'include', ...options, headers });
  if (!res.ok) {
    let message = 'Request failed';
    try {
      const payload = await res.json();
      message = payload.error || message;
    } catch (_) {
      message = await res.text();
    }
    throw new Error(message);
  }
  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : res.text();
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatBytes(value) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(idx ? 1 : 0)} ${units[idx]}`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function imageUrlFromMessage(message) {
  if (!message) return '';
  const raw = message.startsWith('[image]') ? message.substring(7).trim() : message.trim();
  if (/^data:image\//i.test(raw)) return raw;
  return `${location.origin}/api/admin/media/resolve?src=${encodeURIComponent(raw)}`;
}

function isImageMessage(message) {
  return typeof message === 'string' && (message.startsWith('[image]') || /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(message));
}

function useAsync(loader, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  useEffect(() => {
    let alive = true;
    setState(prev => ({ ...prev, loading: true, error: '' }));
    loader()
      .then(data => alive && setState({ loading: false, data, error: '' }))
      .catch(error => alive && setState({ loading: false, data: null, error: error.message || 'Failed to load' }));
    return () => {
      alive = false;
    };
  }, deps);
  return state;
}

function LoginScreen({ onAuthed }) {
  const [step, setStep] = useState('credentials');
  const [tempToken, setTempToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitCredentials(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password })
      });
      setTempToken(res.tempToken);
      setStep('mfa');
    } catch (err) {
      setError('Invalid username or password.');
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ tempToken, code: code.trim() })
      });
      onAuthed(await api('/api/admin/auth/me'));
    } catch (err) {
      setError('Invalid MFA code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-art">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="brand-card">
          <span className="eyebrow">Comfi moderation</span>
          <h1>Admin intelligence for safer chats.</h1>
          <p>Review reports, inspect conversations, protect preserved media, and understand audience behavior from one modern console.</p>
        </div>
      </section>
      <section className="login-card">
        <div className="login-header">
          <div className="logo-mark">C</div>
          <div>
            <h2>Welcome back</h2>
            <p>{step === 'credentials' ? 'Sign in to continue.' : 'Enter your latest verification code.'}</p>
          </div>
        </div>
        {step === 'credentials' ? (
          <form onSubmit={submitCredentials} className="form-stack">
            <label>
              Username
              <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required autoFocus />
            </label>
            <label>
              Password
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
            </label>
            <button className="primary" disabled={busy}>{busy ? 'Checking...' : 'Continue'}</button>
          </form>
        ) : (
          <form onSubmit={submitMfa} className="form-stack">
            <label>
              Verification code
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength="6"
                required
                autoFocus
              />
            </label>
            <button className="primary" disabled={busy}>{busy ? 'Verifying...' : 'Verify and enter'}</button>
            <button className="ghost" type="button" onClick={() => setStep('credentials')}>Use different credentials</button>
          </form>
        )}
        {error && <div className="alert error">{error}</div>}
      </section>
    </main>
  );
}

function Shell({ me, onLogout, theme, setTheme }) {
  const [tab, setTab] = useState('dashboard');
  const [lightbox, setLightbox] = useState(null);
  const [userFilter, setUserFilter] = useState(null);
  function openUsersWithFilter(filter) {
    setUserFilter(filter);
    setTab('users');
  }
  const content = {
    dashboard: <Dashboard onUserFilter={openUsersWithFilter} />,
    users: <UsersPage openLightbox={setLightbox} initialFilter={userFilter} onClearInitialFilter={() => setUserFilter(null)} />,
    reports: <ReportsPage />,
    blocks: <BlocksPage />,
    chats: <ChatsPage openLightbox={setLightbox} />
  }[tab];

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo-mark">C</div>
          <div>
            <strong>Comfi Admin</strong>
            <span>Moderation portal</span>
          </div>
        </div>
        <nav>
          {NAV.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="admin-pill">
            <Shield size={16} />
            <span>{me.username} · {me.role}</span>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Admin portal</span>
            <h1>{NAV.find(item => item.id === tab)?.label}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="ghost" onClick={onLogout}><LogOut size={16} /> Logout</button>
          </div>
        </header>
        {content}
      </main>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox-card" onClick={event => event.stopPropagation()}>
            <img src={lightbox} alt="Moderation preview" />
            <div>
              <a href={lightbox} target="_blank" rel="noreferrer">Open original</a>
              <button className="ghost" onClick={() => setLightbox(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, hint }) {
  return (
    <article className="kpi-card">
      <div className="kpi-icon"><Icon size={20} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function Dashboard({ onUserFilter }) {
  const { loading, data, error } = useAsync(() => api('/api/admin/dashboard/summary?days=30'), []);
  if (loading) return <Loading label="Loading dashboard intelligence..." />;
  if (error) return <ErrorState message={error} />;
  const kpis = data.kpis || {};
  function handleDemographicSelect(type, item) {
    if (!item || !item.name) return;
    onUserFilter({ type, value: item.name });
  }
  return (
    <div className="page-stack">
      <section className="kpi-grid">
        <KpiCard icon={Activity} label="Active now" value={formatNumber(kpis.activeUsers)} hint="Temp users currently online" />
        <KpiCard icon={Users} label="Recurring devices" value={formatNumber(kpis.recurringUsers)} hint="Devices with multiple names" />
        <KpiCard icon={MessageSquare} label="Messages" value={formatNumber(kpis.messages)} hint="Last 30 days" />
        <KpiCard icon={Image} label="Images" value={formatNumber(kpis.images)} hint={`${formatBytes(kpis.mediaBytes)} retained`} />
        <KpiCard icon={Shield} label="Open reports" value={formatNumber(kpis.openReports)} hint="Open or in review" />
      </section>
      <section className="grid two">
        <Panel title="Chat Activity" subtitle="Messages, images, and reports by day">
          <Chart height={320}>
            <AreaChart data={data.timeline}>
              <defs>
                <linearGradient id="messages" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#9b5cff" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#9b5cff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Area dataKey="messages" stroke="#9b5cff" fill="url(#messages)" />
              <Line dataKey="images" stroke="#d79aff" />
              <Line dataKey="reports" stroke="#fb7185" />
            </AreaChart>
          </Chart>
        </Panel>
        <Panel title="Logons and Devices" subtitle="How many people logged on and unique device activity">
          <Chart height={320}>
            <LineChart data={data.timeline}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line dataKey="logins" stroke="#34d399" strokeWidth={2} />
              <Line dataKey="uniqueDevices" stroke="#7dd3fc" strokeWidth={2} />
            </LineChart>
          </Chart>
        </Panel>
      </section>
      <section className="grid three">
        <DemographicChart title="Age Audience" data={data.demographics.age} onSelect={item => handleDemographicSelect('ageBand', item)} />
        <DemographicChart title="Gender Audience" data={data.demographics.gender} onSelect={item => handleDemographicSelect('gender', item)} />
        <DemographicChart title="Country Demographics" data={data.demographics.country} bar onSelect={item => handleDemographicSelect('country', item)} />
      </section>
      <section className="grid three">
        <AttentionList title="Frequently Reported" items={data.needsAttention.frequentReports} labelKey="username" />
        <AttentionList title="Frequently Blocked" items={data.needsAttention.frequentBlocks} labelKey="username" />
        <AttentionList title="High Volume Devices" items={data.needsAttention.highVolumeDevices} labelKey="currentUsername" valueKey="messageCount" />
      </section>
    </div>
  );
}

function DemographicChart({ title, data = [], bar = false, onSelect }) {
  return (
    <Panel title={title} subtitle="Click a segment to inspect the people in this group">
      <Chart height={260}>
        {bar ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#9b5cff" radius={[8, 8, 0, 0]} onClick={onSelect} className="chart-click-target" />
          </BarChart>
        ) : (
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={90}
              paddingAngle={4}
              activeShape={false}
              onClick={onSelect}
              className="chart-click-target"
            >
              {data.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} stroke="transparent" />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        )}
      </Chart>
    </Panel>
  );
}

function AttentionList({ title, items = [], labelKey, valueKey = 'count' }) {
  return (
    <Panel title={title}>
      <div className="attention-list">
        {items.length ? items.map((item, index) => (
          <div className="attention-row" key={`${item[labelKey]}-${index}`}>
            <span>{item[labelKey] || 'Unknown'}</span>
            <strong>{formatNumber(item[valueKey])}</strong>
          </div>
        )) : <Empty label="No signals yet" />}
      </div>
    </Panel>
  );
}

function UsersPage({ openLightbox, initialFilter, onClearInitialFilter }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const { loading, data, error } = useAsync(() => api(`/api/admin/identities?limit=300&search=${encodeURIComponent(search)}`), [search, refresh]);
  const filteredData = useMemo(() => {
    if (!Array.isArray(data)) return [];
    if (!initialFilter) return data;
    return data.filter(row => {
      const value = String(row[initialFilter.type] || '').toLowerCase();
      return value === String(initialFilter.value || '').toLowerCase();
    });
  }, [data, initialFilter]);
  const detail = useAsync(
    () => selected ? api(`/api/admin/identities/detail?username=${encodeURIComponent(selected.currentUsername)}${selected.deviceId ? `&deviceId=${encodeURIComponent(selected.deviceId)}` : ''}`) : Promise.resolve(null),
    [selected?.key]
  );
  return (
    <div className="page-stack">
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search usernames, devices, countries..." />
        {initialFilter && (
          <button className="filter-chip" onClick={onClearInitialFilter}>
            {initialFilter.type.replace('ageBand', 'age')} · {initialFilter.value}
            <span>Clear</span>
          </button>
        )}
        <button className="ghost" onClick={() => setRefresh(x => x + 1)}>Refresh</button>
        <button className="ghost" onClick={() => api('/api/admin/identities/backfill', { method: 'POST', body: JSON.stringify({}) }).then(() => setRefresh(x => x + 1))}>Backfill identities</button>
      </Toolbar>
      {loading && <Loading label="Loading user states..." />}
      {error && <ErrorState message={error} />}
      {data && (
        <div className="split-layout">
          <Panel title="People and Devices" subtitle={`${filteredData.length} grouped identities${initialFilter ? ` matching ${initialFilter.value}` : ''}`}>
            <div className="identity-list">
              {filteredData.map(row => (
                <button key={row.key} className={selected?.key === row.key ? 'identity-card active' : 'identity-card'} onClick={() => setSelected(row)}>
                  <div>
                    <strong>{row.currentUsername}</strong>
                    <span>{row.usernames.length > 1 ? `${row.usernames.length} names used` : 'Single known name'}</span>
                  </div>
                  <small>{row.deviceId ? `dev ${row.deviceId.slice(-8)}` : 'registered/no device'}</small>
                  <div className="mini-tags">
                    <span>{row.gender}</span>
                    <span>{row.ageBand}</span>
                    <span>{row.country}</span>
                    {row.isOnline && <span className="good">online</span>}
                  </div>
                  <ChevronRight size={18} />
                </button>
              ))}
              {!filteredData.length && <Empty label="No identities match this filter." />}
            </div>
          </Panel>
          <Panel title="Identity Detail" subtitle={selected ? selected.currentUsername : 'Select a user or device'}>
            {!selected && <Empty label="Pick an identity to inspect names, devices, reports, blocks, media, and chats." />}
            {selected && detail.loading && <Loading label="Loading identity detail..." />}
            {selected && detail.data && (
              <IdentityDetail detail={detail.data} openLightbox={openLightbox} />
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function IdentityDetail({ detail, openLightbox }) {
  const identity = detail.identity || {};
  return (
    <div className="detail-stack">
      <div className="profile-strip">
        <div className="avatar">{(identity.currentUsername || '?').slice(0, 1).toUpperCase()}</div>
        <div>
          <h3>{identity.currentUsername}</h3>
          <p>{identity.deviceId || 'No device id'} · Last seen {formatDate(identity.lastSeenAt)}</p>
        </div>
      </div>
      <div className="stat-row">
        <Stat label="Messages" value={identity.messageCount} />
        <Stat label="Images" value={identity.imageCount} />
        <Stat label="Reports" value={identity.reportCount} />
        <Stat label="Blocked by" value={identity.blockedByCount} />
      </div>
      <section>
        <h4>Names Used</h4>
        <div className="mini-tags">{(identity.usernames || []).map(name => <span key={name}>{name}</span>)}</div>
      </section>
      <section>
        <h4>Conversations</h4>
        <DataTable
          rows={detail.conversations || []}
          columns={[
            ['with', 'With'],
            ['messagesCount', 'Messages'],
            ['imagesCount', 'Images'],
            [row => formatDate(row.lastAt), 'Last active']
          ]}
        />
      </section>
      <section>
        <h4>Media Shared</h4>
        <MediaGrid items={detail.media || []} openLightbox={openLightbox} />
      </section>
      <section>
        <h4>Reports and Blocks</h4>
        <div className="grid two compact">
          <MiniFeed title="Reports Against" items={detail.reportsAgainst} render={r => `${r.reportingUser} reported ${r.reportedUser}: ${r.reason}`} />
          <MiniFeed title="Blocks Against" items={detail.blocksAgainst} render={b => `${b.blockerUsername} blocked ${b.blockedUsername}`} />
        </div>
      </section>
    </div>
  );
}

function ReportsPage() {
  const [selected, setSelected] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const { loading, data, error } = useAsync(() => api('/api/admin/reports'), [refresh]);
  return (
    <div className="split-layout">
      <Panel title="Report Queue" subtitle="Moderation cases that need review">
        {loading && <Loading label="Loading reports..." />}
        {error && <ErrorState message={error} />}
        <div className="report-list">
          {(data || []).map(report => (
            <button key={report._id} className={selected?._id === report._id ? 'report-card active' : 'report-card'} onClick={() => setSelected(report)}>
              <span className={`status ${report.status}`}>{report.status}</span>
              <strong>{report.reportingUser} → {report.reportedUser}</strong>
              <small>{report.reason} · {formatDate(report.createdAt)}</small>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Report Detail" subtitle="Evidence, notes, and workflow">
        {selected ? <ReportDetail report={selected} onUpdated={() => setRefresh(x => x + 1)} /> : <Empty label="Select a report to review." />}
      </Panel>
    </div>
  );
}

function ReportDetail({ report, onUpdated }) {
  const [status, setStatus] = useState(report.status);
  const [notes, setNotes] = useState(report.adminNotes || '');
  const chat = useAsync(() => api(`/api/admin/messages/history/${encodeURIComponent(report.reportingUser)}/${encodeURIComponent(report.reportedUser)}`), [report._id]);
  async function save() {
    await api(`/api/admin/reports/${report._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, adminNotes: notes })
    });
    onUpdated();
  }
  return (
    <div className="detail-stack">
      <div className="profile-strip">
        <Shield />
        <div>
          <h3>{report.reason}</h3>
          <p>{report.reportingUser} reported {report.reportedUser}</p>
        </div>
      </div>
      <p className="surface-note">{report.additionalInfo || 'No additional notes from reporter.'}</p>
      <div className="form-grid">
        <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option>open</option><option>in_review</option><option>resolved</option><option>dismissed</option></select></label>
        <label>Admin notes<textarea value={notes} onChange={e => setNotes(e.target.value)} rows="4" /></label>
      </div>
      <button className="primary" onClick={save}><CheckCircle2 size={16} /> Save review</button>
      <section>
        <h4>Related Conversation</h4>
        {chat.loading && <Loading label="Loading evidence..." />}
        {chat.data && <MessageFeed messages={chat.data} />}
      </section>
    </div>
  );
}

function BlocksPage() {
  const [search, setSearch] = useState('');
  const { loading, data, error } = useAsync(() => api(`/api/admin/blocks?limit=300&search=${encodeURIComponent(search)}`), [search]);
  return (
    <div className="page-stack">
      <Toolbar><SearchBox value={search} onChange={setSearch} placeholder="Search blockers, blocked users, or devices..." /></Toolbar>
      {loading && <Loading label="Loading block network..." />}
      {error && <ErrorState message={error} />}
      {data && (
        <section className="grid two">
          <Panel title="Block Events" subtitle="Who blocked who">
            <DataTable
              rows={data.items}
              columns={[
                [row => `${row.blockerUsername}${row.blockerDeviceId ? ` · ${row.blockerDeviceId.slice(-6)}` : ''}`, 'Blocker'],
                [row => `${row.blockedUsername}${row.blockedDeviceId ? ` · ${row.blockedDeviceId.slice(-6)}` : ''}`, 'Blocked'],
                ['source', 'Source'],
                [row => formatDate(row.createdAt), 'When']
              ]}
            />
          </Panel>
          <Panel title="Frequently Blocked" subtitle="Users/devices blocked by others">
            <div className="attention-list">
              {data.frequentTargets.map((row, index) => (
                <div className="attention-row" key={index}>
                  <span>{row._id.username || 'Unknown'} {row._id.deviceId ? `· ${row._id.deviceId.slice(-8)}` : ''}</span>
                  <strong>{row.count}</strong>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      )}
    </div>
  );
}

function ChatsPage({ openLightbox }) {
  const [query, setQuery] = useState('');
  const [user, setUser] = useState('');
  const [mediaOnly, setMediaOnly] = useState(false);
  const [selected, setSelected] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const conversations = useAsync(() => api(`/api/admin/messages/conversations?limit=200${user ? `&user=${encodeURIComponent(user)}` : ''}`), [user, refresh]);
  const search = useAsync(() => api(`/api/admin/messages/search?limit=100&q=${encodeURIComponent(query)}${user ? `&user=${encodeURIComponent(user)}` : ''}${mediaOnly ? '&mediaOnly=true' : ''}`), [query, user, mediaOnly, refresh]);
  const history = useAsync(() => selected ? api(`/api/admin/messages/history/${encodeURIComponent(selected.userA)}/${encodeURIComponent(selected.userB)}${selected.devA || selected.devB ? `?${new URLSearchParams({ ...(selected.devA ? { devA: selected.devA } : {}), ...(selected.devB ? { devB: selected.devB } : {}) }).toString()}` : ''}`) : Promise.resolve([]), [selected, refresh]);
  async function deleteMessage(message) {
    if (!confirm('Delete this message from admin-visible chat history?')) return;
    await api(`/api/admin/messages/${message._id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'admin_delete' }) });
    setRefresh(x => x + 1);
  }
  async function clearConversation() {
    if (!selected || !confirm('Clear this full conversation from active admin chat history?')) return;
    await api('/api/admin/messages/clear', {
      method: 'POST',
      body: JSON.stringify({
        username: selected.userA,
        otherUsername: selected.userB,
        deviceId: selected.devA,
        otherDeviceId: selected.devB,
        reason: 'admin_conversation_cleanup'
      })
    });
    setRefresh(x => x + 1);
  }
  return (
    <div className="page-stack">
      <div className="chat-moderation-layout">
        <div className="chat-left-column">
          <Toolbar>
            <SearchBox value={query} onChange={setQuery} placeholder="Search keywords across all chats..." />
            <input value={user} onChange={e => setUser(e.target.value)} placeholder="Filter by user" />
            <label className="check"><input type="checkbox" checked={mediaOnly} onChange={e => setMediaOnly(e.target.checked)} /> Media only</label>
          </Toolbar>
          <Panel title="Conversations" subtitle="Grouped by participant and device">
            {conversations.loading && <Loading label="Loading conversations..." />}
            <div className="identity-list conversation-list">
              {(conversations.data || []).map(row => (
                <button key={`${row.userA}-${row.userB}-${row.devA}-${row.devB}`} className={selected === row ? 'identity-card active' : 'identity-card'} onClick={() => setSelected(row)}>
                  <strong>{row.userA} ↔ {row.userB}</strong>
                  <span>{row.messagesCount} messages · {row.imagesCount} images</span>
                  <small>{formatDate(row.lastAt)}</small>
                </button>
              ))}
            </div>
          </Panel>
        </div>
        <div className="chat-right-column">
          <Panel title="Transcript" subtitle={selected ? `${selected.userA} and ${selected.userB}` : 'Select a conversation'}>
            {selected && <button className="danger subtle" onClick={clearConversation}><Trash2 size={16} /> Clear conversation</button>}
            {selected ? <MessageFeed messages={history.data || []} openLightbox={openLightbox} onDelete={deleteMessage} contained /> : <Empty label="Choose a conversation to view messages and images." />}
          </Panel>
          <Panel title="Keyword Results" subtitle={`${search.data?.total || 0} matching messages`}>
            {search.loading ? <Loading label="Searching chats..." /> : <MessageFeed messages={search.data?.items || []} openLightbox={openLightbox} onDelete={deleteMessage} compact />}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MessageFeed({ messages = [], openLightbox, onDelete, compact = false, contained = false }) {
  if (!messages.length) return <Empty label="No messages found." />;
  return (
    <div className={`message-feed ${compact ? 'compact-feed' : ''} ${contained ? 'contained-feed' : ''}`}>
      {messages.map(message => {
        const img = isImageMessage(message.message) ? imageUrlFromMessage(message.message) : '';
        return (
          <article key={message._id || `${message.sender}-${message.timestamp}-${message.message}`} className="message-row">
            <div>
              <strong>{message.sender}</strong>
              <span>to {message.recipient} · {formatDate(message.timestamp)}</span>
            </div>
            {img ? <img src={img} alt="Shared media" onClick={() => openLightbox?.(img)} /> : <p>{message.message}</p>}
            {onDelete && message._id && <button className="danger subtle" onClick={() => onDelete(message)}><Trash2 size={14} /> Delete</button>}
          </article>
        );
      })}
    </div>
  );
}

function MediaGrid({ items, openLightbox }) {
  if (!items.length) return <Empty label="No media found." />;
  return (
    <div className="media-grid">
      {items.filter(item => isImageMessage(item.message)).map(item => {
        const url = imageUrlFromMessage(item.message);
        return (
          <button key={item._id || item.message} onClick={() => openLightbox(url)}>
            <img src={url} alt="Shared media" />
            <span>to {item.recipient}</span>
          </button>
        );
      })}
    </div>
  );
}

function DataTable({ rows = [], columns = [] }) {
  if (!rows.length) return <Empty label="No data yet." />;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row._id || index}>
              {columns.map(([accessor, label]) => <td key={label}>{typeof accessor === 'function' ? accessor(row) : row[accessor]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniFeed({ title, items = [], render }) {
  return (
    <div className="mini-feed">
      <h5>{title}</h5>
      {items.length ? items.slice(0, 6).map(item => <p key={item._id}>{render(item)}</p>) : <span>No records</span>}
    </div>
  );
}

function Toolbar({ children }) {
  return <div className="toolbar">{children}</div>;
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Chart({ height, children }) {
  return <div style={{ width: '100%', height }}><ResponsiveContainer>{children}</ResponsiveContainer></div>;
}

function Stat({ label, value }) {
  return <div className="stat"><span>{label}</span><strong>{formatNumber(value)}</strong></div>;
}

function Empty({ label }) {
  return <div className="empty"><Eye size={20} /><span>{label}</span></div>;
}

function Loading({ label }) {
  return <div className="loading"><div className="spinner" /> {label}</div>;
}

function ErrorState({ message }) {
  return <div className="alert error">{message}</div>;
}

function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('comfi.admin.theme') || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('comfi.admin.theme', theme);
  }, [theme]);

  useEffect(() => {
    api('/api/admin/auth/me')
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await api('/api/admin/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    setMe(null);
  }

  if (loading) return <Loading label="Opening admin portal..." />;
  if (!me) return <LoginScreen onAuthed={setMe} />;
  return <Shell me={me} onLogout={logout} theme={theme} setTheme={setTheme} />;
}

createRoot(document.getElementById('root')).render(<App />);

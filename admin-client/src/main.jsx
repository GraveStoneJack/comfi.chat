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
  Sector,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  Activity,
  Archive,
  AlertTriangle,
  BarChart3,
  Blocks,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  Image,
  KeyRound,
  LogOut,
  Mail,
  MessageSquare,
  Moon,
  Search,
  Send,
  Settings,
  Shield,
  Sun,
  Trash2,
  UserPlus,
  Users
} from 'lucide-react';
import './styles.css';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'users', label: 'User States', icon: Users },
  { id: 'reports', label: 'Reports', icon: Shield },
  { id: 'cases', label: 'Cases', icon: CheckCircle2 },
  { id: 'storage', label: 'Storage', icon: Archive },
  { id: 'settings', label: 'Settings', icon: Settings },
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

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, char => char.toUpperCase());
}

function formatDateInput(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function shortDeviceId(value) {
  if (!value) return 'No device id';
  return `...${String(value).slice(-10)}`;
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

async function downloadEvidence(url, fallbackName) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to export evidence');
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = match ? match[1] : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
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
    cases: <CasesPage />,
    storage: <StoragePage openLightbox={setLightbox} />,
    settings: <SettingsPage me={me} />,
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
  const [rangePreset, setRangePreset] = useState('30');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const dashboardQuery = useMemo(() => {
    if (rangePreset === 'custom' && customRange.from && customRange.to) {
      return `from=${encodeURIComponent(customRange.from)}&to=${encodeURIComponent(customRange.to)}`;
    }
    return `days=${rangePreset}`;
  }, [rangePreset, customRange.from, customRange.to]);
  const { loading, data, error } = useAsync(() => api(`/api/admin/dashboard/summary?${dashboardQuery}`), [dashboardQuery]);
  if (loading) return <Loading label="Loading dashboard intelligence..." />;
  if (error) return <ErrorState message={error} />;
  const kpis = data.kpis || {};
  function handleDemographicSelect(type, item) {
    if (!item || !item.name) return;
    onUserFilter({ type, value: item.name });
  }
  return (
    <div className="page-stack">
      <Toolbar>
        <div className="segmented-control" aria-label="Dashboard date range">
          {['7', '30', '60', '90'].map(days => (
            <button key={days} className={rangePreset === days ? 'active' : ''} onClick={() => setRangePreset(days)}>
              {days} days
            </button>
          ))}
          <button className={rangePreset === 'custom' ? 'active' : ''} onClick={() => setRangePreset('custom')}>Custom</button>
        </div>
        {rangePreset === 'custom' && (
          <div className="date-range-controls">
            <label>
              From
              <input type="date" value={customRange.from} onChange={event => setCustomRange(range => ({ ...range, from: event.target.value }))} />
            </label>
            <label>
              To
              <input type="date" value={customRange.to} onChange={event => setCustomRange(range => ({ ...range, to: event.target.value }))} />
            </label>
          </div>
        )}
        <span className="range-caption">
          Showing {formatDateInput(data.range?.from)} to {formatDateInput(data.range?.to)}
        </span>
      </Toolbar>
      <section className="kpi-grid">
        <KpiCard icon={Activity} label="Active now" value={formatNumber(kpis.activeUsers)} hint="Temp users currently online" />
        <KpiCard icon={Users} label="Recurring devices" value={formatNumber(kpis.recurringUsers)} hint="Devices with multiple names" />
        <KpiCard icon={MessageSquare} label="Messages" value={formatNumber(kpis.messages)} hint="Selected range" />
        <KpiCard icon={Image} label="Images" value={formatNumber(kpis.images)} hint={`${formatBytes(kpis.mediaBytes)} retained`} />
        <KpiCard icon={Shield} label="Open reports" value={formatNumber(kpis.openReports)} hint="Open or in review" />
      </section>
      <section className="grid two">
        <Panel title="Live Now" subtitle="Current activity and short-term spikes">
          <div className="live-grid">
            <Stat label="Active users" value={data.liveNow?.activeUsers} />
            <Stat label="Messages last 15m" value={data.liveNow?.messagesLast15m} />
            <Stat label="Spike vs previous 15m" value={`${data.liveNow?.spikePercent || 0}%`} />
          </div>
          <MiniFeed
            title="Active Conversations"
            items={data.liveNow?.activeConversations || []}
            render={row => `${row.userA} ↔ ${row.userB}: ${row.messages} recent messages`}
          />
        </Panel>
        <Panel title="Moderation Risk" subtitle="Users/devices with the strongest risk signals">
          <RiskList items={data.risk?.highest || []} onSelect={item => onUserFilter({ type: item.deviceId ? 'deviceId' : 'currentUsername', value: item.deviceId || item.currentUsername })} />
        </Panel>
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
        <DeviceList title="Recurring Devices" subtitle="Single devices that used multiple names" items={data.needsAttention.recurringDevices} onSelect={device => onUserFilter({ type: 'deviceId', value: device.deviceId })} valueKey="namesCount" valueLabel="names" />
      </section>
      <section className="grid two">
        <DeviceList title="High Volume Devices" subtitle="Devices with the most chat messages" items={data.needsAttention.highVolumeDevices} onSelect={device => onUserFilter({ type: 'deviceId', value: device.deviceId })} valueKey="messageCount" valueLabel="messages" />
        <DeviceList title="Recently Active Devices" subtitle="Latest seen devices and names used" items={data.needsAttention.recentDevices} onSelect={device => onUserFilter({ type: 'deviceId', value: device.deviceId })} valueKey="usernamesCount" valueLabel="names" />
      </section>
    </div>
  );
}

function RiskList({ items = [], onSelect }) {
  if (!items.length) return <Empty label="No elevated risk signals yet." />;
  return (
    <div className="risk-list">
      {items.map(item => (
        <button className={`risk-row ${item.risk?.level || 'low'}`} key={item.key} onClick={() => onSelect(item)}>
          <div>
            <strong>{item.currentUsername}</strong>
            <span>{item.deviceId ? shortDeviceId(item.deviceId) : 'No device id'} · {(item.usernames || []).length} names</span>
          </div>
          <div className="risk-score">
            <strong>{item.risk?.score || 0}</strong>
            <span>{item.risk?.level || 'low'}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function renderStableSector(props) {
  return <Sector {...props} />;
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
            <Bar dataKey="value" fill="#9b5cff" radius={[8, 8, 0, 0]} onClick={onSelect} className="chart-click-target" isAnimationActive={false} />
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
              activeShape={renderStableSector}
              onClick={onSelect}
              className="chart-click-target"
              isAnimationActive={false}
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

function DeviceList({ title, subtitle, items = [], onSelect, valueKey, valueLabel }) {
  return (
    <Panel title={title} subtitle={subtitle}>
      <div className="device-list">
        {items.length ? items.map((item, index) => (
          <button className="device-row" key={`${item.deviceId || item.currentUsername}-${index}`} onClick={() => item.deviceId && onSelect(item)}>
            <div>
              <strong>{shortDeviceId(item.deviceId)}</strong>
              <span>{item.usernames?.length ? item.usernames.join(', ') : item.currentUsername || 'Unknown name'}</span>
              <small>Last seen {formatDate(item.lastSeenAt)}</small>
            </div>
            <div className="device-metric">
              <strong>{formatNumber(item[valueKey])}</strong>
              <span>{valueLabel}</span>
            </div>
          </button>
        )) : <Empty label="No device signals yet." />}
      </div>
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
            {initialFilter.type.replace('ageBand', 'age').replace('deviceId', 'device')} · {initialFilter.type === 'deviceId' ? shortDeviceId(initialFilter.value) : initialFilter.value}
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
        <Stat label="Risk" value={identity.risk?.score || 0} />
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
      <section>
        <h4>Repeat Offender Timeline</h4>
        <Timeline items={detail.timeline || []} />
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
  const [severity, setSeverity] = useState(report.severity || 'medium');
  const [assignedAdminId, setAssignedAdminId] = useState(report.assignedAdminId || '');
  const [followUpAt, setFollowUpAt] = useState(report.followUpAt ? formatDateInput(report.followUpAt) : '');
  const chat = useAsync(() => api(`/api/admin/messages/history/${encodeURIComponent(report.reportingUser)}/${encodeURIComponent(report.reportedUser)}`), [report._id]);
  async function save() {
    await api(`/api/admin/reports/${report._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, adminNotes: notes, severity, assignedAdminId, followUpAt })
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
        <label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}><option>low</option><option>medium</option><option>high</option><option>critical</option></select></label>
        <label>Assigned admin<input value={assignedAdminId} onChange={e => setAssignedAdminId(e.target.value)} placeholder="Admin id or name" /></label>
        <label>Follow-up date<input type="date" value={followUpAt} onChange={e => setFollowUpAt(e.target.value)} /></label>
        <label>Admin notes<textarea value={notes} onChange={e => setNotes(e.target.value)} rows="4" /></label>
      </div>
      <div className="action-row">
        <button className="primary" onClick={save}><CheckCircle2 size={16} /> Save review</button>
        <button className="ghost" onClick={() => downloadEvidence(`/api/admin/evidence/report/${report._id}`, `report-${report._id}.json`)}><Download size={16} /> Export evidence</button>
      </div>
      <section>
        <h4>Related Conversation</h4>
        {chat.loading && <Loading label="Loading evidence..." />}
        {chat.data && <MessageFeed messages={chat.data} />}
      </section>
    </div>
  );
}

function CasesPage() {
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const { loading, data, error } = useAsync(() => api(`/api/admin/cases?status=${encodeURIComponent(status)}`), [status, refresh]);
  return (
    <div className="split-layout">
      <Panel title="Case Management" subtitle="Severity, owner, notes, and follow-up reminders">
        <Toolbar>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">All cases</option>
            <option value="open">Open</option>
            <option value="in_review">In review</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </Toolbar>
        {loading && <Loading label="Loading cases..." />}
        {error && <ErrorState message={error} />}
        <div className="report-list">
          {(data || []).map(report => (
            <button key={report._id} className={selected?._id === report._id ? 'report-card active' : 'report-card'} onClick={() => setSelected(report)}>
              <span className={`status ${report.status}`}>{report.status}</span>
              <span className={`severity ${report.severity || 'medium'}`}>{report.severity || 'medium'}</span>
              <strong>{report.reportedUser}</strong>
              <small>Assigned: {report.assignedAdminId || 'Unassigned'} · Follow-up: {report.followUpAt ? formatDate(report.followUpAt) : 'None'}</small>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Case Detail" subtitle={selected ? selected.reason : 'Select a case'}>
        {selected ? <ReportDetail report={selected} onUpdated={() => setRefresh(x => x + 1)} /> : <Empty label="Select a case to manage." />}
      </Panel>
    </div>
  );
}

function StoragePage({ openLightbox }) {
  const [olderThanDays, setOlderThanDays] = useState('30');
  const [minBytes, setMinBytes] = useState(`${512 * 1024}`);
  const [refresh, setRefresh] = useState(0);
  const { loading, data, error } = useAsync(() => api(`/api/admin/storage/cleanup?olderThanDays=${olderThanDays}&minBytes=${minBytes}`), [olderThanDays, minBytes, refresh]);
  async function deleteMedia(item) {
    if (!confirm(`Delete ${item.filename || item.originalUrl} from admin media storage?`)) return;
    await api(`/api/admin/media/${item._id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'storage_cleanup' }) });
    setRefresh(x => x + 1);
  }
  return (
    <div className="page-stack">
      <Toolbar>
        <label>Older than days<input type="number" value={olderThanDays} onChange={e => setOlderThanDays(e.target.value)} /></label>
        <label>Minimum size<input type="number" value={minBytes} onChange={e => setMinBytes(e.target.value)} /></label>
        <span className="range-caption">{data ? `${formatNumber(data.summary.count)} retained files · ${formatBytes(data.summary.bytes)}` : ''}</span>
      </Toolbar>
      {loading && <Loading label="Loading cleanup candidates..." />}
      {error && <ErrorState message={error} />}
      {data && (
        <Panel title="Storage Cleanup Center" subtitle="Review large or old media before deletion">
          <div className="cleanup-grid">
            {data.items.map(item => {
              const url = `${location.origin}/api/admin/media/${item._id}/content`;
              return (
                <article className="cleanup-card" key={item._id}>
                  <MediaPreview url={url} alt={item.filename || 'media'} onOpen={() => openLightbox(url)} />
                  <div className="cleanup-card-body">
                    <strong title={item.filename || 'Media item'}>{item.filename || 'Media item'}</strong>
                    <span>{item.uploader || 'Unknown uploader'}</span>
                    <span>{formatBytes(item.byteLength)} · {formatDate(item.createdAt)}</span>
                  </div>
                  <button className="danger subtle" onClick={() => deleteMedia(item)}><Trash2 size={14} /> Delete after review</button>
                </article>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}

function MediaPreview({ url, alt, onOpen }) {
  const [failed, setFailed] = useState(false);
  return (
    <button className={failed ? 'media-preview failed' : 'media-preview'} onClick={onOpen} type="button">
      {failed ? (
        <div>
          <Image size={28} />
          <span>Preview unavailable</span>
        </div>
      ) : (
        <img src={url} alt={alt} onError={() => setFailed(true)} />
      )}
    </button>
  );
}

function SettingsPage({ me }) {
  const [confirmation, setConfirmation] = useState('');
  const [wipeResult, setWipeResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { loading, data, error } = useAsync(() => api('/api/admin/settings/summary'), [refresh]);
  async function wipeData() {
    if (confirmation !== 'WIPE COMFI DATA') return;
    if (!confirm('This will permanently delete chats, users, reports, media, blocks, identities, and uploads. Admin accounts are kept. Continue?')) return;
    setBusy(true);
    try {
      const result = await api('/api/admin/settings/wipe-data', {
        method: 'POST',
        body: JSON.stringify({ confirmation })
      });
      setWipeResult(result.deleted);
      setConfirmation('');
      setRefresh(x => x + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-stack">
      {loading && <Loading label="Loading settings..." />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          <section className="settings-grid">
            <Panel title="Recommended Admin Settings" subtitle="Operational defaults for a moderation-heavy chat service">
              <div className="settings-list">
                {data.recommendations.map(item => (
                  <div className="settings-row" key={item.title}>
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Data Summary" subtitle="Current records that would be affected by cleanup actions">
              <div className="settings-count-grid">
                <Stat label="Messages" value={data.counts.messages} />
                <Stat label="Reports" value={data.counts.reports} />
                <Stat label="Registered users" value={data.counts.registeredUsers} />
                <Stat label="Temp users" value={data.counts.tempUsers} />
                <Stat label="Media" value={data.counts.media} />
                <Stat label="Media size" value={formatBytes(data.counts.mediaBytes)} />
              </div>
            </Panel>
          </section>
          <AdminAccountsPanel me={me} />
          <MailSettingsPanel mail={data.mail} recommendations={data.mailRecommendations} onSaved={() => setRefresh(x => x + 1)} />
          <Panel title="Danger Zone" subtitle="Use before public launch to remove test data. Admin accounts are preserved.">
            <div className="danger-zone">
              <AlertTriangle size={28} />
              <div>
                <strong>Wipe all service data</strong>
                <p>This deletes chats, reports, registered users, pending users, temp users, login events, media records, uploaded files, blocks, moderation actions, and identity groupings. Admin accounts are not deleted.</p>
                <label>
                  Type <code>WIPE COMFI DATA</code> to confirm
                  <input value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="WIPE COMFI DATA" />
                </label>
                <button className="danger" disabled={confirmation !== 'WIPE COMFI DATA' || busy} onClick={wipeData}>
                  <Trash2 size={16} /> {busy ? 'Wiping...' : 'Wipe all service data'}
                </button>
                {wipeResult && (
                  <div className="surface-note">
                    Deleted: {Object.entries(wipeResult).map(([key, value]) => `${key}: ${value}`).join(', ')}
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function MailSettingsPanel({ mail, recommendations, onSaved }) {
  const [form, setForm] = useState(mail || {});
  const [password, setPassword] = useState('');
  const [testRecipient, setTestRecipient] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setForm(mail || {});
    setPassword('');
  }, [mail]);

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function applyIcloudDefaults() {
    const icloud = recommendations?.icloud || {};
    setForm(prev => ({
      ...prev,
      provider: 'icloud',
      host: icloud.host || 'smtp.mail.me.com',
      port: icloud.port || 587,
      secure: !!icloud.secure,
      authMethod: icloud.authMethod || 'LOGIN',
      fromAddress: prev.fromAddress || recommendations?.fromAddress || 'no-reply@comfi.chat',
      replyTo: prev.replyTo || recommendations?.replyTo || 'support@comfi.chat',
      fromName: prev.fromName || 'ComfiChat'
    }));
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const result = await api('/api/admin/settings/mail', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          port: Number(form.port || 587),
          password: password || undefined
        })
      });
      setForm(result.mail);
      setPassword('');
      setStatus('Mail settings saved.');
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Failed to save mail settings.');
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setStatus('');
    setError('');
    try {
      const result = await api('/api/admin/settings/mail/test', {
        method: 'POST',
        body: JSON.stringify({ recipient: testRecipient })
      });
      setStatus(`Test email sent via ${result.source}.${result.preview ? ` Preview: ${result.preview}` : ''}`);
    } catch (err) {
      setError(err.message || 'Failed to send test email.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Panel title="Mail Configuration" subtitle="Transactional email for verification and account messages">
      <form className="mail-settings-form" onSubmit={save}>
        <div className="mail-settings-heading">
          <div className="settings-row compact">
            <Mail size={18} />
            <div>
              <strong>Recommended sender</strong>
              <span>Use <code>no-reply@comfi.chat</code> for verification emails and <code>support@comfi.chat</code> for replies.</span>
            </div>
          </div>
          <button type="button" className="ghost" onClick={applyIcloudDefaults}>Use iCloud SMTP defaults</button>
        </div>
        <div className="form-grid two">
          <label>
            Enable mail sending
            <select value={form.enabled ? 'yes' : 'no'} onChange={e => update('enabled', e.target.value === 'yes')}>
              <option value="no">Disabled</option>
              <option value="yes">Enabled</option>
            </select>
          </label>
          <label>
            Provider
            <select value={form.provider || 'icloud'} onChange={e => update('provider', e.target.value)}>
              <option value="icloud">Apple iCloud Mail</option>
              <option value="custom-smtp">Custom SMTP</option>
            </select>
          </label>
          <label>
            SMTP host
            <input value={form.host || ''} onChange={e => update('host', e.target.value)} placeholder="smtp.mail.me.com" />
          </label>
          <label>
            SMTP port
            <input type="number" value={form.port || 587} onChange={e => update('port', e.target.value)} placeholder="587" min="1" max="65535" />
          </label>
          <label>
            Security
            <select value={form.secure ? 'ssl' : 'starttls'} onChange={e => update('secure', e.target.value === 'ssl')}>
              <option value="starttls">STARTTLS, usually port 587</option>
              <option value="ssl">SSL/TLS, usually port 465</option>
            </select>
          </label>
          <label>
            SMTP auth method
            <select value={form.authMethod || 'LOGIN'} onChange={e => update('authMethod', e.target.value)}>
              <option value="LOGIN">LOGIN, recommended for iCloud</option>
              <option value="PLAIN">PLAIN</option>
            </select>
          </label>
          <label>
            SMTP username
            <input value={form.username || ''} onChange={e => update('username', e.target.value)} placeholder="your Apple Account email, e.g. name@icloud.com" />
            <small>For iCloud, this is usually the Apple Account/iCloud email that generated the app-specific password, not the no-reply sender alias.</small>
          </label>
          <label>
            SMTP password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={form.hasPassword ? 'Saved - leave blank to keep' : 'App-specific password'} />
          </label>
          <label>
            Sending email address
            <input type="email" value={form.fromAddress || ''} onChange={e => update('fromAddress', e.target.value)} placeholder="no-reply@comfi.chat" />
          </label>
          <label>
            Sender name
            <input value={form.fromName || ''} onChange={e => update('fromName', e.target.value)} placeholder="ComfiChat" />
          </label>
          <label>
            Reply-to address
            <input type="email" value={form.replyTo || ''} onChange={e => update('replyTo', e.target.value)} placeholder="support@comfi.chat" />
          </label>
        </div>
        <div className="surface-note">
          For iCloud custom domain mail, use <code>smtp.mail.me.com</code>, port <code>587</code>, STARTTLS, your Apple Account/iCloud login email as the SMTP username, and an Apple app-specific password. The sending address can still be <code>no-reply@comfi.chat</code>.
        </div>
        <div className="action-row">
          <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save mail settings'}</button>
          <input className="test-email-input" value={testRecipient} onChange={e => setTestRecipient(e.target.value)} placeholder="Send test to..." type="email" />
          <button type="button" className="ghost" disabled={!testRecipient || testing} onClick={sendTest}><Send size={16} /> {testing ? 'Sending...' : 'Send test'}</button>
        </div>
        {status && <div className="surface-note success">{status}</div>}
        {error && <div className="surface-note danger-note">{error}</div>}
      </form>
    </Panel>
  );
}

const ADMIN_ROLE_OPTIONS = ['owner', 'admin', 'moderator', 'viewer'];
const ROLE_HELP = {
  owner: 'Full access, including owner accounts and destructive launch cleanup.',
  admin: 'Can manage settings, admin accounts, and moderation operations.',
  moderator: 'Can perform moderation work but cannot manage admin accounts or mail settings.',
  viewer: 'Read-only admin portal access.'
};

function AdminAccountsPanel({ me }) {
  const canManage = me && (me.role === 'owner' || me.role === 'admin');
  const [refresh, setRefresh] = useState(0);
  const [createForm, setCreateForm] = useState({ username: '', email: '', password: '', role: 'viewer' });
  const [passwords, setPasswords] = useState({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [secretResult, setSecretResult] = useState(null);
  const { loading, data, error: loadError } = useAsync(
    () => canManage ? api('/api/admin/auth/users') : Promise.resolve([]),
    [canManage, refresh]
  );

  function updateCreate(field, value) {
    setCreateForm(prev => ({ ...prev, [field]: value }));
  }

  async function createAdmin(event) {
    event.preventDefault();
    setStatus('');
    setError('');
    setSecretResult(null);
    try {
      const result = await api('/api/admin/auth/users', {
        method: 'POST',
        body: JSON.stringify(createForm)
      });
      setSecretResult({ username: result.admin.username, totpSecret: result.totpSecret, otpauth: result.otpauth });
      setStatus(`Created ${result.admin.username}. Save the MFA secret before closing this page.`);
      setCreateForm({ username: '', email: '', password: '', role: 'viewer' });
      setRefresh(x => x + 1);
    } catch (err) {
      setError(err.message || 'Failed to create admin account.');
    }
  }

  async function updateAdmin(admin, patch) {
    setStatus('');
    setError('');
    try {
      await api(`/api/admin/auth/users/${admin.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      setStatus(`Updated ${admin.username}.`);
      setRefresh(x => x + 1);
    } catch (err) {
      setError(err.message || 'Failed to update admin account.');
    }
  }

  async function rotatePassword(admin) {
    const password = passwords[admin.id] || '';
    if (password.length < 8) {
      setError('New admin passwords must be at least 8 characters.');
      return;
    }
    setStatus('');
    setError('');
    try {
      await api(`/api/admin/auth/users/${admin.id}/password`, {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      setPasswords(prev => ({ ...prev, [admin.id]: '' }));
      setStatus(`Password rotated for ${admin.username}.`);
    } catch (err) {
      setError(err.message || 'Failed to rotate password.');
    }
  }

  async function resetMfa(admin) {
    if (!confirm(`Reset MFA for ${admin.username}? Their old authenticator code will stop working.`)) return;
    setStatus('');
    setError('');
    setSecretResult(null);
    try {
      const result = await api(`/api/admin/auth/users/${admin.id}/mfa-reset`, { method: 'POST', body: JSON.stringify({}) });
      setSecretResult({ username: admin.username, totpSecret: result.totpSecret, otpauth: result.otpauth });
      setStatus(`MFA reset for ${admin.username}. Save the new MFA secret before closing this page.`);
    } catch (err) {
      setError(err.message || 'Failed to reset MFA.');
    }
  }

  if (!canManage) {
    return (
      <Panel title="Admin Accounts" subtitle="Owner/admin permission required">
        <div className="surface-note">Your role can view portal data, but account management is restricted to owner and admin accounts.</div>
      </Panel>
    );
  }

  return (
    <Panel title="Admin Accounts" subtitle="Create accounts, rotate passwords, assign roles, and reset MFA">
      <div className="admin-account-grid">
        <form className="form-grid admin-create-form" onSubmit={createAdmin}>
          <label>
            Username
            <input value={createForm.username} onChange={e => updateCreate('username', e.target.value)} required />
          </label>
          <label>
            Email
            <input type="email" value={createForm.email} onChange={e => updateCreate('email', e.target.value)} required />
          </label>
          <label>
            Initial password
            <input type="password" value={createForm.password} onChange={e => updateCreate('password', e.target.value)} minLength="8" required />
          </label>
          <label>
            Role
            <select value={createForm.role} onChange={e => updateCreate('role', e.target.value)}>
              {ADMIN_ROLE_OPTIONS.filter(role => me.role === 'owner' || role !== 'owner').map(role => (
                <option key={role} value={role}>{titleCase(role)}</option>
              ))}
            </select>
          </label>
          <button className="primary"><UserPlus size={16} /> Create admin account</button>
        </form>

        <div className="settings-list">
          {ADMIN_ROLE_OPTIONS.map(role => (
            <div className="settings-row compact" key={role}>
              <Shield size={18} />
              <div>
                <strong>{titleCase(role)}</strong>
                <span>{ROLE_HELP[role]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {loading && <Loading label="Loading admin accounts..." />}
      {loadError && <ErrorState message={loadError} />}
      {data && (
        <div className="table-wrap admin-accounts-table">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th>Status</th>
                <th>Password</th>
                <th>MFA</th>
              </tr>
            </thead>
            <tbody>
              {data.map(admin => {
                const isSelf = admin.id === me.id;
                return (
                  <tr key={admin.id}>
                    <td>
                      <strong>{admin.username}</strong>
                      <span className="muted-block">{admin.email}</span>
                      <span className="muted-block">Last login: {formatDate(admin.lastLoginAt)}</span>
                    </td>
                    <td>
                      <select
                        value={admin.role}
                        disabled={admin.role === 'owner' && me.role !== 'owner'}
                        onChange={e => updateAdmin(admin, { role: e.target.value })}
                      >
                        {ADMIN_ROLE_OPTIONS.filter(role => me.role === 'owner' || role !== 'owner').map(role => (
                          <option key={role} value={role}>{titleCase(role)}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={admin.isActive ? 'active' : 'inactive'}
                        disabled={isSelf}
                        onChange={e => updateAdmin(admin, { isActive: e.target.value === 'active' })}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                    <td>
                      <div className="inline-admin-action">
                        <input
                          type="password"
                          value={passwords[admin.id] || ''}
                          onChange={e => setPasswords(prev => ({ ...prev, [admin.id]: e.target.value }))}
                          placeholder="New password"
                        />
                        <button className="ghost" type="button" onClick={() => rotatePassword(admin)}><KeyRound size={16} /> Rotate</button>
                      </div>
                    </td>
                    <td>
                      <button className="ghost" type="button" onClick={() => resetMfa(admin)}>Reset MFA</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {secretResult && (
        <div className="surface-note success admin-secret-box">
          <strong>MFA secret for {secretResult.username}</strong>
          <code>{secretResult.totpSecret}</code>
          <textarea readOnly value={secretResult.otpauth} />
        </div>
      )}
      {status && <div className="surface-note success">{status}</div>}
      {error && <div className="surface-note danger-note">{error}</div>}
    </Panel>
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
  function exportConversation() {
    if (!selected) return;
    const params = new URLSearchParams({
      userA: selected.userA,
      userB: selected.userB,
      ...(selected.devA ? { devA: selected.devA } : {}),
      ...(selected.devB ? { devB: selected.devB } : {})
    });
    downloadEvidence(`/api/admin/evidence/conversation?${params.toString()}`, `conversation-${selected.userA}-${selected.userB}.json`);
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
            {selected && (
              <div className="action-row">
                <button className="ghost" onClick={exportConversation}><Download size={16} /> Export evidence</button>
                <button className="danger subtle" onClick={clearConversation}><Trash2 size={16} /> Clear conversation</button>
              </div>
            )}
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

function Timeline({ items = [] }) {
  if (!items.length) return <Empty label="No timeline events yet." />;
  return (
    <div className="timeline">
      {items.map((item, index) => (
        <div className="timeline-item" key={`${item.type}-${item.at}-${index}`}>
          <span>{formatDate(item.at)}</span>
          <strong>{item.title}</strong>
          <small>{item.type}</small>
        </div>
      ))}
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
  return <div className="stat"><span>{label}</span><strong>{typeof value === 'number' ? formatNumber(value) : value || 0}</strong></div>;
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

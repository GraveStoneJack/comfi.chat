async function api(path, options = {}) {
	const res = await fetch(path, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

function show(viewId) {
	document.getElementById('login-view').style.display = viewId === 'login' ? 'block' : 'none';
	document.getElementById('console-view').style.display = viewId === 'console' ? 'block' : 'none';
}

function switchTab(tab) {
	document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
	document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${tab}`));
}

async function loadReports() {
	try {
		const list = document.getElementById('reports-list');
		list.innerHTML = 'Loading...';
		const reports = await api('/api/admin/reports');
		list.innerHTML = '';
		reports.forEach(r => {
			const item = document.createElement('div');
			item.className = 'item';
			item.textContent = `[${r.status}] ${r.reportingUser} -> ${r.reportedUser} — ${r.reason} • ${new Date(r.createdAt).toLocaleString()}`;
			item.addEventListener('click', async () => {
				const detail = await api(`/api/admin/reports/${r._id}`);
				const d = document.getElementById('report-detail');
				d.innerHTML = `
					<h4>Report</h4>
					<div><strong>Reporter:</strong> ${detail.reportingUser}</div>
					<div><strong>Reported:</strong> ${detail.reportedUser}</div>
					<div><strong>Reason:</strong> ${detail.reason}</div>
					<div><strong>Notes:</strong> ${detail.additionalInfo || ''}</div>
					<div><strong>Created:</strong> ${new Date(detail.createdAt).toLocaleString()}</div>
				`;
				// Pre-fill chat viewer
				document.getElementById('user-a').value = detail.reportingUser;
				document.getElementById('user-b').value = detail.reportedUser;
				switchTab('chats');
				await loadChat();
			});
			list.appendChild(item);
		});
	} catch (e) {
		document.getElementById('reports-list').innerHTML = 'Failed to load reports';
	}
}

function isImageMessage(text) {
	return typeof text === 'string' && (text.startsWith('[image]') || /\.(png|jpe?g|gif|webp|avif)$/i.test(text));
}
function getImageUrlFromMessage(text) {
	if (!text) return '';
	const raw = text.startsWith('[image]') ? text.substring(7).trim() : text.trim();
	if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
		return `${location.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
	}
	return raw;
}

async function loadChat() {
	const a = document.getElementById('user-a').value.trim();
	const b = document.getElementById('user-b').value.trim();
	if (!a || !b) return;
	const history = await api(`/api/admin/messages/history/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
	const container = document.getElementById('chat-history');
	container.innerHTML = '';
	history.forEach(m => {
		const el = document.createElement('div');
		el.className = 'msg';
		if (isImageMessage(m.message)) {
			const url = getImageUrlFromMessage(m.message);
			el.innerHTML = `<div><strong>${m.sender}</strong> • ${new Date(m.timestamp).toLocaleString()}</div><img src="${url}" alt="img">`;
		} else {
			el.innerHTML = `<div><strong>${m.sender}</strong> • ${new Date(m.timestamp).toLocaleString()}</div><div>${m.message}</div>`;
		}
		container.appendChild(el);
	});
}

document.addEventListener('DOMContentLoaded', async () => {
	// Tabs
	document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
	document.getElementById('load-chat').addEventListener('click', loadChat);
	document.getElementById('logout-btn').addEventListener('click', async () => {
		await api('/api/admin/auth/logout', { method: 'POST' });
		show('login');
	});
	document.getElementById('create-admin-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const payload = {
			username: document.getElementById('new-username').value.trim(),
			email: document.getElementById('new-email').value.trim(),
			password: document.getElementById('new-password').value,
			role: document.getElementById('new-role').value
		};
		try {
			const res = await api('/api/admin/auth/users', { method: 'POST', body: JSON.stringify(payload) });
			document.getElementById('create-admin-result').textContent = `Created admin id ${res.id}`;
		} catch (e1) {
			document.getElementById('create-admin-result').textContent = 'Failed to create admin';
		}
	});

	// Auth flow
	const loginForm = document.getElementById('login-form');
	const mfaForm = document.getElementById('mfa-form');
	const loginError = document.getElementById('login-error');
	let tempToken = null;

	loginForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		loginError.textContent = '';
		try {
			const res = await api('/api/admin/auth/login', {
				method: 'POST',
				body: JSON.stringify({
					username: document.getElementById('username').value.trim(),
					password: document.getElementById('password').value
				})
			});
			if (res.mfaRequired) {
				tempToken = res.tempToken;
				mfaForm.style.display = 'block';
				loginForm.style.display = 'none';
			}
		} catch (_e) {
			loginError.textContent = 'Invalid credentials';
		}
	});

	mfaForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		loginError.textContent = '';
		try {
			await api('/api/admin/auth/mfa/verify', {
				method: 'POST',
				body: JSON.stringify({ code: document.getElementById('mfa-code').value.trim(), tempToken })
			});
			const me = await api('/api/admin/auth/me');
			document.getElementById('me-label').textContent = `${me.username} (${me.role})`;
			show('console');
			switchTab('reports');
			loadReports();
		} catch (_e) {
			loginError.textContent = 'Invalid code';
		}
	});

	// Attempt silent session
	try {
		const me = await api('/api/admin/auth/me');
		document.getElementById('me-label').textContent = `${me.username} (${me.role})`;
		show('console');
		switchTab('reports');
		loadReports();
	} catch (_) {
		show('login');
	}
});



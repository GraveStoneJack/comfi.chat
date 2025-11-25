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

// --- Users tab helpers ---
let PEOPLE_CACHE = [];
let SELECTED_PERSON = null; // { username, deviceId }

async function loadPeople(force = false) {
	try {
		if (!force && PEOPLE_CACHE.length) {
			renderPeople(PEOPLE_CACHE);
			return;
		}
		const people = await api('/api/admin/users/all');
		PEOPLE_CACHE = Array.isArray(people) ? people : [];
		renderPeople(PEOPLE_CACHE);
	} catch (_e) {
		const list = document.getElementById('people-list');
		if (list) list.innerHTML = 'Failed to load people';
	}
}

function renderPeople(listInput) {
	const list = document.getElementById('people-list');
	if (!list) return;
	const search = (document.getElementById('people-search')?.value || '').toLowerCase().trim();
	const filtered = listInput.filter(p => !search || (p.username || '').toLowerCase().includes(search));
	list.innerHTML = '';
	filtered.forEach(p => {
		const item = document.createElement('div');
		item.className = 'item';
		const last = new Date(p.lastAt || Date.now()).toLocaleString();
		const devShort = (p.deviceId || 'unknown').slice(-6);
		item.innerHTML = `
			<div><strong>${p.username}</strong> <span class="muted">· dev ${devShort}</span></div>
			<div class="muted">Msgs: ${p.messagesCount || 0} · Images: ${p.imagesCount || 0} · Last: ${last}</div>
		`;
		item.addEventListener('click', () => selectPerson({ username: p.username, deviceId: p.deviceId || null }));
		list.appendChild(item);
	});
}

async function selectPerson(identity) {
	SELECTED_PERSON = identity; // { username, deviceId }
	const header = document.getElementById('selected-user-header');
	if (header) {
		const devShort = (identity.deviceId || 'unknown').slice(-6);
		header.innerHTML = `<strong>${identity.username}</strong> <span class="muted">· dev ${devShort}</span>`;
	}
	await Promise.all([loadConversations(identity.username, identity.deviceId), loadUserImages(identity.username, identity.deviceId)]);
}

async function loadConversations(username, deviceId) {
	try {
		const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
		const convos = await api(`/api/admin/users/${encodeURIComponent(username)}/conversations${qs}`);
		const list = document.getElementById('conversations-list');
		if (!list) return;
		list.innerHTML = '';
		convos.forEach(c => {
			const item = document.createElement('div');
			item.className = 'item';
			item.innerHTML = `
				<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
					<div>
						<strong>${c.with}</strong> <span class="muted">${c.withDeviceId ? '· dev ' + String(c.withDeviceId).slice(-6) : ''}</span>
						<div class="muted">Msgs: ${c.messagesCount} · ${new Date(c.lastAt).toLocaleString()}</div>
					</div>
					<div>
						<button class="open-transcript" data-with="${c.with}" data-withdev="${c.withDeviceId || ''}" title="Open full transcript">Open</button>
					</div>
				</div>
			`;
			item.addEventListener('click', () => viewConversation(username, c.with, deviceId || null, c.withDeviceId || null));
			list.appendChild(item);
		});
			// Wire transcript openers
			list.querySelectorAll('.open-transcript').forEach(btn => {
				btn.addEventListener('click', (ev) => {
					ev.stopPropagation();
					const withUser = btn.getAttribute('data-with');
					const withDev = btn.getAttribute('data-withdev');
					const u = new URL('./session.html', location.href);
					u.searchParams.set('userA', username);
					if (deviceId) u.searchParams.set('devA', deviceId);
					u.searchParams.set('userB', withUser);
					if (withDev) u.searchParams.set('devB', withDev);
					window.open(u.toString(), '_blank', 'noopener,noreferrer');
				});
			});
		// Clear viewer on list reload
		const hist = document.getElementById('user-chat-history');
		if (hist) hist.innerHTML = '';
	} catch (_e) {
		const list = document.getElementById('conversations-list');
		if (list) list.innerHTML = 'Failed to load conversations';
	}
}

async function viewConversation(a, b, devA, devB) {
	try {
		let url = `/api/admin/messages/history/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
		const params = [];
		if (devA) params.push(`devA=${encodeURIComponent(devA)}`);
		if (devB) params.push(`devB=${encodeURIComponent(devB)}`);
		if (params.length) url += `?${params.join('&')}`;
		const history = await api(url);
		const container = document.getElementById('user-chat-history');
		if (!container) return;
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
	} catch (_e) {
		const container = document.getElementById('user-chat-history');
		if (container) container.innerHTML = 'Failed to load chat history';
	}
}

async function loadUserImages(username, deviceId) {
	try {
		const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
		const images = await api(`/api/admin/users/${encodeURIComponent(username)}/images${qs}`);
		const grid = document.getElementById('user-media');
		if (!grid) return;
		grid.innerHTML = '';
		images.forEach(img => {
			if (!isImageMessage(img.message)) return;
			const url = getImageUrlFromMessage(img.message);
			const card = document.createElement('div');
			card.className = 'thumb';
			card.innerHTML = `
				<img src="${url}" alt="img">
				<div class="muted">to ${img.recipient} • ${new Date(img.timestamp).toLocaleString()}</div>
			`;
			card.addEventListener('click', () => openAdminLightbox(url));
			grid.appendChild(card);
		});
	} catch (_e) {
		const grid = document.getElementById('user-media');
		if (grid) grid.innerHTML = 'Failed to load images';
	}
}

function openAdminLightbox(url) {
	const lb = document.getElementById('admin-lightbox');
	const img = document.getElementById('admin-lightbox-img');
	const a = document.getElementById('admin-download-link');
	if (!lb || !img || !a) return;
	img.src = url;
	a.href = url;
	lb.style.display = 'block';
}

function closeAdminLightbox() {
	const lb = document.getElementById('admin-lightbox');
	const img = document.getElementById('admin-lightbox-img');
	if (!lb) return;
	lb.style.display = 'none';
	if (img) img.src = '';
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
	// Always resolve via admin proxy for durability (DB fallback). Keep data URLs as-is.
	if (/^data:image\//i.test(raw)) return raw;
	return `${location.origin}/api/admin/media/resolve?src=${encodeURIComponent(raw)}`;
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
			el.querySelector('img')?.addEventListener('click', () => openAdminLightbox(url));
		} else {
			el.innerHTML = `<div><strong>${m.sender}</strong> • ${new Date(m.timestamp).toLocaleString()}</div><div>${m.message}</div>`;
		}
		container.appendChild(el);
	});
}

document.addEventListener('DOMContentLoaded', async () => {
	// Tabs
	document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
		switchTab(btn.dataset.tab);
		if (btn.dataset.tab === 'reports') loadReports();
		if (btn.dataset.tab === 'users') loadPeople();
	}));
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
	// Users tab controls
	const peopleSearch = document.getElementById('people-search');
	if (peopleSearch) peopleSearch.addEventListener('input', () => renderPeople(PEOPLE_CACHE));
	const reloadBtn = document.getElementById('reload-people');
	if (reloadBtn) reloadBtn.addEventListener('click', () => loadPeople(true));
	// Lightbox controls
	const lbClose = document.getElementById('admin-lightbox-close');
	const lbOverlay = document.getElementById('admin-lightbox-overlay');
	if (lbClose) lbClose.addEventListener('click', closeAdminLightbox);
	if (lbOverlay) lbOverlay.addEventListener('click', closeAdminLightbox);
});



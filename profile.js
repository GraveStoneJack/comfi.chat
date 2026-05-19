// profile.js
const API_URL = 'https://luxeonchat-backend.onrender.com';

function getQueryParams() {
    const params = new URLSearchParams(location.search);
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
}

function resolveProfilePicture(url) {
    if (!url || url === 'default-profile.png') return '';
    if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:')) return url;
    return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function setSelectValue(el, value) {
    if (!el || value == null || value === '') return;
    const v = String(value);
    if ([...el.options].some((o) => o.value === v)) {
        el.value = v;
    }
}

function setMultiSelectValues(el, values) {
    if (!el) return;
    const list = Array.isArray(values)
        ? values
        : (typeof values === 'string' ? values.split(',').map((s) => s.trim()).filter(Boolean) : []);
    for (const opt of el.options) {
        opt.selected = list.includes(opt.value);
    }
}

function populateProfileForm(user, avatar) {
    document.getElementById('username').value = user.username || '';
    document.getElementById('displayName').value = user.displayName || '';
    setSelectValue(document.getElementById('age'), user.age);
    setSelectValue(document.getElementById('gender'), user.gender);
    setSelectValue(document.getElementById('transgender'), user.transgender);
    setSelectValue(document.getElementById('sexuality'), user.sexuality);
    setMultiSelectValues(document.getElementById('lookingFor'), user.lookingFor);
    setSelectValue(document.getElementById('hairType'), user.hairType);
    setSelectValue(document.getElementById('hairColor'), user.hairColor);
    setSelectValue(document.getElementById('eyeColor'), user.eyeColor);
    setSelectValue(document.getElementById('ethnicity'), user.ethnicity);
    const hobbies = Array.isArray(user.hobbies) ? user.hobbies.join(', ') : (user.hobbies || '');
    document.getElementById('hobbies').value = hobbies;

    const pic = resolveProfilePicture(user.profilePicture);
    if (pic) {
        avatar.src = pic;
        avatar.dataset.url = pic;
    }
}

function collectProfilePayload(avatar) {
    return {
        username: document.getElementById('username').value.trim(),
        displayName: document.getElementById('displayName').value.trim(),
        age: parseInt(document.getElementById('age').value, 10),
        gender: document.getElementById('gender').value,
        transgender: document.getElementById('transgender').value || undefined,
        sexuality: document.getElementById('sexuality').value || undefined,
        lookingFor: Array.from(document.getElementById('lookingFor').selectedOptions).map((o) => o.value),
        hairType: document.getElementById('hairType').value || undefined,
        hairColor: document.getElementById('hairColor').value || undefined,
        eyeColor: document.getElementById('eyeColor').value || undefined,
        ethnicity: document.getElementById('ethnicity').value || undefined,
        hobbies: document.getElementById('hobbies').value,
        profilePicture: avatar.dataset.url || undefined
    };
}

function validateProfilePayload(payload, isEditMode) {
    if (!payload.displayName || !payload.age || !payload.gender || !payload.sexuality) {
        alert('Please fill in display name, age, gender, and sexuality.');
        return false;
    }
    if (!isEditMode && !payload.username) {
        alert('Please fill in username.');
        return false;
    }
    return true;
}

function persistUserSession(user, token) {
    if (token) sessionStorage.setItem('authToken', token);
    sessionStorage.setItem('user', JSON.stringify(user));
    sessionStorage.setItem('tempUser', JSON.stringify({
        username: user.username,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        gender: user.gender,
        age: user.age
    }));
}

document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('profile-form');
    const ageSelect = document.getElementById('age');
    const fileInput = document.getElementById('file-input');
    const avatar = document.getElementById('avatar');
    const uploadBtn = document.getElementById('upload-btn');
    const goChatBtn = document.getElementById('go-chat');
    const saveBtn = document.getElementById('save-profile');
    const usernameInput = document.getElementById('username');
    const profileTitle = document.getElementById('profile-title');
    const profileSubtitle = document.getElementById('profile-subtitle');

    for (let i = 13; i <= 100; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        ageSelect.appendChild(opt);
    }

    const params = getQueryParams();
    const authToken = sessionStorage.getItem('authToken');
    const isEditMode = Boolean(authToken);
    const provider = params.provider || (isEditMode ? 'registered' : 'email-verified');

    if (isEditMode) {
        if (profileTitle) profileTitle.textContent = 'Your profile';
        if (profileSubtitle) profileSubtitle.textContent = 'View and update how others see you on ComfiChat.';
        if (saveBtn) saveBtn.textContent = 'Save profile';
        if (usernameInput) {
            usernameInput.readOnly = true;
            usernameInput.title = 'Username cannot be changed';
        }
        try {
            const res = await fetch(`${API_URL}/api/users/me`, {
                headers: { Authorization: `Bearer ${authToken}` }
            });
            if (res.status === 401) {
                sessionStorage.removeItem('authToken');
                sessionStorage.removeItem('user');
                window.location.href = '/login.html';
                return;
            }
            if (!res.ok) throw new Error('Failed to load profile');
            const me = await res.json();
            populateProfileForm(me, avatar);
        } catch (err) {
            console.error('Load profile error', err);
            alert('Could not load your profile. Please try again from chat.');
        }
    }

    uploadBtn.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: fd });
            if (!res.ok) throw new Error('Upload failed');
            const data = await res.json();
            const resolved = resolveProfilePicture(data.fileUrl || '');
            avatar.src = resolved;
            avatar.dataset.url = resolved;
        } catch (_e1) {
            alert('Upload failed. Please try a smaller image.');
        }
    });

    goChatBtn.addEventListener('click', () => {
        window.location.href = isEditMode ? '/chat.html' : '/chat';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = collectProfilePayload(avatar);
        if (!validateProfilePayload(payload, isEditMode)) return;

        try {
            if (isEditMode) {
                const { username, provider: _p, providerId: _id, ...updateBody } = {
                    ...payload,
                    provider,
                    providerId: params.providerId
                };
                const res = await fetch(`${API_URL}/api/users/me`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authToken}`
                    },
                    body: JSON.stringify(updateBody)
                });
                const data = await res.json();
                if (!res.ok) {
                    alert(data.error || 'Failed to update profile');
                    return;
                }
                persistUserSession(data, authToken);
                alert('Profile saved.');
                window.location.href = '/chat.html';
                return;
            }

            const registerPayload = {
                ...payload,
                provider,
                providerId: params.providerId || undefined
            };

            let res;
            let data;
            if (provider === 'email-verified') {
                const tempToken = sessionStorage.getItem('pendingTempToken');
                res = await fetch(`${API_URL}/api/auth/email/finalize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tempToken, ...registerPayload })
                });
                data = await res.json();
            } else {
                res = await fetch(`${API_URL}/api/users/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(registerPayload)
                });
                data = await res.json();
            }
            if (!res.ok) {
                alert(data.error || 'Registration failed');
                return;
            }
            persistUserSession(data.user, data.token);
            window.location.href = '/chat';
        } catch (err) {
            console.error('Profile save error', err);
            alert(isEditMode ? 'Failed to update profile' : 'Registration failed');
        }
    });
});

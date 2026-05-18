// profile.js
const API_URL = 'https://luxeonchat-backend.onrender.com';

function getQueryParams() {
    const params = new URLSearchParams(location.search);
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('profile-form');
    const ageSelect = document.getElementById('age');
    const fileInput = document.getElementById('file-input');
    const avatar = document.getElementById('avatar');
    const uploadBtn = document.getElementById('upload-btn');
    const goChatBtn = document.getElementById('go-chat');

    for (let i = 13; i <= 100; i++) {
        const opt = document.createElement('option');
        opt.value = i; opt.textContent = i; ageSelect.appendChild(opt);
    }

    const params = getQueryParams();
    const provider = params.provider || 'email-verified';

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
            const url = data.fileUrl || '';
            const resolved = (url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:'))
                ? url
                : `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
            avatar.src = resolved;
            avatar.dataset.url = resolved;
        } catch (e1) {
            alert('Upload failed. Please try a smaller image.');
        }
    });

    goChatBtn.addEventListener('click', () => {
        window.location.href = '/chat';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            username: document.getElementById('username').value.trim(),
            displayName: document.getElementById('displayName').value.trim(),
            age: parseInt(document.getElementById('age').value, 10),
            gender: document.getElementById('gender').value,
            sexuality: document.getElementById('sexuality').value || undefined,
            lookingFor: Array.from(document.getElementById('lookingFor').selectedOptions).map(o => o.value),
            hairType: document.getElementById('hairType').value || undefined,
            hairColor: document.getElementById('hairColor').value || undefined,
            eyeColor: document.getElementById('eyeColor').value || undefined,
            ethnicity: document.getElementById('ethnicity').value || undefined,
            hobbies: document.getElementById('hobbies').value,
            profilePicture: avatar.dataset.url || undefined,
            provider: provider,
            providerId: params.providerId || undefined
        };

        if (!payload.username || !payload.displayName || !payload.age || !payload.gender || !payload.sexuality) {
            alert('Please fill in username, display name, age, gender, and sexuality.');
            return;
        }

        try {
            let res, data;
            if (provider === 'email-verified') {
                const tempToken = sessionStorage.getItem('pendingTempToken');
                res = await fetch(`${API_URL}/api/auth/email/finalize`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tempToken, ...payload }) });
                data = await res.json();
            } else {
                // social or other provider uses generic register without password
                res = await fetch(`${API_URL}/api/users/register`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                data = await res.json();
            }
            if (!res.ok) {
                alert(data.error || 'Registration failed');
                return;
            }
            sessionStorage.setItem('authToken', data.token);
            sessionStorage.setItem('user', JSON.stringify(data.user));
            // Also seed tempUser session so chat works with existing flow
            sessionStorage.setItem('tempUser', JSON.stringify({ username: data.user.username }));
            window.location.href = '/chat';
        } catch (err) {
            console.error('Register error', err);
            alert('Registration failed');
        }
    });
});



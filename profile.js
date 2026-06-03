// profile.js
const API_URL = 'https://luxeonchat-backend.onrender.com';
const MAX_PROFILE_PHOTOS = 10;
const DEFAULT_PROFILE_PICTURE = 'default-profile.png';
const DEFAULT_AVATAR_SRC = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'><stop stop-color='%23f5efff' offset='0'/><stop stop-color='%23efe6ff' offset='1'/></linearGradient></defs><rect width='400' height='400' fill='url(%23g)'/><circle cx='200' cy='150' r='70' fill='%23d3c6f3'/><path d='M80 320c20-70 90-90 120-90s100 20 120 90' fill='%23d3c6f3'/></svg>";

function getQueryParams() {
    const params = new URLSearchParams(location.search);
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
}

function uploadsPathFromUrl(url) {
    if (!url) return '';
    const match = /\/uploads\/([^?#]+)/i.exec(String(url));
    return match ? `/uploads/${match[1]}` : '';
}

function normalizeProfilePictureForSave(url) {
    if (url === DEFAULT_PROFILE_PICTURE) return DEFAULT_PROFILE_PICTURE;
    if (!url) return undefined;
    const uploadsPath = uploadsPathFromUrl(url);
    if (uploadsPath) return uploadsPath;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    return url;
}

function normalizePhotoListForSave(list) {
    return (Array.isArray(list) ? list : [])
        .map(item => normalizeProfilePictureForSave(item))
        .filter(Boolean)
        .slice(0, MAX_PROFILE_PHOTOS);
}

function resolveProfilePicture(url) {
    if (!url || url === DEFAULT_PROFILE_PICTURE) return '';
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const uploadsPath = uploadsPathFromUrl(url);
    if (uploadsPath) {
        return `${API_URL}/api/upload/resolve?src=${encodeURIComponent(uploadsPath)}`;
    }
    if (url.startsWith('http')) return url;
    return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function titleCase(value) {
    if (!value) return '';
    return String(value)
        .split('-')
        .map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
        .join(' ');
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

function chip(text) {
    const span = document.createElement('span');
    span.className = 'profile-chip';
    span.textContent = text;
    return span;
}

function persistUserSession(user, token) {
    if (token) sessionStorage.setItem('authToken', token);
    sessionStorage.setItem('user', JSON.stringify(user));
    sessionStorage.setItem('tempUser', JSON.stringify({
        username: user.username,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        profilePhotos: user.profilePhotos || [],
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
    const removeAvatarBtn = document.getElementById('remove-avatar-btn');
    const goChatBtn = document.getElementById('go-chat');
    const saveBtn = document.getElementById('save-profile');
    const usernameInput = document.getElementById('username');
    const profileTitle = document.getElementById('profile-title');
    const profileSubtitle = document.getElementById('profile-subtitle');
    const profileView = document.getElementById('profile-view');
    const profileEditor = document.getElementById('profile-editor');
    const editProfileBtn = document.getElementById('edit-profile-btn');
    const viewBackChat = document.getElementById('view-back-chat');
    const publicLink = document.getElementById('view-public-link');
    const galleryFileInput = document.getElementById('gallery-file-input');
    const galleryUploadBtn = document.getElementById('gallery-upload-btn');
    const galleryEditorGrid = document.getElementById('gallery-editor-grid');
    const galleryCount = document.getElementById('gallery-count');
    const viewPhoto = document.getElementById('view-photo');
    const viewPhotoFallback = document.getElementById('view-photo-fallback');
    const galleryPrev = document.getElementById('gallery-prev');
    const galleryNext = document.getElementById('gallery-next');
    const thumbnails = document.getElementById('profile-thumbnails');
    const galleryEmpty = document.getElementById('view-gallery-empty');

    let currentProfile = null;
    let galleryPhotos = [];
    let activePhotoIndex = 0;

    for (let i = 13; i <= 100; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        ageSelect.appendChild(opt);
    }

    const params = getQueryParams();
    const authToken = sessionStorage.getItem('authToken');
    const isLoggedInProfile = Boolean(authToken);
    const provider = params.provider || (isLoggedInProfile ? 'registered' : 'email-verified');

    function setButtonBusy(button, label) {
        if (!button) return;
        button.classList.add('is-busy');
        button.setAttribute('aria-busy', 'true');
        if (label) button.textContent = label;
    }

    function showView() {
        profileView.classList.remove('hidden');
        profileEditor.classList.add('hidden');
        profileTitle.textContent = 'Your profile';
        profileSubtitle.textContent = 'This is how other people will see you on ComfiChat.';
    }

    function showEditor() {
        profileView.classList.add('hidden');
        profileEditor.classList.remove('hidden');
        profileTitle.textContent = isLoggedInProfile ? 'Edit your profile' : 'Create your profile';
        profileSubtitle.textContent = isLoggedInProfile
            ? 'Update your details and profile photos.'
            : 'Complete your details so others can recognize you.';
        saveBtn.textContent = isLoggedInProfile ? 'Save profile' : 'Save & Continue';
        goChatBtn.textContent = isLoggedInProfile ? 'Cancel' : 'Back to chat';
    }

    function allDisplayPhotos(profile) {
        return [
            profile.profilePicture,
            ...(Array.isArray(profile.profilePhotos) ? profile.profilePhotos : [])
        ].filter(photo => photo && photo !== DEFAULT_PROFILE_PICTURE);
    }

    function renderReadonlyProfile(profile) {
        const displayName = profile.displayName || profile.username || 'Comfi user';
        const photos = allDisplayPhotos(profile);
        activePhotoIndex = Math.min(activePhotoIndex, Math.max(photos.length - 1, 0));
        document.getElementById('view-display-name').textContent = displayName;
        document.getElementById('view-username').textContent = profile.username ? `@${profile.username}` : '';
        document.getElementById('view-hair').textContent = [titleCase(profile.hairType), titleCase(profile.hairColor)].filter(Boolean).join(' / ') || 'Not shared';
        document.getElementById('view-eyes').textContent = titleCase(profile.eyeColor) || 'Not shared';
        document.getElementById('view-ethnicity').textContent = titleCase(profile.ethnicity) || 'Not shared';
        document.getElementById('view-transgender').textContent = titleCase(profile.transgender) || 'Not shared';
        if (publicLink && profile.username) publicLink.href = `/u/${encodeURIComponent(profile.username)}`;

        const chips = document.getElementById('view-chips');
        chips.innerHTML = '';
        [
            profile.age ? `${profile.age}` : '',
            titleCase(profile.gender),
            titleCase(profile.sexuality),
            profile.country
        ].filter(Boolean).forEach(item => chips.appendChild(chip(item)));

        const lookingFor = document.getElementById('view-looking-for');
        lookingFor.innerHTML = '';
        (profile.lookingFor || []).forEach(item => lookingFor.appendChild(chip(`Looking for ${titleCase(item).toLowerCase()}`)));

        const hobbies = document.getElementById('view-hobbies');
        hobbies.innerHTML = '';
        (Array.isArray(profile.hobbies) ? profile.hobbies : []).forEach(item => hobbies.appendChild(chip(item)));

        if (photos.length) {
            viewPhoto.classList.remove('hidden');
            viewPhotoFallback.classList.add('hidden');
            viewPhoto.src = resolveProfilePicture(photos[activePhotoIndex]);
            viewPhoto.alt = `${displayName} profile photo ${activePhotoIndex + 1}`;
        } else {
            viewPhoto.classList.add('hidden');
            viewPhotoFallback.classList.remove('hidden');
            viewPhotoFallback.textContent = (displayName[0] || 'C').toUpperCase();
        }

        thumbnails.innerHTML = '';
        photos.forEach((photo, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = index === activePhotoIndex ? 'active' : '';
            btn.innerHTML = `<img src="${resolveProfilePicture(photo)}" alt="Photo ${index + 1}">`;
            btn.addEventListener('click', () => {
                activePhotoIndex = index;
                renderReadonlyProfile(profile);
            });
            thumbnails.appendChild(btn);
        });
        thumbnails.classList.toggle('hidden', photos.length <= 1);
        galleryPrev.classList.toggle('hidden', photos.length <= 1);
        galleryNext.classList.toggle('hidden', photos.length <= 1);
        galleryEmpty.classList.toggle('hidden', (profile.profilePhotos || []).length > 0);
    }

    function populateProfileForm(user) {
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
        document.getElementById('hobbies').value = Array.isArray(user.hobbies) ? user.hobbies.join(', ') : (user.hobbies || '');
        const pic = resolveProfilePicture(user.profilePicture);
        avatar.dataset.url = user.profilePicture || DEFAULT_PROFILE_PICTURE;
        avatar.src = pic || DEFAULT_AVATAR_SRC;
        galleryPhotos = normalizePhotoListForSave(user.profilePhotos || []);
        renderGalleryEditor();
    }

    function renderGalleryEditor() {
        galleryCount.textContent = galleryPhotos.length;
        galleryUploadBtn.disabled = galleryPhotos.length >= MAX_PROFILE_PHOTOS;
        galleryEditorGrid.innerHTML = '';
        if (!galleryPhotos.length) {
            const empty = document.createElement('p');
            empty.className = 'profile-gallery-empty';
            empty.textContent = 'No gallery photos yet.';
            galleryEditorGrid.appendChild(empty);
            return;
        }
        galleryPhotos.forEach((photo, index) => {
            const item = document.createElement('div');
            item.className = 'gallery-editor-item';
            item.innerHTML = `<img src="${resolveProfilePicture(photo)}" alt="Gallery photo ${index + 1}"><button type="button" aria-label="Remove photo"><i class="fas fa-times"></i></button>`;
            item.querySelector('button').addEventListener('click', () => {
                galleryPhotos.splice(index, 1);
                renderGalleryEditor();
            });
            galleryEditorGrid.appendChild(item);
        });
    }

    function collectProfilePayload() {
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
            profilePicture: normalizeProfilePictureForSave(avatar.dataset.url) || DEFAULT_PROFILE_PICTURE,
            profilePhotos: normalizePhotoListForSave(galleryPhotos)
        };
    }

    function validateProfilePayload(payload) {
        if (!payload.displayName || !payload.age || !payload.gender || !payload.sexuality) {
            alert('Please fill in display name, age, gender, and sexuality.');
            return false;
        }
        if (!isLoggedInProfile && !payload.username) {
            alert('Please fill in username.');
            return false;
        }
        return true;
    }

    async function uploadFile(file) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        return data.fileUrl || '';
    }

    if (isLoggedInProfile) {
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
            currentProfile = await res.json();
            persistUserSession(currentProfile, authToken);
            populateProfileForm(currentProfile);
            renderReadonlyProfile(currentProfile);
            showView();
        } catch (err) {
            console.error('Load profile error', err);
            alert('Could not load your profile. Please try again from chat.');
            showEditor();
        }
    } else {
        showEditor();
    }

    editProfileBtn.addEventListener('click', () => {
        if (currentProfile) populateProfileForm(currentProfile);
        showEditor();
    });

    viewBackChat.addEventListener('click', () => {
        setButtonBusy(viewBackChat, 'Opening chat...');
        window.location.href = '/chat.html';
    });

    galleryPrev.addEventListener('click', () => {
        const photos = allDisplayPhotos(currentProfile || {});
        if (!photos.length) return;
        activePhotoIndex = (activePhotoIndex - 1 + photos.length) % photos.length;
        renderReadonlyProfile(currentProfile);
    });

    galleryNext.addEventListener('click', () => {
        const photos = allDisplayPhotos(currentProfile || {});
        if (!photos.length) return;
        activePhotoIndex = (activePhotoIndex + 1) % photos.length;
        renderReadonlyProfile(currentProfile);
    });

    uploadBtn.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
    removeAvatarBtn.addEventListener('click', () => {
        avatar.src = DEFAULT_AVATAR_SRC;
        avatar.dataset.url = DEFAULT_PROFILE_PICTURE;
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const stored = await uploadFile(file);
            avatar.src = resolveProfilePicture(stored);
            avatar.dataset.url = stored;
        } catch (_e1) {
            alert('Upload failed. Please try a smaller image.');
        } finally {
            fileInput.value = '';
        }
    });

    galleryUploadBtn.addEventListener('click', () => galleryFileInput.click());
    galleryFileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        const slots = MAX_PROFILE_PHOTOS - galleryPhotos.length;
        if (files.length > slots) {
            alert(`You can add ${slots} more profile photo${slots === 1 ? '' : 's'}.`);
        }
        try {
            for (const file of files.slice(0, slots)) {
                const stored = await uploadFile(file);
                if (stored) galleryPhotos.push(stored);
            }
            renderGalleryEditor();
        } catch (_e) {
            alert('One of the uploads failed. Please try a smaller image.');
        } finally {
            galleryFileInput.value = '';
        }
    });

    goChatBtn.addEventListener('click', () => {
        if (isLoggedInProfile && currentProfile) {
            setButtonBusy(goChatBtn, 'Cancelling...');
            populateProfileForm(currentProfile);
            renderReadonlyProfile(currentProfile);
            window.setTimeout(() => {
                showView();
                goChatBtn.classList.remove('is-busy');
                goChatBtn.removeAttribute('aria-busy');
                goChatBtn.textContent = 'Cancel';
            }, 120);
            return;
        }
        setButtonBusy(goChatBtn, 'Opening chat...');
        window.location.href = '/chat';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = collectProfilePayload();
        if (!validateProfilePayload(payload)) return;

        try {
            if (isLoggedInProfile) {
                const { username, ...updateBody } = payload;
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
                currentProfile = data;
                persistUserSession(data, authToken);
                populateProfileForm(data);
                activePhotoIndex = 0;
                renderReadonlyProfile(data);
                showView();
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
            alert(isLoggedInProfile ? 'Failed to update profile' : 'Registration failed');
        }
    });
});

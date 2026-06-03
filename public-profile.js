const API_URL = 'https://luxeonchat-backend.onrender.com';

function uploadsPathFromUrl(url) {
    if (!url) return '';
    const match = /\/uploads\/([^?#]+)/i.exec(String(url));
    return match ? `/uploads/${match[1]}` : '';
}

function resolveProfilePicture(url) {
    if (!url || url === 'default-profile.png') return '';
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const uploadsPath = uploadsPathFromUrl(url);
    if (uploadsPath) return `${API_URL}/api/upload/resolve?src=${encodeURIComponent(uploadsPath)}`;
    if (url.startsWith('http')) return url;
    return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function titleCase(value) {
    if (!value) return '';
    return String(value).split('-').map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
}

function chip(text) {
    const span = document.createElement('span');
    span.className = 'profile-chip';
    span.textContent = text;
    return span;
}

function usernameFromPath() {
    const path = window.location.pathname.replace(/^\/u\/?/, '').split('/')[0];
    const query = new URLSearchParams(window.location.search).get('username');
    return decodeURIComponent(path || query || '').trim();
}

document.addEventListener('DOMContentLoaded', async () => {
    const username = usernameFromPath();
    const root = document.getElementById('profile-root');
    if (!username) {
        root.innerHTML = '<div class="profile-card"><h1>Profile not found</h1><p>Missing username.</p></div>';
        return;
    }

    let profile;
    try {
        const res = await fetch(`${API_URL}/api/users/public/${encodeURIComponent(username)}`);
        if (!res.ok) throw new Error('Profile not found');
        profile = await res.json();
    } catch (_e) {
        root.innerHTML = '<div class="profile-card"><h1>Profile not found</h1><p>This ComfiChat profile is unavailable.</p></div>';
        return;
    }

    let activePhotoIndex = 0;
    const displayName = profile.displayName || profile.username || 'Comfi user';
    const photos = [profile.profilePicture, ...(profile.profilePhotos || [])].filter(Boolean);
    const viewPhoto = document.getElementById('view-photo');
    const fallback = document.getElementById('view-photo-fallback');
    const thumbnails = document.getElementById('profile-thumbnails');
    const prev = document.getElementById('gallery-prev');
    const next = document.getElementById('gallery-next');

    document.title = `${displayName} on ComfiChat`;
    document.getElementById('page-title').textContent = displayName;
    document.getElementById('view-display-name').textContent = displayName;
    document.getElementById('view-username').textContent = profile.username ? `@${profile.username}` : '';
    document.getElementById('view-hair').textContent = [titleCase(profile.hairType), titleCase(profile.hairColor)].filter(Boolean).join(' / ') || 'Not shared';
    document.getElementById('view-eyes').textContent = titleCase(profile.eyeColor) || 'Not shared';
    document.getElementById('view-ethnicity').textContent = titleCase(profile.ethnicity) || 'Not shared';
    document.getElementById('view-transgender').textContent = titleCase(profile.transgender) || 'Not shared';

    const chips = document.getElementById('view-chips');
    [profile.age ? `${profile.age}` : '', titleCase(profile.gender), titleCase(profile.sexuality), profile.country]
        .filter(Boolean)
        .forEach(item => chips.appendChild(chip(item)));

    const lookingFor = document.getElementById('view-looking-for');
    (profile.lookingFor || []).forEach(item => lookingFor.appendChild(chip(`Looking for ${titleCase(item).toLowerCase()}`)));

    const hobbies = document.getElementById('view-hobbies');
    (profile.hobbies || []).forEach(item => hobbies.appendChild(chip(item)));

    function renderPhoto() {
        if (photos.length) {
            viewPhoto.classList.remove('hidden');
            fallback.classList.add('hidden');
            viewPhoto.src = resolveProfilePicture(photos[activePhotoIndex]);
            viewPhoto.alt = `${displayName} profile photo ${activePhotoIndex + 1}`;
        } else {
            viewPhoto.classList.add('hidden');
            fallback.classList.remove('hidden');
            fallback.textContent = (displayName[0] || 'C').toUpperCase();
        }

        thumbnails.innerHTML = '';
        photos.forEach((photo, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = index === activePhotoIndex ? 'active' : '';
            btn.innerHTML = `<img src="${resolveProfilePicture(photo)}" alt="Photo ${index + 1}">`;
            btn.addEventListener('click', () => {
                activePhotoIndex = index;
                renderPhoto();
            });
            thumbnails.appendChild(btn);
        });
        thumbnails.classList.toggle('hidden', photos.length <= 1);
        prev.classList.toggle('hidden', photos.length <= 1);
        next.classList.toggle('hidden', photos.length <= 1);
    }

    prev.addEventListener('click', () => {
        if (!photos.length) return;
        activePhotoIndex = (activePhotoIndex - 1 + photos.length) % photos.length;
        renderPhoto();
    });
    next.addEventListener('click', () => {
        if (!photos.length) return;
        activePhotoIndex = (activePhotoIndex + 1) % photos.length;
        renderPhoto();
    });

    renderPhoto();
});

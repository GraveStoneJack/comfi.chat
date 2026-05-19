// script.js
const API_URL = 'https://luxeonchat-backend.onrender.com';

// Stable device identifier (per browser install)
function getDeviceId() {
    const KEY = 'comfi.deviceId';
    let id = localStorage.getItem(KEY);
    if (!id) {
        id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
        localStorage.setItem(KEY, id);
    }
    return id;
}

document.addEventListener('DOMContentLoaded', () => {
    // Theme Manager (Auto/Light/Dark)
    const themeBtn = document.getElementById('theme-toggle-btn');
    const THEME_KEY = 'comfi.theme'; // values: 'auto' | 'light' | 'dark'

    function getSystemPref() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    function applyTheme(mode) {
        const resolved = mode === 'auto' ? getSystemPref() : mode;
        document.body.classList.toggle('dark', resolved === 'dark');
        if (themeBtn) themeBtn.innerHTML = `<i class="fas ${resolved === 'dark' ? 'fa-moon' : 'fa-sun'}"></i> ${mode === 'auto' ? 'Auto' : (resolved === 'dark' ? 'Dark' : 'Light')}`;
    }
    function loadTheme() { return localStorage.getItem(THEME_KEY) || 'auto'; }
    function saveTheme(mode) { localStorage.setItem(THEME_KEY, mode); }
    function cycleTheme(current) {
        if (current === 'auto') return 'light';
        if (current === 'light') return 'dark';
        return 'auto';
    }
    let themeMode = loadTheme();
    applyTheme(themeMode);
    // expose for other pages (e.g., chat redirect) via a tiny session flag
    sessionStorage.setItem('comfi.theme.resolved', themeMode === 'auto' ? getSystemPref() : themeMode);
    if (themeBtn) themeBtn.addEventListener('click', () => {
        themeMode = cycleTheme(themeMode);
        saveTheme(themeMode);
        applyTheme(themeMode);
        sessionStorage.setItem('comfi.theme.resolved', themeMode === 'auto' ? getSystemPref() : themeMode);
    });
    // React to system changes when in auto
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto');
        });
    }
    const backBtnContainer = document.getElementById('back-btn-container');
    const backBtn = document.getElementById('back-btn');
    const authSection = document.querySelector('.auth-section');
    const mainContent = authSection.innerHTML;

    backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        authSection.innerHTML = mainContent;
        backBtnContainer.style.display = 'none';
        reattachAuthLinks();
    });

    if (window.location.hash === '#sign-in') {
        showSignInForm();
        backBtnContainer.style.display = 'block';
    }

    function generateAgeOptions() {
        let options = '';
        for (let i = 13; i <= 100; i++) {
            options += `<option value="${i}">${i}</option>`;
        }
        return options;
    }

    function showSignInForm() {
        authSection.innerHTML = `
            <h2>Sign in</h2>
            <div class="auth-options">
                <button type="button" class="auth-btn google-btn signin-google-btn">
                    <i class="fab fa-google"></i> Sign in with Google
                </button>
                <button type="button" class="auth-btn apple-btn signin-apple-btn">
                    <i class="fab fa-apple"></i> Sign in with Apple
                </button>
                <button type="button" class="auth-btn email-btn signin-email-btn">
                    <i class="far fa-envelope"></i> Sign in with Email
                </button>
            </div>
        `;

        authSection.querySelector('.signin-google-btn')?.addEventListener('click', () => {
            window.location.href = '/profile.html?provider=google';
        });
        authSection.querySelector('.signin-apple-btn')?.addEventListener('click', () => {
            window.location.href = '/profile.html?provider=apple';
        });
        authSection.querySelector('.signin-email-btn')?.addEventListener('click', () => {
            window.location.href = '/login.html';
        });
    }

    function showTalkToStrangersForm() {
        authSection.innerHTML = `
            <h2>Talk to Strangers</h2>
            <form id="talk-to-strangers-form">
                <div class="form-group">
                    <input type="text" id="username" placeholder="Username" required>
                </div>
                <div class="form-group">
                    <select id="age" required>
                        <option value="">Select Age</option>
                        ${generateAgeOptions()}
                    </select>
                </div>
                <div class="form-group">
                    <select id="gender" required>
                        <option value="">Select Gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <div id="country-display" class="country-display">
                        <img id="country-flag" src="" alt="" class="flag-icon">
                        <span id="country-name"></span>
                    </div>
                </div>
                <button type="submit" id="start-chatting-btn" class="submit-btn">Start Chatting</button>
            </form>
        `;

        const form = document.getElementById('talk-to-strangers-form');

        // Automatically detect and display the user's country
        fetch('https://ipapi.co/json/')
            .then(response => response.json())
            .then(data => {
                const countryName = data.country_name;
                const countryCode = data.country_code.toLowerCase();

                const countryNameElement = document.getElementById('country-name');
                const countryFlagElement = document.getElementById('country-flag');
                const countryDisplayElement = document.getElementById('country-display');

                if (countryNameElement && countryFlagElement && countryDisplayElement) {
                    countryNameElement.textContent = countryName;
                    countryFlagElement.src = `https://flagcdn.com/w160/${countryCode}.png`;
                    countryFlagElement.alt = countryName;
                    countryDisplayElement.style.display = 'flex';

                    // Debug log
                    console.log('Country detection:', { countryName, countryCode });
                }
            })
            .catch(error => {
                console.error('Error detecting country:', error);
                const countryDisplay = document.getElementById('country-display');
                if (countryDisplay) {
                    countryDisplay.textContent = 'Unable to detect country';
                }
            });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Get form values
            const username = document.getElementById('username').value.trim();
            const age = parseInt(document.getElementById('age').value);
            const gender = document.getElementById('gender').value;
            const countryName = document.getElementById('country-name').textContent;
            const countryFlag = document.getElementById('country-flag').src;
            const countryCode = countryFlag.split('/').pop().split('.')[0];

            // Debug log
            console.log('Form Data:', {
                username,
                age,
                gender,
                country: countryName,
                countryCode
            });

            // Validate data before sending
            if (!username || !age || !gender || !countryName || !countryCode) {
                const missingFields = [];
                if (!username) missingFields.push('username');
                if (!age) missingFields.push('age');
                if (!gender) missingFields.push('gender');
                if (!countryName) missingFields.push('country');
                if (!countryCode) missingFields.push('countryCode');

                console.log('Validation failed - missing fields:', missingFields);
                alert('Please fill in all fields');
                return;
            }

            try {
                console.log('Sending request to server...');
                const response = await fetch(`${API_URL}/api/temp-users/create`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username,
                        age,
                        gender,
                        country: countryName,
                        countryCode,
                        deviceId: getDeviceId()
                    }),
                });

                // Debug log
                console.log('Response status:', response.status);

                const data = await response.json();
                console.log('Response data:', data);

                if (response.ok) {
                    console.log('User created successfully:', data);
                    sessionStorage.setItem('tempUser', JSON.stringify(data));
                    window.location.href = '/chat';
                } else if (data.code === 'username_registered') {
                    alert('This username belongs to a registered account. Please sign in instead.');
                    showSignInForm();
                    backBtnContainer.style.display = 'block';
                } else {
                    console.error('Server error:', data);
                    alert(data.error || 'Error creating temporary user');
                }
            } catch (error) {
                console.error('Fetch error:', error);
                alert('Error creating temporary user. Please try again.');
            }
        });
    }

    function reattachAuthLinks() {
        const newTalkStrangersBtn = document.querySelector('.talk-strangers-btn');
        if (newTalkStrangersBtn) {
            newTalkStrangersBtn.addEventListener('click', (e) => {
                e.preventDefault();
                showTalkToStrangersForm();
                backBtnContainer.style.display = 'block';
            });
        }
        const signInLink = document.querySelector('.sign-in-link');
        if (signInLink) {
            signInLink.addEventListener('click', (e) => {
                e.preventDefault();
                showSignInForm();
                backBtnContainer.style.display = 'block';
            });
        }
        const googleBtn = document.querySelector('.google-btn');
        const appleBtn = document.querySelector('.apple-btn');
        const emailBtn = document.querySelector('.email-btn');
        googleBtn?.addEventListener('click', () => { window.location.href = '/profile.html?provider=google'; });
        appleBtn?.addEventListener('click', () => { window.location.href = '/profile.html?provider=apple'; });
        emailBtn?.addEventListener('click', () => { window.location.href = '/signup.html'; });
    }

    reattachAuthLinks();
});

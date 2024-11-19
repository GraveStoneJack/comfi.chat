// Backend
const API_URL = 'https://luxeonchat-backend.onrender.com';

document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is logged in
    const currentUser = JSON.parse(sessionStorage.getItem('tempUser'));
    if (!currentUser) {
        window.location.href = '/';
        return;
    }

    // DOM element references
    const logoutBtn = document.getElementById('logout-btn');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const onlineTab = document.getElementById('online-tab');
    const chatsTab = document.getElementById('chats-tab');
    const chatHeader = document.querySelector('.chat-header');
    const messages = document.querySelector('.messages');
    const messageInput = document.getElementById('message-text');
    const sendBtn = document.getElementById('send-btn');
    const onlineCount = document.getElementById('online-count');
    const chatsCount = document.getElementById('chats-count');
    const genderFilter = document.getElementById('gender-filter');
    const countryFilter = document.getElementById('country-filter');
    const ageMinSelect = document.getElementById('age-min');
    const ageMaxSelect = document.getElementById('age-max');
    const applyFiltersBtn = document.getElementById('apply-filters');
    const clearFiltersBtn = document.getElementById('clear-filters');
    const reportPopup = document.getElementById('report-popup');
    const reportForm = document.getElementById('report-form');
    const chatArea = document.querySelector('.chat-area');

    let onlineUsers = [];
    let activeChats = [];
    let currentChatUser = null;

    // Initialize chat area as inactive
    chatArea.classList.remove('active');

    // Update user's online status when page loads
    try {
        await fetch(`${API_URL}/api/temp-users/status/${currentUser.username}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ isOnline: true }),
        });
    } catch (error) {
        console.error('Error updating initial online status:', error);
    }

    // Fetch online users from the server
    async function fetchOnlineUsers() {
        try {
            const response = await fetch(`${API_URL}/api/temp-users/online`);
            if (response.ok) {
                const users = await response.json();
                // Filter out current user from the list
                onlineUsers = users.filter(user => user.username !== currentUser.username);
                updateOnlineUsers();
                populateCountryFilter();

                // Debug log to check updates
                console.log('Fetched online users:', onlineUsers);
            }
        } catch (error) {
            console.error('Error fetching online users:', error);
        }
    }

    // Initial fetch
    await fetchOnlineUsers();

    // Frequent polling for online users (every 3 seconds)
    const onlineUsersInterval = setInterval(fetchOnlineUsers, 3000);

    // Logout button handler
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                // Disable the logout button to prevent double-clicks
                logoutBtn.disabled = true;

                // Set user as offline
               const statusResponse =  await fetch(`${API_URL}/api/temp-users/status/${currentUser.username}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ isOnline: false }),
                });

                if (!statusResponse.ok) {
                    console.error('Failed to update online status');
                }

                // Delete the user
                const deleteResponse = await fetch(`${API_URL}/api/temp-users/delete/${currentUser.username}`, {
                    method: 'DELETE',
                });

                if (!deleteResponse.ok) {
                    console.error('Failed to delete user from the database');
                }

                // Clear intervals before redirecting
                clearInterval(onlineUsersInterval);

                // Clear session storage
                sessionStorage.removeItem('tempUser');

                // Add a small delay before redirecting to ensure requests complete
                setTimeout(() => {
                    window.location.href = '/';
                }, 100);

            } catch (error) {
                console.error('Error during logout:', error);
                // Still clear session and redirect even if there's an error
                clearInterval(onlineUsersInterval);
                sessionStorage.removeItem('tempUser');
                window.location.href = '/';
            } finally {
                logoutBtn.disabled = false;
            }
        });
    } else {
        console.error('Logout button not found in the DOM');
    }

    function updateOnlineUsers() {
        const onlineUsersContainer = document.getElementById('online-users');
        if (!onlineUsersContainer) return;

        // Fragment for better performance
        const fragment = document.createDocumentFragment();

        onlineUsers.forEach(user => {
            const userElement = document.createElement('div');
            userElement.classList.add('user-item');
            userElement.dataset.username = user.username;
            userElement.innerHTML = `
<div class="user-info">
    <div class="user-name">${user.username}</div>
    <div class="user-details">
        ${user.age} |
        <img src="https://flagcdn.com/w160/${user.countryCode.toLowerCase()}.png"
            alt="${user.country}" class="flag-icon">
            ${user.country}
    </div>
</div>
`;
            userElement.addEventListener('click', () => openChat(user));
            fragment.appendChild(userElement);
        });

        // Clear and update the container
        onlineUsersContainer.innerHTML = '';
        onlineUsersContainer.appendChild(fragment);

        // Update the counter
        if (onlineCount) {
            onlineCount.textContent = onlineUsers.length;
        }

        // Debug log
        console.log(`Updated online users list. Count: ${onlineUsers.length}`);
    }

    function updateActiveChats() {
        chatsTab.innerHTML = '';
        activeChats.forEach(chat => {
            const chatElement = document.createElement('div');
            chatElement.classList.add('chat-item');
            chatElement.innerHTML = `
<div class="chat-info">
    <div class="chat-name">${chat.username}</div>
    <div class="chat-details">
        ${chat.age} |
        <img src="https://flagcdn.com/w160/${chat.countryCode.toLowerCase()}.png"
            alt="${chat.country}" class="flag-icon">
            ${chat.country}
    </div>
    <div class="chat-preview">${chat.lastMessage || 'Start chatting...'}</div>
</div>
`;
            chatElement.addEventListener('click', () => openChat(chat));
            chatsTab.appendChild(chatElement);
        });
        chatsCount.textContent = activeChats.length;
    }

    async function populateCountryFilter() {
        const countries = [...new Set(onlineUsers.map(user => user.countryCode))];
        countryFilter.innerHTML = '<option value="all">All Countries</option>';
        countries.forEach(countryCode => {
            const user = onlineUsers.find(u => u.countryCode === countryCode);
            const option = document.createElement('option');
            option.value = countryCode;
            option.innerHTML = `${user.country}`;
            countryFilter.appendChild(option);
        });
    }

    function applyFilters() {
        const gender = genderFilter.value;
        const country = countryFilter.value;
        const minAge = parseInt(ageMinSelect.value) || 13;
        const maxAge = parseInt(ageMaxSelect.value) || 100;

        const filteredUsers = onlineUsers.filter(user => {
            return (gender === 'all' || user.gender === gender) &&
                (country === 'all' || user.countryCode === country) &&
                (user.age >= minAge && user.age <= maxAge);
        });

        updateOnlineUsers(filteredUsers);
    }

    function resetFilters() {
        genderFilter.value = 'all';
        countryFilter.value = 'all';
        ageMinSelect.value = '';
        ageMaxSelect.value = '';
        fetchOnlineUsers(); // Fetch fresh list of online users
    }

    function openChat(user) {
        currentChatUser = user;
        chatArea.classList.add('active');

        // Auto switch to chat tab
        tabBtns.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        const chatsTabBtn = document.querySelector('[data-tab="chats"]');
        chatsTabBtn.classList.add('active');
        document.getElementById('chats-tab').classList.add('active');

        chatHeader.innerHTML = `
<h2>${user.username}</h2>
<div class="user-info">
    ${user.age} |
    <img src="https://flagcdn.com/w160/${user.countryCode.toLowerCase()}.png"
        alt="${user.country}" class="flag-icon">
        ${user.country}
</div>
`;

        const chatActions = document.querySelector('.chat-actions');
        chatActions.innerHTML = `
<button id="block-user-btn" class="action-btn">Block</button>
<button id="report-user-btn" class="action-btn">Report</button>
`;

        messages.innerHTML = ''; // Clear previous messages

        // Add to active chats if not already present
        if (!activeChats.find(chat => chat.username === user.username)) {
            activeChats.push(user);
            updateActiveChats();
        }

        // Reattach event listeners
        document.getElementById('block-user-btn').addEventListener('click', () => {
            if (confirm(`Are you sure you want to block ${user.username}?`)) {
                console.log(`Blocked user: ${user.username}`);
                activeChats = activeChats.filter(chat => chat.username !== user.username);
                updateActiveChats();
                chatArea.classList.remove('active');
            }
        });

        document.getElementById('report-user-btn').addEventListener('click', () => {
            reportPopup.style.display = 'block';
        });
    }

    reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentChatUser) return;

        const reason = document.querySelector('input[name="report-reason"]:checked').value;
        const additionalInfo = document.getElementById('additional-info').value;

        try {
            const response = await fetch(`${API_URL}/api/reports/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    reportedUser: currentChatUser.username,
                    reportingUser: currentUser.username,
                    reason,
                    additionalInfo
                }),
            });

            if (response.ok) {
                alert('Report submitted successfully');
            } else {
                alert('Failed to submit report');
            }
        } catch (error) {
            console.error('Error submitting report:', error);
            alert('Error submitting report');
        }

        reportPopup.style.display = 'none';
    });

    // Close popup when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === reportPopup) {
            reportPopup.style.display = 'none';
        }
    });

    // Populate age dropdowns
    for (let i = 13; i <= 100; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        ageMinSelect.appendChild(option.cloneNode(true));
        ageMaxSelect.appendChild(option);
    }

    // Event listeners
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
        });
    });

    ageMinSelect.addEventListener('change', () => {
        const minAge = parseInt(ageMinSelect.value);
        ageMaxSelect.innerHTML = '<option value="">Max Age</option>';
        for (let i = minAge; i <= 100; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            ageMaxSelect.appendChild(option);
        }
    });

    applyFiltersBtn.addEventListener('click', applyFilters);
    clearFiltersBtn.addEventListener('click', resetFilters);

    sendBtn.addEventListener('click', () => {
        const message = messageInput.value.trim();
        if (message && currentChatUser) {
            // Add message to chat
            const messageElement = document.createElement('div');
            messageElement.classList.add('message', 'outgoing');
            messageElement.innerHTML = `
<div class="message-content">${message}</div>
`;
            messages.appendChild(messageElement);

            // Clear input
            messageInput.value = '';

            // Update last message in active chats
            const chatIndex = activeChats.findIndex(chat => chat.username === currentChatUser.username);
            if (chatIndex !== -1) {
                activeChats[chatIndex].lastMessage = message;
                updateActiveChats();
            }
        }
    });

    // Send message on Enter key press
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevent default to avoid new line
            sendBtn.click(); // Trigger the send button click
        }
    });

    // Update user's online status when leaving
    window.addEventListener('beforeunload', (event) => {
        // Clear intervals
        clearInterval(onlineUsersInterval);

        try {
            // Use fetch with keepalive instead of sendBeacon
            fetch(`${API_URL}/api/temp-users/status/${currentUser.username}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ isOnline: false }),
                keepalive: true
            });

            fetch(`${API_URL}/api/temp-users/delete/${currentUser.username}`, {
                method: 'DELETE',
                keepalive: true
            });
        } catch (error) {
            console.error('Error in beforeunload handler:', error);
        }
    });
});

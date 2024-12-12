// Backend
const API_URL = 'https://luxeonchat-backend.onrender.com';
const WS_URL = 'wss://luxeonchat-backend.onrender.com';
const messageSound = new Audio('https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3?filename=notification-sound-7062.mp3');
messageSound.volume = 0.5;

let socket;

document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is logged in
    const currentUser = JSON.parse(sessionStorage.getItem('tempUser'));
    if (!currentUser) {
        window.location.href = '/';
        return;
    }

    let currentChatUser = null;
    let activeChats = [];
    let onlineUsers = [];

    function initializeWebSocket() {
        socket = new WebSocket(WS_URL);

        function updateConnectionStatus(connected) {
            console.log('WebSocket status:', connected ? 'Connected' : 'Disconnected');
            if (!connected) {
                // Optionally show a connection status indicator to the user
                const statusElement = document.createElement('div');
                statusElement.className = 'connection-status';
                statusElement.textContent = 'Disconnected. Reconnecting...';
                document.body.appendChild(statusElement);
            } else {
                const statusElement = document.querySelector('.connection-status');
                if (statusElement) {
                    statusElement.remove();
                }
            }
        }

        socket.onopen = () => {
            console.log('WebSocket connected');
            updateConnectionStatus(true);
            if (currentUser) {
                socket.send(JSON.stringify({
                    type: 'identify',
                    username: currentUser.username
                }));
            }
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received message:', data);

                if (data.type === 'message-status') {
                    updateMessageStatus(data.messageId, data.status);
                } else if (data.type === 'typing') {
                    updateTypingIndicator(data.sender, data.isTyping);
                } else if (data.type === 'message' && data.sender !== currentUser.username) {
                    playMessageSound();
                    // Send back delivery confirmation
                    socket.send(JSON.stringify({
                        type: 'message-status',
                        messageId: data.messageId,
                        status: 'delivered',
                        recipient: data.sender
                    }));

                    // Determine the other user (sender or recipient)
                    const otherUser = data.sender === currentUser.username ? data.recipient : data.sender;

                    // Add to active chats if not exists
                    let chat = activeChats.find(chat => chat.username === otherUser);

                    if (!chat) {
                        // Find user info from online users or create basic info
                        chat = onlineUsers.find(user => user.username === otherUser) || {
                            username: otherUser,
                            messages: [],
                            lastMessage: data.message,
                            unread: true
                        };
                        activeChats.push(chat);
                    }

                    // Initialize messages array if it doesn't exist
                    if (!chat.messages) {
                        chat.messages = [];
                    }

                    // Add message to chat
                    chat.messages.push({
                        message: data.message,
                        sender: data.sender,
                        timestamp: new Date()
                    });
                    chat.lastMessage = data.message;

                    // Set unread status if chat is not currently open
                    if (!currentChatUser || currentChatUser.username !== otherUser) {
                        chat.unread = true;
                        notifyNewMessage(data.sender, data.message);
                    }

                    // Update chats display
                    updateActiveChats();

                    // If chat window is open with this user, display message
                    if (currentChatUser && (data.sender === currentChatUser.username || data.recipient === currentChatUser.username)) {
                        displayMessage(data.message, data.sender, data.sender === currentUser.username);
                    }
                }
            } catch (error) {
                console.error('Error processing received message:', error);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus(false);
        };

        socket.onclose = () => {
            console.log('WebSocket disconnected. Attempting to reconnect...');
            updateConnectionStatus(false);
            setTimeout(initializeWebSocket, 3000);
        };
    }

    initializeWebSocket();

    function sendMessage(message) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket is not connected');
            return;
        }

        const messageId = Date.now().toString(); // Simple unique ID
        const messageData = {
            type: 'message',
            messageId: messageId,
            recipient: currentChatUser.username,
            sender: currentUser.username,
            message: message
        };
        try {
            socket.send(JSON.stringify(messageData));
            displayMessage(message, currentUser.username, true, messageId);

            // Store the message locally
            const chatIndex = activeChats.findIndex(chat => chat.username === currentChatUser.username);
            if (chatIndex !== -1) {
                if (!activeChats[chatIndex].messages) {
                    activeChats[chatIndex].messages = [];
                }

                activeChats[chatIndex].messages.push({
                    sender: currentUser.username,
                    message: message,
                    timestamp: new Date()
                });

                activeChats[chatIndex].lastMessage = message;
            }

            console.log('Message sent:', messageData);
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    function notifyNewMessage(sender, message) {
        // Update chat tab to show new message indicator
        const chatsTabBtn = document.querySelector('[data-tab="chats"]');
        if (!chatsTabBtn.classList.contains('has-new-message')) {
            chatsTabBtn.classList.add('has-new-message');
        }

        // Show browser notification
        if (Notification.permission === "granted") {
            new Notification(`New message from ${sender}`, {
                body: message,
                icon: '/path/to/your/icon.png'
            });
        }
    }

    // Typing indicator function
    function updateTypingIndicator(username, isTyping) {
        const typingIndicator = document.querySelector('.typing-indicator');
        if (isTyping) {
            if (!typingIndicator) {
                const indicator = document.createElement('div');
                indicator.className = 'typing-indicator';
                indicator.innerHTML = `
                    <span class="typing-text">${username} is typing</span>
                    <div class="typing-dots">
                        <span>.</span><span>.</span><span>.</span>
                    </div>
                `;
                messages.appendChild(indicator);
                messages.scrollTop = messages.scrollHeight;
            }
        } else {
            typingIndicator?.remove();
        }
    }

    function playMessageSound() {
        messageSound.currentTime = 0; // Reset sound to start
        messageSound.play().catch(error  => console.log('Error playing sound:', error));
    }

    // Function to start a chat with a user
    function startChat(user) {
        currentChatUser = user;
        document.querySelector('.chat-area').classList.add('active');
        document.querySelector('.chat-header h2').textContent = `Chat with ${user.username}`;

        // Clear previous messages
        const messagesContainer = document.querySelector('.messages');
        messagesContainer.innerHTML = '';

        // Add to active chats if not already there
        addToActiveChats(user.username);
    }

    // Function to display a message
    function displayMessage(message, sender, isOutgoing, messageId = null) {
        console.log('Displaying message:', { message, sender, isOutgoing, messageId });

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', isOutgoing ? 'outgoing' : 'incoming');
        if (messageId) messageElement.dataset.messageId = messageId;

        messageElement.innerHTML = `
            <div class="message-content">${message}</div>
            <div class="message-info">
                <span class="message-timestamp">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                ${isOutgoing ? '<span class="message-status">✓</span>' : ''}
            </div>
        `;
        messages.appendChild(messageElement);
        messages.scrollTop = messages.scrollHeight;
    }

    function updateMessageStatus(messageId, status) {
        const messageElement = document.querySelector(` [data-message-id="${messageId}"] .message-status`);
        if (messageElement) {
            switch (status) {
                case 'sent': messageElement.textContent = '✓'; break;
                case 'delivered': messageElement.textContent = '✓✓'; break;
                case 'read': messageElement.textContent = '✓✓'; messageElement.style.color = '#4CAF50'; break;
            }
        }
    }

    // Event listener for send button
    document.getElementById('send-btn').addEventListener('click', () => {
        const messageInput = document.getElementById('message-text');
        const message = messageInput.value.trim();

        if (message && currentChatUser) {
            sendMessage(message);
            messageInput.value = '';
        }
    });

    // Function to add user to active chats
    function addToActiveChats(username) {
        if (!activeChats.some(chat => chat.username === username)) {
            activeChats.push({
                username: username,
                lastMessage: '',
                timestamp: new Date()
            });
            updateActiveChats();
        }
    }

    // Function to update active chats display
    function updateActiveChats() {
        const chatsList = document.querySelector('.chats-list');
        const chatsTabContent = document.getElementById('chats-tab');

        // Update both chat containers
        [chatsList, chatsTabContent].forEach(container => {
            if (!container) return;

            container.innerHTML = '';
            activeChats.forEach(chat => {
                const chatElement = document.createElement('div');
                chatElement.classList.add('chat-item');

                // Add unread class if there are unread messages
                if (chat.unread) {
                    chatElement.classList.add('unread');
                }

                chatElement.innerHTML = `
                    <div class="chat-info">
                        <div class="chat-name">
                            ${chat.username}
                            ${chat.unread ? '<span class="unread-dot"></span>' : ''}
                        </div>
                        <div class="chat-details">
                            ${chat.age ? `${chat.age} |` : ''}
                            ${chat.countryCode ? `
                                <img src="https://flagcdn.com/w160/${chat.countryCode.toLowerCase()}.png"
                                    alt="${chat.country}" class="flag-icon">
                                ${chat.country}
                            ` : ''}
                        </div>
                        <div class="chat-preview">${chat.lastMessage || 'Start chatting...'}</div>
                    </div>
                `;

                chatElement.addEventListener('click', () => {
                    chat.unread = false; // Mark as read when clicked
                    openChat(chat);
                });

                container.appendChild(chatElement);
            });
        });

        // Update the chat count
        if (chatsCount) {
            chatsCount.textContent = activeChats.length;
        }

        // Update tab indicator if there are any unread messages
        const hasUnread = activeChats.some(chat => chat.unread);
        const chatsTabBtn = document.querySelector('[data-tab="chats"]');
        if (chatsTabBtn) {
            if (hasUnread) {
                chatsTabBtn.classList.add('has-unread');
            } else {
                chatsTabBtn.classList.remove('has-unread');
            }
        }
    }

    // DOM element references
    const logoutBtn = document.getElementById('logout-btn');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
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

    // Initialize chat area as inactive
    chatArea.classList.remove('active');

    if (Notification.permission === "default") {
        Notification.requestPermission();
    }

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

        // Use filteredUsers if provided, otherwise use onlineUsers
        const usersToDisplay = filteredUsers || onlineUsers;

        usersToDisplay.forEach(user => {
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

        // Find existing chat or create new one
        let chat = activeChats.find(c => c.username === user.username);
        if (!chat) {
            chat = {
                ...user,
                messages: [],
                lastMessage: ''
            };
            activeChats.push(chat);
        }

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

        // Display stored messages
        if (chat.messages && chat.messages.length > 0) {
            chat.messages.forEach(msg => {
                displayMessage(msg.message, msg.sender, msg.sender === currentUser.username);
            });
        }

        // Update active chats display
        updateActiveChats();

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

    // Send message on Enter key press
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevent default to avoid new line
            sendBtn.click(); // Trigger the send button click
        }
    });

    let typingTimeout;

    messageInput.addEventListener('input', () => {
        if (!currentChatUser) return;

        clearTimeout(typingTimeout);

        // Send typing status
        socket.send(JSON.stringify({
            type: 'typing',
            recipient: currentChatUser.username,
            sender: currentUser.username,
            isTyping: true
        }));

        // Clear typing status after 2 seconds if no input
        typingTimeout = setTimeout(() => {
            socket.send(JSON.stringify({
                type: 'typing',
                recipient: currentChatUser.username,
                sender: currentUser.username,
                isTyping: false
            }));
        }, 2000);
    });

    // Update user's online status when leaving
    window.addEventListener('beforeunload', () => {
        // Clear intervals
        clearInterval(onlineUsersInterval);

        // Create a synchronous XMLHttpRequest
        const xhr = new XMLHttpRequest();

        // Set offline status
        xhr.open('PUT', `${API_URL}/api/temp-users/status/${currentUser.username}`, false); // false makes it synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        try {
            xhr.send(JSON.stringify({ isOnline: false }));
        } catch (error) {
            console.error('Error updating status:', error);
        }

        // Delete user
        const deleteXhr = new XMLHttpRequest();
        deleteXhr.open('DELETE', `${API_URL}/api/temp-users/delete/${currentUser.username}`, false);
        try {
            deleteXhr.send();
        } catch (error) {
            console.error('Error deleting user:', error);
        }
    });
});

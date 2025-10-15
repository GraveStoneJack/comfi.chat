// Backend
const API_URL = 'https://luxeonchat-backend.onrender.com';
const WS_URL = 'wss://luxeonchat-backend.onrender.com';
const messageSound = new Audio();
messageSound.preload = 'auto';
messageSound.src = '/sounds/bubblepop.mp3';
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
        // Add authentication token to WebSocket URL
        const token = sessionStorage.getItem('authToken'); // You'll need to implement token storage
        socket = new WebSocket(`${WS_URL}?token=${token}`);
        
        let reconnectAttempts = 0;
        const MAX_RECONNECT_ATTEMPTS = 5;

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
                console.log('Received WebSocket message:', data);

                if (data.type === 'typing') {
                    updateTypingIndicator(data.sender, data.isTyping);
                } else if (data.type === 'delete-message' && data.sender !== currentUser.username) {
                    // Remove matching image/message locally
                    const messagesContainer = document.querySelector('.messages');
                    const nodes = Array.from(messagesContainer.querySelectorAll('.message'));
                    const tokenUrl = getImageUrlFromMessage(data.message);
                    const toRemove = nodes.find(n => {
                        const img = n.querySelector('.message-image');
                        const imgSrc = img ? img.src : '';
                        return (img && imgSrc === tokenUrl) || n.textContent.trim() === data.message.trim();
                    });
                    if (toRemove) toRemove.remove();
                    // Mark unread in chat list
                    const chat = activeChats.find(c => c.username === data.sender);
                    if (chat) chat.unread = true;
                    updateActiveChats();
                } else if (data.type === 'message' && data.sender !== currentUser.username) {
                    playMessageSound();

                    // Determine the other user (sender or recipient)
                    const otherUser = data.sender === currentUser.username ? data.recipient : data.sender;

                    // Add to active chats if not exists
                    let chat = activeChats.find(chat => chat.username === otherUser);

                    if (!chat) {
                        // Find user info from online users or create basic info
                        chat = onlineUsers.find(user => user.username === otherUser) || {
                            username: otherUser,
                            messages: [],
                            lastMessage: isImageMessage(data.message) ? 'Photo' : data.message,
                            unread: true
                        };
                        activeChats.push(chat);
                    }

                    // Initialize messages array if it doesn't exist
                    if (!chat.messages) {
                        chat.messages = [];
                    }

                    // If this is a delete token, update preview and buffer token for history
                    const isDeleteToken = isDeleteImageToken(data.message);

                    // Always buffer message for accurate previews/history
                    chat.messages.push({
                        message: data.message,
                        sender: data.sender,
                        timestamp: new Date()
                    });
                    chat.lastMessage = computePreviewLabel(data.message, data.sender);

                    // Set unread status if chat is not currently open
                    if (!currentChatUser || currentChatUser.username !== otherUser) {
                        chat.unread = true;
                        notifyNewMessage(data.sender, data.message);
                    }

                    // Update chats display with latest preview
                    updateActiveChats();

                    // If chat window is open with this user, display message
                    if (currentChatUser && (data.sender === currentChatUser.username || data.recipient === currentChatUser.username)) {
                        // Handle special delete token
                        if (isDeleteImageToken(data.message)) {
                            const tokenUrl = getImageUrlFromMessage(stripDeleteToken(data.message));
                            const container = document.querySelector('.messages');
                            const nodes = Array.from(container.querySelectorAll('.message'));
                            const toRemove = nodes.find(n => {
                                const img = n.querySelector('.message-image');
                                return img && img.src === tokenUrl;
                            });
                            if (toRemove) {
                                // Replace removed image with a system notice
                                const reason = getDeleteReason(data.message);
                                const notice = document.createElement('div');
                                notice.className = 'message incoming system';
                                notice.innerHTML = `<div class="message-content">${reason === 'expired' ? 'Image expired' : 'Message removed'}</div>`;
                                // Insert notice at the same place
                                toRemove.parentNode.insertBefore(notice, toRemove.nextSibling);
                                toRemove.remove();
                            }
                        } else {
                            displayMessage(data.message, data.sender, data.sender === currentUser.username);
                        }
                    }
                }
            } catch (error) {
                console.error('Error processing WebSocket message:', error);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus(false);
        };

        socket.onclose = () => {
            console.log('WebSocket disconnected. Attempting to reconnect...');
            updateConnectionStatus(false);
            
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                setTimeout(initializeWebSocket, 3000 * reconnectAttempts); // Exponential backoff
            } else {
                console.error('Max reconnection attempts reached');
                // Show user-friendly error message
                alert('Connection lost. Please refresh the page to reconnect.');
            }
        };
    }

    initializeWebSocket();

    class MessageRateLimiter {
        constructor(maxMessages = 5, timeWindow = 5000) {
            this.messages = [];
            this.maxMessages = maxMessages;
            this.timeWindow = timeWindow;
        }

        canSendMessage() {
            const now = Date.now();
            this.messages = this.messages.filter(time => now - time < this.timeWindow);
            
            if (this.messages.length >= this.maxMessages) {
                return false;
            }
            
            this.messages.push(now);
            return true;
        }
    }

    const rateLimiter = new MessageRateLimiter();

    function sendMessage(message) {
        if (!rateLimiter.canSendMessage()) {
            alert('Please wait a few seconds before sending another message.');
            return;
        }
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket is not connected');
            return;
        }

        const messageData = {
            type: 'message',
            recipient: currentChatUser.username,
            sender: currentUser.username,
            message: message
        };

        try {
            socket.send(JSON.stringify(messageData));
            displayMessage(message, currentUser.username, true);

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

                activeChats[chatIndex].lastMessage = computePreviewLabel(message, currentUser.username);
            }

            console.log('Message sent:', messageData);
            // Ensure chat list reflects latest preview immediately on sender side
            updateActiveChats();
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    function notifyNewMessage(sender, message) {
        // Highlight chats list and specific chat item instead of top-right indicator
        const chatsTabBtn = document.querySelector('[data-tab="chats"]');
        if (chatsTabBtn) chatsTabBtn.classList.add('has-unread');

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
        console.log('Updating typing indicator:', { username, isTyping });
        const messages = document.querySelector('.messages');
        let typingIndicator = document.querySelector('.typing-indicator');

        // Don't show typing indicator for current user's own typing
        if (username === currentUser.username) {
            console.log('Ignoring own typing indicator');
            return;
        }

        if (isTyping && !typingIndicator) {
            console.log('Creating typing indicator for:', username);
            typingIndicator = document.createElement('div');
            typingIndicator.className = 'typing-indicator';
            typingIndicator.innerHTML = `
                <div class="typing-content">
                    <span class="typing-text">${username} is typing</span>
                    <div class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            `;
            messages.appendChild(typingIndicator);
             messages.scrollTop = messages.scrollHeight;
        } else if (!isTyping && typingIndicator) {
             console.log('Removing typing indicator');
            typingIndicator.remove();
        }
    }

    function playMessageSound() {
        if (!messageSound.paused) {
            messageSound.currentTime = 0;
        }

        messageSound.play().catch(error => {
            if (error.name === 'NotAllowedError') {
                console.log('Sound play was blocked by browser. User interaction required.');
            } else {
                console.error('Error playing sound:', error);
            }
        });
    }

    // Theme Manager (Auto/Light/Dark) for chat page
    (function initThemeToggle(){
        const themeBtn = document.getElementById('theme-toggle-btn');
        const THEME_KEY = 'comfi.theme';
        const getSystemPref = () => (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
        const applyTheme = (mode) => {
            const resolved = mode === 'auto' ? getSystemPref() : mode;
            document.body.classList.toggle('dark', resolved === 'dark');
            if (themeBtn) themeBtn.innerHTML = `<i class="fas ${resolved === 'dark' ? 'fa-moon' : 'fa-sun'}"></i> ${mode === 'auto' ? 'Auto' : (resolved === 'dark' ? 'Dark' : 'Light')}`;
            try { sessionStorage.setItem('comfi.theme.resolved', resolved); } catch(_e) {}
        };
        const loadTheme = () => localStorage.getItem(THEME_KEY) || 'auto';
        const saveTheme = (m) => localStorage.setItem(THEME_KEY, m);
        const cycleTheme = (m) => m === 'auto' ? 'light' : (m === 'light' ? 'dark' : 'auto');
        let themeMode = loadTheme();
        const hint = sessionStorage.getItem('comfi.theme.resolved');
        if (hint && (themeMode === 'auto' || hint !== (themeMode === 'auto' ? getSystemPref() : themeMode))) {
            document.body.classList.toggle('dark', hint === 'dark');
            if (themeBtn) themeBtn.innerHTML = `<i class="fas ${hint === 'dark' ? 'fa-moon' : 'fa-sun'}"></i> ${themeMode === 'auto' ? 'Auto' : (hint === 'dark' ? 'Dark' : 'Light')}`;
        } else {
            applyTheme(themeMode);
        }
        if (themeBtn) themeBtn.addEventListener('click', () => { themeMode = cycleTheme(themeMode); saveTheme(themeMode); applyTheme(themeMode); });
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto');
            });
        }
    })();

    // Add this function at the top level
    function sanitizeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Image helpers
    function isImageUrl(url) {
        try {
            const u = new URL(url);
            return /\.(png|jpe?g|gif|webp|avif)$/i.test(u.pathname);
        } catch (_e) {
            return false;
        }
    }

    function isImageMessage(text) {
        if (!text) return false;
        if (text.startsWith('[image]')) return true;
        return isImageUrl(text.trim());
    }

    function getImageUrlFromMessage(text) {
        if (!text) return null;
        return text.startsWith('[image]') ? text.substring(7).trim() : text.trim();
    }

    // Deletion token helpers (support legacy [delete-image] and new [delete-image|reason])
    function isDeleteImageToken(text) {
        return typeof text === 'string' && text.startsWith('[delete-image');
    }

    function getDeleteReason(text) {
        const match = (/^\[delete-image(?:\|(expired|manual))?\]/).exec(text || '');
        return (match && match[1]) ? match[1] : 'manual';
    }

    function stripDeleteToken(text) {
        return (text || '').replace(/^\[delete-image(?:\|[^\]]+)?\]/, '');
    }

    function computePreviewLabel(message, senderUsername) {
        if (!message) return '';
        if (isDeleteImageToken(message)) {
            const reason = getDeleteReason(message);
            return reason === 'expired' ? 'Image expired' : 'Message removed';
        }
        if (isImageMessage(message)) {
            return senderUsername === currentUser.username ? 'Image sent' : 'Image received';
        }
        return message;
    }

    function computeLastPreviewFromArray(arr) {
        if (!Array.isArray(arr)) return '';
        for (let i = arr.length - 1; i >= 0; i--) {
            const entry = arr[i];
            if (!entry || !entry.message) continue;
            return computePreviewLabel(entry.message, entry.sender);
        }
        return '';
    }

    async function fileToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    async function compressImage(file, maxWidth = 1280, maxHeight = 1280, quality = 0.8) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(image.width * scale);
                canvas.height = Math.round(image.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Compression failed'));
                        return;
                    }
                    resolve(blob);
                }, 'image/jpeg', quality);
            };
            image.onerror = reject;
            image.src = URL.createObjectURL(file);
        });
    }

    // Function to display a message
    function displayMessage(message, sender, isOutgoing, messageId = null) {
        console.log('Displaying message:', { message, sender, isOutgoing, messageId });

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', isOutgoing ? 'outgoing' : 'incoming');
        if (messageId) messageElement.dataset.messageId = messageId;

        let innerContent;
        if (isImageMessage(message)) {
            const imgUrl = sanitizeHTML(getImageUrlFromMessage(message));
            messageElement.classList.add('has-image');
            innerContent = `
                <div class="message-content">
                    <img class="message-image" src="${imgUrl}" alt="Image" />
                    ${isOutgoing ? '<div class="image-actions"><button class="image-action-btn delete-image-btn">Delete</button></div>' : ''}
                </div>
            `;
        } else {
            innerContent = `<div class="message-content">${sanitizeHTML(message)}</div>`;
        }

        messageElement.innerHTML = `
            ${innerContent}
            <div class="message-info">
                <span class="message-timestamp">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        `;

        // Status indicators removed per design choice

        const messagesContainer = document.querySelector('.messages');
        if (messagesContainer) {
            messagesContainer.appendChild(messageElement);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } else {
            console.error('Messages container not found in DOM');
        }

        // Wire lightbox and delete events for images
        const imgEl = messageElement.querySelector('.message-image');
        if (imgEl) {
            imgEl.addEventListener('click', () => {
                const lb = document.getElementById('image-lightbox');
                const lbImg = document.getElementById('lightbox-img');
                if (lb && lbImg) {
                    lbImg.src = imgEl.src;
                    lb.style.display = 'block';
                }
            });
        }
        // Replace inline delete button with floating trash icon
        const inlineDel = messageElement.querySelector('.delete-image-btn');
        if (inlineDel) inlineDel.remove();
        if (isOutgoing && imgEl) {
            const trashBtn = document.createElement('button');
            trashBtn.className = 'image-trash-btn';
            trashBtn.innerHTML = '<i class="fas fa-trash"></i>';
            messageElement.appendChild(trashBtn);
            trashBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                // Replace image bubble with a local system notice
                const removedNotice = document.createElement('div');
                removedNotice.className = 'message outgoing system';
                removedNotice.innerHTML = '<div class="message-content">Message removed</div>';
                messageElement.parentNode.insertBefore(removedNotice, messageElement.nextSibling);
                messageElement.remove();
                try {
                    socket.send(JSON.stringify({
                        type: 'message',
                        recipient: currentChatUser.username,
                        sender: currentUser.username,
                        message: `[delete-image|manual]${imgEl.src}`
                    }));
                } catch (e) { console.error('Delete broadcast failed', e); }

                // Update preview to reflect deletion
                const chatIdx = activeChats.findIndex(c => c.username === currentChatUser.username);
                if (chatIdx !== -1) {
                    activeChats[chatIdx].messages.push({
                        sender: currentUser.username,
                        message: `[delete-image|manual]${imgEl.src}`,
                        timestamp: new Date()
                    });
                    activeChats[chatIdx].lastMessage = 'Message removed';
                    updateActiveChats();
                }
            });
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
                        <div class="chat-preview">${(chat.lastMessage || 'Start chatting...').slice(0, 60)}${(chat.lastMessage && chat.lastMessage.length > 60) ? '…' : ''}</div>
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
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const users = await response.json();
            onlineUsers = users.filter(user => user.username !== currentUser.username);
            updateOnlineUsers();
            populateCountryFilter();
        } catch (error) {
            console.error('Error fetching online users:', error);
            // Show user-friendly error message
            const errorMessage = document.createElement('div');
            errorMessage.className = 'error-message';
            errorMessage.textContent = 'Unable to fetch online users. Please try again later.';
            document.querySelector('.online-users-container').appendChild(errorMessage);
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
                    <div class="user-name">
                        ${user.username}
                        <span class="presence-indicator ${user.isActive ? 'active' : 'inactive'}"></span>
                    </div>
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

    async function openChat(user) {
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

        // Load chat history from server, with graceful fallback to local buffer
        let renderedFromHistory = false;
        try {
            const response = await fetch(`${API_URL}/api/messages/history/${currentUser.username}/${user.username}`);
            if (response.ok) {
                const history = await response.json();
                if (Array.isArray(history) && history.length > 0) {
                    chat.messages = history;
                    history.forEach(msg => {
                        if (isDeleteImageToken(msg.message)) {
                            const tokenUrl = getImageUrlFromMessage(stripDeleteToken(msg.message));
                            const container = document.querySelector('.messages');
                            const nodes = Array.from(container.querySelectorAll('.message'));
                            const toRemove = nodes.find(n => {
                                const img = n.querySelector('.message-image');
                                return img && img.src === tokenUrl;
                            });
                            if (toRemove) toRemove.remove();
                        } else {
                            displayMessage(msg.message, msg.sender, msg.sender === currentUser.username);
                        }
                    });
                    // Update lastMessage based on the most relevant entry
                    chat.lastMessage = computeLastPreviewFromArray(history);
                    renderedFromHistory = true;
                }
            }
        } catch (error) {
            console.error('Error loading chat history:', error);
        }

        // If no history was rendered (e.g., endpoint missing), render any locally buffered messages
        if (!renderedFromHistory && Array.isArray(chat.messages) && chat.messages.length > 0) {
            chat.messages.forEach(msg => {
                if (isDeleteImageToken(msg.message)) {
                    const tokenUrl = getImageUrlFromMessage(stripDeleteToken(msg.message));
                    const container = document.querySelector('.messages');
                    const nodes = Array.from(container.querySelectorAll('.message'));
                    const toRemove = nodes.find(n => {
                        const img = n.querySelector('.message-image');
                        return img && img.src === tokenUrl;
                    });
                    if (toRemove) toRemove.remove();
                } else {
                    displayMessage(msg.message, msg.sender, msg.sender === currentUser.username);
                }
            });
            chat.lastMessage = computeLastPreviewFromArray(chat.messages) || chat.lastMessage || '';
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
        const typingData = {
            type: 'typing',
            recipient: currentChatUser.username,
            sender: currentUser.username,
            isTyping: true
        };
        console.log('Sending typing status:', typingData);
        socket.send(JSON.stringify(typingData));

        // Clear typing status after 2 seconds if no input
        typingTimeout = setTimeout(() => {
            const stopTypingData = {
                type: 'typing',
                recipient: currentChatUser.username,
                sender: currentUser.username,
                isTyping: false
            };
            console.log('Sending stop typing status:', stopTypingData);
            socket.send(JSON.stringify(stopTypingData));
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

    function updateUserPresence() {
        const lastActive = new Date().toISOString();
        fetch(`${API_URL}/api/temp-users/presence/${currentUser.username}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastActive })
        });
    }

    // Call every minute
    setInterval(updateUserPresence, 60000);

    // Add file input to chat (images only)
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    async function handleFileUpload(file) {
        if (!file || !file.type.startsWith('image/')) {
            alert('Only image files are allowed.');
            return;
        }

        // Try backend upload first
        try {
            const formData = new FormData();
            formData.append('file', file);
            const response = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
            if (response.ok) {
                const { fileUrl } = await response.json();
                sendMessage(`[image]${fileUrl}`);
                return;
            }
            console.warn('Upload endpoint returned non-200. Falling back to inline image.', response.status);
        } catch (err) {
            console.warn('Upload failed, using inline data URL fallback.', err);
        }

        // Fallback: compress locally and send as data URL so preview still works
        try {
            const compressed = await compressImage(file);
            const dataUrl = await fileToDataURL(compressed);
            sendMessage(`[image]${dataUrl}`);
        } catch (e) {
            console.error('Local processing failed:', e);
            alert('Could not process image. Please try a smaller image.');
        }
    }

    const imageSettings = document.getElementById('image-settings');
    const imageSendBtn = document.getElementById('image-send');
    const imageCancelBtn = document.getElementById('image-cancel');
    const imageExpirySelect = document.getElementById('image-expiry');
    let pendingFileForSend = null;

    // Utility: fully close the image settings modal and reset state
    function closeImageSettings(resetExpiry = false) {
        pendingFileForSend = null;
        if (imageSettings) imageSettings.style.display = 'none';
        // Clear the file input so choosing the same file triggers 'change' next time
        if (fileInput) fileInput.value = '';
        if (resetExpiry && imageExpirySelect) imageExpirySelect.value = '0';
    }

    document.getElementById('attach-file-btn').addEventListener('click', () => {
        pendingFileForSend = null;
        // Ensure selecting the same file fires a 'change' event
        fileInput.value = '';
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            pendingFileForSend = file;
            if (imageSettings) imageSettings.style.display = 'block';
        }
    });

    if (imageCancelBtn) imageCancelBtn.addEventListener('click', () => {
        closeImageSettings(true);
    });

    // Close when clicking the backdrop (outside the dialog)
    if (imageSettings) imageSettings.addEventListener('click', (e) => {
        if (e.target === imageSettings) closeImageSettings();
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && imageSettings && imageSettings.style.display === 'block') {
            closeImageSettings();
        }
    });

    if (imageSendBtn) imageSendBtn.addEventListener('click', async () => {
        if (!pendingFileForSend) { imageSettings.style.display = 'none'; return; }
        const seconds = parseInt(imageExpirySelect?.value || '0', 10) || 0;
        // Send upload (which will send [image]URL or dataURL)
        await handleFileUpload(pendingFileForSend);
        closeImageSettings();
        // Schedule auto-delete on both sides if expiry set
        if (seconds > 0) {
            setTimeout(() => {
                const container = document.querySelector('.messages');
                const imgs = Array.from(container.querySelectorAll('.message.has-image'));
                const last = imgs[imgs.length - 1];
                if (last) {
                    const imgEl = last.querySelector('.message-image');
                    const msgToken = `[image]${imgEl?.src || ''}`;
                    // Replace image bubble with local system notice
                    const expiredNotice = document.createElement('div');
                    expiredNotice.className = 'message outgoing system';
                    expiredNotice.innerHTML = '<div class="message-content">Image expired</div>';
                    last.parentNode.insertBefore(expiredNotice, last.nextSibling);
                    last.remove();
                    // Broadcast delete to recipient for the same image token
                    try {
                        socket.send(JSON.stringify({
                            type: 'message',
                            recipient: currentChatUser.username,
                            sender: currentUser.username,
                            message: `[delete-image|expired]${imgEl?.src || ''}`
                        }));
                    } catch (e) { console.error('Expiry delete broadcast failed', e); }

                    // Update preview to reflect expiry
                    const chatIdx = activeChats.findIndex(c => c.username === currentChatUser.username);
                    if (chatIdx !== -1) {
                        activeChats[chatIdx].messages.push({
                            sender: currentUser.username,
                            message: `[delete-image|expired]${imgEl?.src || ''}`,
                            timestamp: new Date()
                        });
                        activeChats[chatIdx].lastMessage = 'Image expired';
                        updateActiveChats();
                    }
                }
            }, seconds * 1000);
        }
        pendingFileForSend = null;
    });

    class ConnectionManager {
        constructor(wsUrl) {
            this.wsUrl = wsUrl;
            this.messageQueue = [];
            this.isConnected = false;
        }

        connect() {
            this.socket = new WebSocket(this.wsUrl);
            
            this.socket.onopen = () => {
                this.isConnected = true;
                this.flushMessageQueue();
            };
            
            this.socket.onclose = () => {
                this.isConnected = false;
                this.scheduleReconnect();
            };
        }

        send(message) {
            if (this.isConnected) {
                this.socket.send(message);
            } else {
                this.messageQueue.push(message);
            }
        }

        flushMessageQueue() {
            while (this.messageQueue.length > 0) {
                const message = this.messageQueue.shift();
                this.send(message);
            }
        }
    }

    const connectionManager = new ConnectionManager(WS_URL);

    class UserPreferences {
        constructor() {
            this.preferences = JSON.parse(localStorage.getItem('chatPreferences')) || {
                notifications: true,
                soundEnabled: true,
                theme: 'light',
                fontSize: 'medium'
            };
        }

        save() {
            localStorage.setItem('chatPreferences', JSON.stringify(this.preferences));
        }

        update(key, value) {
            this.preferences[key] = value;
            this.save();
            this.applyPreferences();
        }

        applyPreferences() {
            // Respect global theme selection (Auto/Light/Dark)
            const THEME_KEY = 'comfi.theme';
            const savedMode = localStorage.getItem(THEME_KEY) || 'auto';
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const resolved = savedMode === 'auto' ? (prefersDark ? 'dark' : 'light') : savedMode;
            document.body.classList.toggle('dark', resolved === 'dark');

            // Sound preference
            messageSound.volume = this.preferences.soundEnabled ? 0.5 : 0;
        }
    }

    const userPrefs = new UserPreferences();
    userPrefs.applyPreferences();

    function searchMessages(query) {
        const normalized = (query || '').toLowerCase();
        if (!normalized) return [];
        const searchResults = [];

        // Prefer current conversation for relevancy
        const sourceChats = currentChatUser
            ? activeChats.filter(c => c.username === currentChatUser.username)
            : activeChats;

        sourceChats.forEach(chat => {
            const matches = (chat.messages || []).filter(msg =>
                (msg.message || '').toLowerCase().includes(normalized)
            );
            if (matches.length > 0) {
                searchResults.push({ username: chat.username, matches });
            }
        });

        return searchResults;
    }

    function displaySearchResults(results, query) {
        const resultsEl = document.getElementById('search-results');
        if (!resultsEl) return;
        resultsEl.innerHTML = '';

        if (!query || query.trim() === '') {
            resultsEl.style.display = 'none';
            return;
        }

        const fragment = document.createDocumentFragment();
        results.forEach(group => {
            group.matches.slice(0, 5).forEach(match => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                const idx = match.message.toLowerCase().indexOf(query.toLowerCase());
                const start = Math.max(0, idx - 20);
                const end = Math.min(match.message.length, idx + query.length + 20);
                const before = sanitizeHTML(match.message.slice(start, idx));
                const hit = sanitizeHTML(match.message.slice(idx, idx + query.length));
                const after = sanitizeHTML(match.message.slice(idx + query.length, end));
                item.innerHTML = `<strong>${sanitizeHTML(group.username)}</strong>: ${before}<span class="highlight">${hit}</span>${after}`;

                item.addEventListener('click', () => {
                    // Open the chat if needed
                    if (!currentChatUser || currentChatUser.username !== group.username) {
                        const user = activeChats.find(c => c.username === group.username) || onlineUsers.find(u => u.username === group.username);
                        if (user) {
                            openChat(user);
                        }
                    }

                    // Try to scroll to a matching message in the DOM
                    setTimeout(() => {
                        const messageNodes = Array.from(document.querySelectorAll('.messages .message'));
                        const node = messageNodes.find(n => n.textContent.toLowerCase().includes(query.toLowerCase()));
                        if (node) {
                            node.classList.add('search-hit');
                            node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            setTimeout(() => node.classList.remove('search-hit'), 1200);
                        }
                    }, 100);
                });

                fragment.appendChild(item);
            });
        });

        if (!fragment.childNodes.length) {
            const empty = document.createElement('div');
            empty.className = 'search-result-item';
            empty.textContent = 'No results';
            resultsEl.appendChild(empty);
        } else {
            resultsEl.appendChild(fragment);
        }
        resultsEl.style.display = 'block';
    }

    function highlightMatchesInDom(query) {
        const list = document.querySelector('.messages');
        if (!list) return 0;
        const nodes = Array.from(list.querySelectorAll('.message'));
        let first;
        const normalized = query.toLowerCase();
        nodes.forEach(n => n.classList.remove('search-hit'));
        nodes.forEach(n => {
            if (n.textContent.toLowerCase().includes(normalized)) {
                if (!first) first = n;
                n.classList.add('search-hit');
            }
        });
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return first ? 1 : 0;
    }

    // New animated search popover
    // Inline search slide controls
    const searchToggle = document.getElementById('inline-search-btn');
    const searchPopover = document.getElementById('search-slide');
    const searchInput = document.getElementById('message-search-input');
    const searchClose = document.getElementById('inline-search-close');
    const messageInputWrapper = document.querySelector('.message-input');

    function openSearch() {
        if (!searchPopover) return;
        if (messageInputWrapper) messageInputWrapper.classList.add('search-mode');
        setTimeout(() => searchInput && searchInput.focus(), 50);
    }

    function closeSearch() {
        if (!searchPopover) return;
        if (messageInputWrapper) messageInputWrapper.classList.remove('search-mode');
        const resultsEl = document.getElementById('search-results');
        if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
        if (searchInput) searchInput.value = '';
    }

    if (searchToggle) searchToggle.addEventListener('click', openSearch);
    if (searchClose) searchClose.addEventListener('click', closeSearch);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSearch();
    });
    // Close lightbox on overlay click or ESC
    const lb = document.getElementById('image-lightbox');
    if (lb) {
        lb.addEventListener('click', (ev) => {
            if (ev.target === lb || ev.target.classList.contains('lightbox-overlay')) {
                lb.style.display = 'none';
                const lbImg = document.getElementById('lightbox-img');
                if (lbImg) lbImg.src = '';
            }
        });
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                lb.style.display = 'none';
                const lbImg = document.getElementById('lightbox-img');
                if (lbImg) lbImg.src = '';
            }
        });
    }
    document.addEventListener('click', (e) => {
        if (messageInputWrapper && messageInputWrapper.classList.contains('search-mode')) {
            const isInside = searchPopover.contains(e.target) || (searchToggle && searchToggle.contains(e.target));
            if (!isInside) closeSearch();
        }
    });

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            const results = searchMessages(query);
            displaySearchResults(results, query);
            if (query && query.trim()) highlightMatchesInDom(query);
        });
    }
});

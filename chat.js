// Backend
const API_URL = 'https://luxeonchat-backend.onrender.com';
const WS_URL = 'wss://luxeonchat-backend.onrender.com';
const messageSound = new Audio();
messageSound.preload = 'auto';
messageSound.src = '/sounds/bubblepop.mp3';
messageSound.volume = 0.5;

let socket;

document.addEventListener('DOMContentLoaded', async () => {
    // Stable device identifier shared with landing page
    function getDeviceId() {
        const KEY = 'comfi.deviceId';
        let id = localStorage.getItem(KEY);
        if (!id) {
            id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
            localStorage.setItem(KEY, id);
        }
        return id;
    }
    // Check if user is logged in (registered user or temp)
    const registeredUser = JSON.parse(sessionStorage.getItem('user') || 'null');
    const authToken = sessionStorage.getItem('authToken');
    const tempSession = JSON.parse(sessionStorage.getItem('tempUser') || 'null');
    const currentUser = tempSession || (registeredUser ? { username: registeredUser.username } : null);
    if (!currentUser) {
        window.location.href = '/';
        return;
    }

    let currentChatUser = null;
    let activeChats = [];
    let onlineUsers = [];
	let reconnectAttempts = 0;
	let heartbeatTimer = null;

    function initializeWebSocket() {
        // Add authentication token to WebSocket URL if available
        const token = authToken || '';
        socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
        
        function updateConnectionStatus(connected) {
            console.log('WebSocket status:', connected ? 'Connected' : 'Disconnected');
            if (!connected) {
                // Optionally show a connection status indicator to the user
				const existing = document.querySelector('.connection-status');
				if (!existing) {
					const statusElement = document.createElement('div');
					statusElement.className = 'connection-status';
					statusElement.textContent = 'Disconnected. Reconnecting...';
					document.body.appendChild(statusElement);
				}
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
			// reset backoff on successful connect
			reconnectAttempts = 0;
			// lightweight application heartbeat as a fallback
			clearInterval(heartbeatTimer);
			heartbeatTimer = setInterval(() => {
				if (socket && socket.readyState === WebSocket.OPEN) {
					try { socket.send(JSON.stringify({ type: 'heartbeat' })); } catch (_e) {}
				}
			}, 25000);
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

				// optionally ignore server heartbeat echoes if implemented
				if (data && (data.type === 'heartbeat' || data.type === 'pong')) {
					return;
				}

                if (data.type === 'delete-message' && data.sender !== currentUser.username) {
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
                    // Drop messages from blocked devices
                    try {
                        const blocked = new Set(loadBlockedDevices());
                        const senderDeviceId = usernameToDeviceId.get(data.sender);
                        if (senderDeviceId && blocked.has(senderDeviceId)) {
                            return; // ignore silently
                        }
                    } catch(_e) {}
                    playMessageSound();

                    // Determine the other user (sender or recipient)
                    const otherUser = data.sender === currentUser.username ? data.recipient : data.sender;

                    // If this chat was hidden by the user, unhide it when a new message arrives
                    try { unhideChat(otherUser); } catch (_e) {}

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
                                // Cancel any pending local expiry timer for this image
                                clearImageExpiry(tokenUrl);
                                // If lightbox is open with this image, close it
                                const lb = document.getElementById('image-lightbox');
                                const lbImg = document.getElementById('lightbox-img');
                                if (lb && lbImg && lb.style.display === 'block' && lbImg.src === tokenUrl) {
                                    lb.style.display = 'none';
                                    lbImg.src = '';
                                }
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
			clearInterval(heartbeatTimer);
            
			// Gentle exponential backoff with cap
			const delay = Math.min(30000, Math.round(1000 * Math.pow(1.5, Math.max(1, reconnectAttempts))));
			reconnectAttempts++;
			setTimeout(initializeWebSocket, delay);
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
        // Prevent sending to blocked device
        try {
            const blocked = new Set(loadBlockedDevices());
            if (currentChatUser && currentChatUser.deviceId && blocked.has(currentChatUser.deviceId)) {
                alert('You have blocked this user/device. Log out to clear your blocklist.');
                return;
            }
        } catch(_e) {}
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket is not connected');
            return;
        }
        // Convert ASCII emoticons to emoji for all outbound text
        const normalizedMessage = convertEmoticonsToEmoji(message);

        const messageData = {
            type: 'message',
            recipient: currentChatUser.username,
            sender: currentUser.username,
            message: normalizedMessage
        };

        try {
            socket.send(JSON.stringify(messageData));
            displayMessage(normalizedMessage, currentUser.username, true);

            // Store the message locally
            const chatIndex = activeChats.findIndex(chat => chat.username === currentChatUser.username);
            if (chatIndex !== -1) {
                if (!activeChats[chatIndex].messages) {
                    activeChats[chatIndex].messages = [];
                }

                activeChats[chatIndex].messages.push({
                    sender: currentUser.username,
                    message: normalizedMessage,
                    timestamp: new Date()
                });

                activeChats[chatIndex].lastMessage = computePreviewLabel(normalizedMessage, currentUser.username);
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

    // Typing indicator removed by request

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
        const raw = text.startsWith('[image]') ? text.substring(7).trim() : text.trim();
        // If backend returned a relative uploads path, resolve it against API_URL
        // This ensures images load from the backend domain when the frontend is hosted elsewhere.
        if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
            const suffix = raw.startsWith('/') ? raw : `/${raw}`;
            return `${API_URL}${suffix}`;
        }
        return raw;
    }
	// Build resilient candidates for a given [image] message, trying multiple hosts if needed
	function getImageCandidatesFromMessage(text) {
		if (!text) return [];
		const raw = text.startsWith('[image]') ? text.substring(7).trim() : text.trim();
		// Absolute URL or data URL → single candidate
		if (/^https?:\/\//i.test(raw) || /^data:image\//i.test(raw)) return [raw];
		// Relative uploads path → try API_URL first, then local origin
		if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
			const suffix = raw.startsWith('/') ? raw : `/${raw}`;
			const candidates = [];
			candidates.push(`${API_URL}${suffix}`);
			try {
				const origin = location.origin;
				if (!origin.includes('luxeonchat-backend.onrender.com')) {
					candidates.push(`${origin}${suffix}`);
				}
			} catch (_e) {}
			// Last resort: hard-coded fallback to production backend
			if (!candidates.some(u => u.includes('luxeonchat-backend.onrender.com'))) {
				candidates.push(`https://luxeonchat-backend.onrender.com${suffix}`);
			}
			// Proxy resolver as a final fallback
			candidates.push(`${API_URL}/api/upload/resolve?src=${encodeURIComponent(suffix)}`);
			return Array.from(new Set(candidates));
		}
		return [raw];
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

    // Manage per-image expiry timers keyed by the final img.src URL
    const imageExpiryTimers = new Map();

    function clearImageExpiry(url) {
        if (!url) return;
        const entry = imageExpiryTimers.get(url);
        if (entry && entry.timeoutId) {
            clearTimeout(entry.timeoutId);
        }
        imageExpiryTimers.delete(url);
    }

    function expireImageByUrl(url, recipientUsername) {
        try {
            const container = document.querySelector('.messages');
            let removed = false;
            if (container) {
                const nodes = Array.from(container.querySelectorAll('.message.has-image'));
                const target = nodes.find(n => {
                    const img = n.querySelector('.message-image');
                    return img && img.src === url;
                });
                if (target) {
                    const imgEl = target.querySelector('.message-image');
                    const expiredNotice = document.createElement('div');
                    expiredNotice.className = target.classList.contains('outgoing') ? 'message outgoing system' : 'message incoming system';
                    expiredNotice.innerHTML = '<div class="message-content">Image expired</div>';
                    target.parentNode.insertBefore(expiredNotice, target.nextSibling);
                    target.remove();
                    // Close lightbox if open for this image
                    const lb = document.getElementById('image-lightbox');
                    const lbImg = document.getElementById('lightbox-img');
                    if (lb && lbImg && lb.style.display === 'block' && lbImg.src === url) {
                        lb.style.display = 'none';
                        lbImg.src = '';
                    }
                    removed = true;
                }
            }
            // Always broadcast delete so the recipient removes it too
            try {
                if (socket && socket.readyState === WebSocket.OPEN && recipientUsername) {
                    socket.send(JSON.stringify({
                        type: 'message',
                        recipient: recipientUsername,
                        sender: currentUser.username,
                        message: `[delete-image|expired]${url}`
                    }));
                }
            } catch (e) { console.error('Expiry delete broadcast failed', e); }

            // Update preview for that chat
            if (recipientUsername) {
                const chatIdx = activeChats.findIndex(c => c.username === recipientUsername);
                if (chatIdx !== -1) {
                    activeChats[chatIdx].messages = activeChats[chatIdx].messages || [];
                    activeChats[chatIdx].messages.push({
                        sender: currentUser.username,
                        message: `[delete-image|expired]${url}`,
                        timestamp: new Date()
                    });
                    activeChats[chatIdx].lastMessage = 'Image expired';
                    updateActiveChats();
                }
            }
        } finally {
            clearImageExpiry(url);
        }
    }

    function scheduleImageExpiry(url, seconds, recipientUsername) {
        if (!url || !seconds || seconds <= 0) return;
        clearImageExpiry(url);
        const timeoutId = setTimeout(() => expireImageByUrl(url, recipientUsername), seconds * 1000);
        imageExpiryTimers.set(url, { timeoutId, recipientUsername });
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
			const candidates = getImageCandidatesFromMessage(message);
			const imgUrl = sanitizeHTML(candidates[0] || '');
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
            // Fallback loader: try alternate URLs if the first fails
			try {
				const candidates = getImageCandidatesFromMessage(message);
                let idx = 1; // we've already set candidates[0] as src above
				function tryNext() {
					if (idx >= candidates.length) return;
					const next = candidates[idx++];
					if (imgEl.src !== next) imgEl.src = next;
				}
				imgEl.addEventListener('error', () => {
					tryNext();
				}, { once: false });
				// Ensure first candidate is used
				if (imgEl.complete && imgEl.naturalWidth === 0) {
					tryNext();
				}
			} catch (_e) {}
            // Disable right-click save on inline images
            imgEl.addEventListener('contextmenu', (e) => e.preventDefault());
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
                // Cancel any pending expiry timer for this image
                clearImageExpiry(imgEl.src);
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
            const hidden = new Set(loadHiddenChats());
            activeChats.forEach(chat => {
                if (hidden.has(chat.username)) return;
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
                    <button class="hide-chat-btn" title="Hide chat"><i class="fas fa-xmark"></i></button>
                `;

                chatElement.addEventListener('click', () => {
                    chat.unread = false; // Mark as read when clicked
                    openChat(chat);
                });

                // Hide button behavior
                const hideBtn = chatElement.querySelector('.hide-chat-btn');
                if (hideBtn) {
                    hideBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        hideChat(chat.username);
                        if (currentChatUser && currentChatUser.username === chat.username) {
                            chatArea.classList.remove('active');
                            currentChatUser = null;
                        }
                        updateActiveChats();
                    });
                }

                container.appendChild(chatElement);
            });
        });

        // Update the chat count
        if (chatsCount) {
            try {
                const hidden = new Set(loadHiddenChats());
                chatsCount.textContent = activeChats.filter(c => !hidden.has(c.username)).length;
            } catch (_e) {
                chatsCount.textContent = activeChats.length;
            }
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
    const emojiToggleBtn = document.getElementById('emoji-toggle-btn');
    const emojiPopover = document.getElementById('emoji-popover');
    const emojiGrid = document.getElementById('emoji-grid');
    const emojiTabs = document.querySelectorAll('.emoji-tab');
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
    const reportCancelBtn = document.getElementById('report-cancel');
    let usernameToDeviceId = new Map();
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
            body: JSON.stringify({ isOnline: true, deviceId: getDeviceId() }),
        });
    } catch (error) {
        console.error('Error updating initial online status:', error);
    }

    // Blocklist helpers (scoped per your current username)
    function getBlocklistKey() { return `comfi.blocklist.${currentUser.username}`; }
    function loadBlockedDevices() { try { return JSON.parse(localStorage.getItem(getBlocklistKey()) || '[]'); } catch (_e) { return []; } }
    function saveBlockedDevices(list) { try { localStorage.setItem(getBlocklistKey(), JSON.stringify(list)); } catch (_e) {} }
    function addBlockedDevice(deviceId) {
        if (!deviceId) return;
        const list = loadBlockedDevices();
        if (!list.includes(deviceId)) { list.push(deviceId); saveBlockedDevices(list); }
    }

    // Hidden chats helpers (stored per current username)
    function getHiddenChatsKey() { return `comfi.hiddenChats.${currentUser.username}`; }
    function loadHiddenChats() {
        try { return JSON.parse(localStorage.getItem(getHiddenChatsKey()) || '[]'); } catch (_e) { return []; }
    }
    function saveHiddenChats(list) {
        try { localStorage.setItem(getHiddenChatsKey(), JSON.stringify(Array.from(new Set(list)))); } catch (_e) {}
    }
    function isChatHidden(username) {
        try { return loadHiddenChats().includes(username); } catch (_e) { return false; }
    }
    function hideChat(username) {
        if (!username) return;
        const list = loadHiddenChats();
        if (!list.includes(username)) { list.push(username); saveHiddenChats(list); }
    }
    function unhideChat(username) {
        if (!username) return;
        const list = loadHiddenChats().filter(u => u !== username);
        saveHiddenChats(list);
    }

    // Fetch online users from the server
    async function fetchOnlineUsers() {
        try {
            const response = await fetch(`${API_URL}/api/temp-users/online`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const users = await response.json();
            const blocked = new Set(loadBlockedDevices());
            usernameToDeviceId = new Map();
            users.forEach(u => { if (u && u.username) usernameToDeviceId.set(u.username, u.deviceId || null); });
            onlineUsers = users
                .filter(user => user.username !== currentUser.username)
                .filter(user => user.deviceId && !blocked.has(user.deviceId));
            updateOnlineUsers();
            populateCountryFilter();
        } catch (error) {
            console.error('Error fetching online users:', error);
            // Show user-friendly error message without throwing if container is missing
            try {
                const container = document.getElementById('online-users');
                if (container && !container.querySelector('.error-message')) {
                    const errorMessage = document.createElement('div');
                    errorMessage.className = 'error-message';
                    errorMessage.textContent = 'Unable to fetch online users. Please try again later.';
                    container.appendChild(errorMessage);
                }
            } catch (_e) { /* swallow to avoid breaking init flow */ }
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

                // Mark offline and clear messages server side
                const logoffRes = await fetch(`${API_URL}/api/logoff/${currentUser.username}`, { method: 'POST' });
                if (!logoffRes.ok) console.error('Failed to logoff/cleanup');

                // Clear intervals before redirecting
                clearInterval(onlineUsersInterval);

                // Clear session storage and release per-username blocklist
                sessionStorage.removeItem('tempUser');
                try { localStorage.removeItem(getBlocklistKey()); } catch(_e) {}

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
        try { unhideChat(user.username); } catch (_e) {}
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
                            if (toRemove) {
                                toRemove.remove();
                                clearImageExpiry(tokenUrl);
                            }
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
                    if (toRemove) {
                        toRemove.remove();
                        clearImageExpiry(tokenUrl);
                    }
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
            const confirmMsg = `Block ${user.username}? They won't be able to message you from this device.`;
            if (confirm(confirmMsg)) {
                addBlockedDevice(user.deviceId);
                // Remove from lists and UI
                onlineUsers = onlineUsers.filter(u => u.deviceId !== user.deviceId);
                activeChats = activeChats.filter(chat => chat.username !== user.username);
                updateOnlineUsers();
                updateActiveChats();
                chatArea.classList.remove('active');
            }
        });

        document.getElementById('report-user-btn').addEventListener('click', () => {
            if (reportPopup) reportPopup.style.display = 'block';
            const chk = document.getElementById('report-block-checkbox');
            if (chk) chk.checked = false;
        });
    }

    if (reportCancelBtn) reportCancelBtn.addEventListener('click', () => { if (reportPopup) reportPopup.style.display = 'none'; });

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
                const alsoBlock = document.getElementById('report-block-checkbox');
                if (alsoBlock && alsoBlock.checked) {
                    addBlockedDevice(currentChatUser.deviceId);
                    onlineUsers = onlineUsers.filter(u => u.deviceId !== currentChatUser.deviceId);
                    activeChats = activeChats.filter(chat => chat.username !== currentChatUser.username);
                    updateOnlineUsers();
                    updateActiveChats();
                    chatArea.classList.remove('active');
                }
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

    // Typing events removed by request

    // Update user's online status when leaving (do not delete the user to preserve history).
    window.addEventListener('beforeunload', () => {
        clearInterval(onlineUsersInterval);
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `${API_URL}/api/temp-users/status/${currentUser.username}`, false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        try { xhr.send(JSON.stringify({ isOnline: false })); } catch (_e) {}
    });

    function updateUserPresence() {
        const lastActive = new Date().toISOString();
        fetch(`${API_URL}/api/temp-users/status/${currentUser.username}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isOnline: true, lastActive, deviceId: getDeviceId() })
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
            const response = await fetch(`${API_URL}/api/upload?u=${encodeURIComponent(currentUser.username)}`, { method: 'POST', body: formData });
            if (response.ok) {
                const { fileUrl } = await response.json();
                sendMessage(`[image]${fileUrl}`);
                // Return the normalized URL that will be used for the img.src
                return getImageUrlFromMessage(`[image]${fileUrl}`);
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
            return dataUrl;
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
        const usedUrl = await handleFileUpload(pendingFileForSend);
        closeImageSettings();
        // Schedule auto-delete on both sides if expiry set
        if (seconds > 0 && usedUrl) {
            scheduleImageExpiry(usedUrl, seconds, currentChatUser?.username);
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

    // Emoji Picker Logic
    const EMOJI_CATALOG = {
        recent: [],
        smileys: ['😀','😁','😂','🤣','😃','😄','😅','😊','😇','🙂','🙃','😉','😍','😘','😗','😙','😚','😋','😛','😜','🤪','🤗','🤭','🤫','🤔','🤐','😐','😑','😶','😏','😒','🙄','😬','🤥','😭','😤','😮‍💨','😮','😯','😲','🥱','😴','🤤','😪','😵','🤯','🤧','🤒','🤕','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😣','😖','😞','😩','😫','😢','😮‍💨','😠','😡','🤬','🤡','💩','👻','💀','🤖','🎃'],
        gestures: ['👍','👎','👌','🤌','👏','🙌','🫶','🙏','👊','🤟','✌️','🤞','🖖','👉','👈','👇','👆','☝️','🫵','✍️','🫳','🫴','🤙','💪','🖐️','✋','🤚','🖖','🤏'],
        nature: ['🌸','🌼','🌻','🌹','🌷','🌺','🌵','🌿','☘️','🍀','🌾','🌲','🌳','🌴','🌍','🌎','🌏','🌞','🌝','🌛','🌜','⭐','🌟','✨','⚡','🔥','🌈','☔','❄️','☃️','💧','💦','🌊']
    };

    function renderEmojis(category) {
        if (!emojiGrid) return;
        const list = EMOJI_CATALOG[category] || [];
        emojiGrid.innerHTML = '';
        const frag = document.createDocumentFragment();
        list.forEach(ch => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'emoji-item';
            btn.textContent = ch;
            btn.addEventListener('click', () => {
                insertAtCursor(messageInput, ch);
                trackRecent(ch);
            });
            frag.appendChild(btn);
        });
        emojiGrid.appendChild(frag);
    }

    function insertAtCursor(input, text) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const before = input.value.substring(0, start);
        const after = input.value.substring(end);
        input.value = `${before}${text}${after}`;
        const cursor = start + text.length;
        input.setSelectionRange(cursor, cursor);
        input.focus();
    }

    function trackRecent(emoji) {
        const recents = EMOJI_CATALOG.recent;
        const idx = recents.indexOf(emoji);
        if (idx !== -1) recents.splice(idx, 1);
        recents.unshift(emoji);
        if (recents.length > 32) recents.length = 32;
        try { localStorage.setItem('comfi.recentEmojis', JSON.stringify(recents)); } catch(_e) {}
        // If recent tab is active, re-render
        const activeTab = document.querySelector('.emoji-tab.active');
        if (activeTab && activeTab.dataset.cat === 'recent') renderEmojis('recent');
    }

    function loadRecents() {
        try {
            const saved = JSON.parse(localStorage.getItem('comfi.recentEmojis') || '[]');
            if (Array.isArray(saved)) EMOJI_CATALOG.recent = saved;
        } catch(_e) {}
    }

    function toggleEmojiPopover(forceOpen) {
        if (!emojiPopover) return;
        const isOpen = emojiPopover.classList.contains('open');
        const next = forceOpen === true ? true : forceOpen === false ? false : !isOpen;
        if (next) {
            emojiPopover.classList.add('open');
            emojiPopover.setAttribute('aria-hidden', 'false');
            // default to recent if available, else smileys
            const active = document.querySelector('.emoji-tab.active');
            const cat = active ? active.dataset.cat : 'recent';
            renderEmojis((EMOJI_CATALOG[cat] && EMOJI_CATALOG[cat].length) ? cat : 'smileys');
        } else {
            emojiPopover.classList.remove('open');
            emojiPopover.setAttribute('aria-hidden', 'true');
        }
    }

    if (emojiToggleBtn) {
        loadRecents();
        emojiToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleEmojiPopover();
        });
    }

    if (emojiTabs && emojiTabs.length) {
        emojiTabs.forEach(tab => tab.addEventListener('click', (e) => {
            e.preventDefault();
            emojiTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderEmojis(tab.dataset.cat);
        }));
    }

    document.addEventListener('click', (e) => {
        if (!emojiPopover || !emojiToggleBtn) return;
        if (emojiPopover.classList.contains('open')) {
            const clickedInside = emojiPopover.contains(e.target) || emojiToggleBtn.contains(e.target);
            if (!clickedInside) toggleEmojiPopover(false);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && emojiPopover && emojiPopover.classList.contains('open')) {
            toggleEmojiPopover(false);
        }
    });

    // Emoticon to Emoji conversion on send/display
    function convertEmoticonsToEmoji(text) {
        if (!text || typeof text !== 'string') return text;
        const rules = [
            [/\B:\)/g, '😊'],
            [/\B:-\)/g, '😊'],
            [/\B:\(/g, '☹️'],
            [/\B:-\(/g, '☹️'],
            [/\B;\)/g, '😉'],
            [/\B;-\)/g, '😉'],
            [/\B:D/g, '😄'],
            [/\B:-D/g, '😄'],
            [/\B:\|/g, '😐'],
            [/\B:-\|/g, '😐'],
            [/\B:\*/g, '😘'],
            [/\B<3/g, '❤️']
        ];
        let out = text;
        rules.forEach(([rx, repl]) => { out = out.replace(rx, repl); });
        return out;
    }

    // Hook send button to convert emoticons before sending
    if (sendBtn && messageInput) {
        const originalSendHandler = () => {
            const message = messageInput.value.trim();
            if (message && currentChatUser) {
                const converted = convertEmoticonsToEmoji(message);
                sendMessage(converted);
                messageInput.value = '';
            }
        };
        // Remove existing click listeners is non-trivial; instead, override via capturing flag
        sendBtn.replaceWith(sendBtn.cloneNode(true));
        const newSendBtn = document.getElementById('send-btn');
        newSendBtn.addEventListener('click', originalSendHandler);
    }

    // ==========================================================================
    // MOBILE SIDEBAR & NAVIGATION HANDLING
    // ==========================================================================
    (function initMobileNav() {
        const sidebarToggle = document.getElementById('mobile-sidebar-toggle');
        const backBtn = document.getElementById('mobile-back-btn');
        const overlay = document.getElementById('mobile-overlay');
        const userList = document.querySelector('.user-list');
        const chatAreaEl = document.querySelector('.chat-area');

        // Check if we're on mobile
        function isMobile() {
            return window.innerWidth <= 768;
        }

        // Update mobile navigation button visibility based on chat state
        function updateMobileNavState() {
            if (!isMobile()) {
                document.body.classList.remove('mobile-chat-active');
                return;
            }
            
            if (chatAreaEl && chatAreaEl.classList.contains('active')) {
                document.body.classList.add('mobile-chat-active');
            } else {
                document.body.classList.remove('mobile-chat-active');
            }
        }

        // Open sidebar
        function openSidebar() {
            if (!userList || !overlay) return;
            userList.classList.add('open');
            overlay.classList.add('visible');
            document.body.classList.add('mobile-sidebar-open');
        }

        // Close sidebar
        function closeSidebar() {
            if (!userList || !overlay) return;
            userList.classList.remove('open');
            overlay.classList.remove('visible');
            document.body.classList.remove('mobile-sidebar-open');
        }

        // Toggle sidebar
        function toggleSidebar() {
            if (userList && userList.classList.contains('open')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        }

        // Handle back button (close chat and show sidebar on mobile)
        function handleBack() {
            if (!isMobile()) return;
            if (chatAreaEl) {
                chatAreaEl.classList.remove('active');
            }
            updateMobileNavState();
            // Optionally open sidebar after closing chat
            setTimeout(() => {
                openSidebar();
            }, 100);
        }

        // Event listeners - use both click and touchend for better mobile support
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSidebar();
            });
            
            // Touch event for more responsive mobile interaction
            sidebarToggle.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSidebar();
            }, { passive: false });
        }

        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleBack();
            });
            
            backBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleBack();
            }, { passive: false });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                closeSidebar();
            });
            
            overlay.addEventListener('touchend', (e) => {
                e.preventDefault();
                closeSidebar();
            }, { passive: false });
        }

        // Close sidebar when clicking a user/chat item on mobile
        if (userList) {
            userList.addEventListener('click', (e) => {
                const userItem = e.target.closest('.user-item, .chat-item');
                if (userItem && isMobile()) {
                    // Small delay to let the chat open first
                    setTimeout(() => {
                        closeSidebar();
                        updateMobileNavState();
                    }, 150);
                }
            });
        }

        // Watch for chat area active state changes
        if (chatAreaEl) {
            const observer = new MutationObserver(() => {
                updateMobileNavState();
            });
            observer.observe(chatAreaEl, { attributes: true, attributeFilter: ['class'] });
        }

        // Initial state check
        updateMobileNavState();

        // Close sidebar on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && userList && userList.classList.contains('open')) {
                closeSidebar();
            }
        });

        // Handle window resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (!isMobile()) {
                    // On desktop, ensure sidebar is visible and body scroll is restored
                    closeSidebar();
                    if (userList) userList.classList.remove('open');
                    document.body.classList.remove('mobile-chat-active');
                } else {
                    updateMobileNavState();
                }
            }, 100);
        });

        // Swipe gestures for mobile
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;

        document.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            if (!isMobile()) return;
            
            // Don't process swipe if it started on a button
            if (e.target.closest('button, .mobile-sidebar-toggle, .mobile-back-btn')) return;
            
            touchEndX = e.changedTouches[0].screenX;
            const touchEndY = e.changedTouches[0].screenY;
            const diffX = touchEndX - touchStartX;
            const diffY = Math.abs(touchEndY - touchStartY);

            // Only trigger if horizontal swipe is dominant
            if (Math.abs(diffX) > 80 && diffY < 100) {
                if (diffX > 0 && touchStartX < 50) {
                    // Swipe right from left edge - open sidebar
                    openSidebar();
                } else if (diffX < 0 && userList && userList.classList.contains('open')) {
                    // Swipe left - close sidebar
                    closeSidebar();
                }
            }
        }, { passive: true });

        // Expose functions globally for other scripts if needed
        window.comfiMobile = {
            openSidebar,
            closeSidebar,
            toggleSidebar,
            isMobile,
            updateMobileNavState
        };
    })();
});

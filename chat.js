document.addEventListener('DOMContentLoaded', () => {
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
    const blockUserBtn = document.getElementById('block-user-btn');
    const reportUserBtn = document.getElementById('report-user-btn');
    const reportPopup = document.getElementById('report-popup');
    const reportForm = document.getElementById('report-form');
    const chatArea = document.querySelector('.chat-area');
    chatArea.classList.remove('active');

    // Sample data for online users and chats
    let originalOnlineUsers = [
        { id: 1, name: 'Alice', age: 25, country: 'us', countryName: 'United States', gender: 'female', avatar: 'https://i.pravatar.cc/150?img=1' },
        { id: 2, name: 'Bob', age: 30, country: 'gb', countryName: 'United Kingdom', gender: 'male', avatar: 'https://i.pravatar.cc/150?img=2' },
        { id: 3, name: 'Charlie', age: 22, country: 'ca', countryName: 'Canada', gender: 'male', avatar: 'https://i.pravatar.cc/150?img=3' },
        { id: 4, name: 'Diana', age: 28, country: 'au', countryName: 'Australia', gender: 'female', avatar: 'https://i.pravatar.cc/150?img=4' },
    ];

    let onlineUsers = [...originalOnlineUsers];

    let activeChats = [
        { id: 1, name: 'Alice', age: 25, country: 'us', countryName: 'United States', lastMessage: 'Hey there!', avatar: 'https://i.pravatar.cc/150?img=1' },
        { id: 2, name: 'Bob', age: 30, country: 'gb', countryName: 'United Kingdom', lastMessage: 'How are you?', avatar: 'https://i.pravatar.cc/150?img=2' },
    ];

    function updateOnlineUsers() {
        const onlineUsersContainer = document.getElementById('online-users');
        onlineUsersContainer.innerHTML = '';
        onlineUsers.forEach(user => {
            const userElement = document.createElement('div');
            userElement.classList.add('user-item');
            userElement.innerHTML = `
            <img src="${user.avatar}" alt="${user.name}" class="user-avatar">
            <div class="user-info">
                <div class="user-name">${user.name}</div>
                <div class="user-details">${user.age} | <img src="https://flagcdn.com/w160/${user.country}.png" alt="${user.countryName}" class="flag-icon"> ${user.countryName}</div>
            </div>
            `;
            userElement.addEventListener('click', () => openChat(user));
            onlineUsersContainer.appendChild(userElement);
        });
        onlineCount.textContent = onlineUsers.length;
    }

    function updateActiveChats() {
        chatsTab.innerHTML = '';
        activeChats.forEach(chat => {
            const chatElement = document.createElement('div');
            chatElement.classList.add('chat-item');
            chatElement.innerHTML = `
        <img src="${chat.avatar}" alt="${chat.name}" class="chat-avatar">
        <div class="chat-info">
            <div class="chat-name">${chat.name}</div>
            <div class="chat-details">${chat.age} | <img src="https://flagcdn.com/w160/${chat.country}.png" alt="${chat.countryName}" class="flag-icon"> ${chat.countryName}</div>
            <div class="chat-preview">${chat.lastMessage}</div>
        </div>
            `;
            chatElement.addEventListener('click', () => openChat(chat));
            chatsTab.appendChild(chatElement);
        });
        chatsCount.textContent = activeChats.length;
    }

    function populateCountryFilter() {
        const countries = [...new Set(originalOnlineUsers.map(user => user.country))];
        countries.forEach(country => {
            const user = originalOnlineUsers.find(u => u.country === country);
            const option = document.createElement('option');
            option.value = country;
            option.innerHTML = `<img src="https://flagcdn.com/w160/${country}.png" alt="${user.countryName}" class="flag-icon"> ${user.countryName}`;
            countryFilter.appendChild(option);
        });
    }
   
    function applyFilters() {
        const gender = genderFilter.value;
        const country = countryFilter.value;
        const minAge = parseInt(ageMinSelect.value) || 13;
        const maxAge = parseInt(ageMaxSelect.value) || 100;

        onlineUsers = originalOnlineUsers.filter(user => {
            return (gender === 'all' || user.gender === gender) &&
                   (country === 'all' || user.country === country) &&
                   (user.age >= minAge && user.age <= maxAge);
        });

        updateOnlineUsers();
    }

    function resetFilters() {
        genderFilter.value = 'all';
        countryFilter.value = 'all';
        ageMinSelect.value = '';
        ageMaxSelect.innerHTML = '<option value="">Max Age</option>';
        for (let i = 13; i <= 100; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            ageMaxSelect.appendChild(option);
        }
        onlineUsers = [...originalOnlineUsers];
        updateOnlineUsers();
    }

    function openChat(user) {
        const chatArea = document.querySelector('.chat-area');
        const chatHeader = document.querySelector('.chat-header');
        const chatActions = document.querySelector('.chat-actions');
        const messages = document.querySelector('.messages');
        
        // Add active class to chat area
        chatArea.classList.add('active');
    
        chatHeader.innerHTML = `
            <h2>${user.name}</h2>
            <div class="user-info">${user.age} | <img src="https://flagcdn.com/w160/${user.country}.png" alt="${user.countryName}" class="flag-icon"> ${user.countryName}</div>
        `;
    
        chatActions.innerHTML = `
            <button id="block-user-btn" class="action-btn">Block</button>
            <button id="report-user-btn" class="action-btn">Report</button>
        `;
    
        messages.innerHTML = ''; // Clear previous messages
    
        // Reattach event listeners
        const blockUserBtn = document.getElementById('block-user-btn');
        const reportUserBtn = document.getElementById('report-user-btn');
    
        blockUserBtn.addEventListener('click', () => {
            console.log('Block user clicked');
        });
    
        reportUserBtn.addEventListener('click', () => {
            reportPopup.style.display = 'block';
        });
    }

    reportForm.addEventListener('submit', (e) => {
        e.preventDefault();
        // Implement report user functionality
        console.log('Report submitted:', {
            reason: document.querySelector('input[name="report-reason"]:checked').value,
            additionalInfo: document.getElementById('additional-info').value
        });
        // You'll add the actual reporting logic here later
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
            if (message) {
                // Add logic to send message
                console.log('Sending message:', message);
                messageInput.value = '';
            }
        });
    
        // Initialize
        updateOnlineUsers();
        updateActiveChats();
        populateCountryFilter();
    });
    
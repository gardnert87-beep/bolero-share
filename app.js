// Bolero Manager Web Share - CloudKit Integration

// Configuration
const CONFIG = {
    containerIdentifier: 'iCloud.com.TomGardner.BoleroManager',
    apiToken: 'bfdc86e315b19a4681a21bb4b952a3cdc4d45c654c26afe93edea018e9db72d7',
    environment: 'development',
    refreshInterval: 5000
};

// Headset types and their SVG icons
const HEADSET_TYPES = {
    'Single Ear': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5z" opacity="0.3"/>
        <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z"/>
    </svg>`,
    'Dual Ear': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5z"/>
        <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z"/>
    </svg>`,
    'In-Ear': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="8" cy="14" r="3"/>
        <circle cx="16" cy="14" r="3"/>
        <path d="M8 11V7M16 11V7"/>
    </svg>`,
    'Custom': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
        <circle cx="12" cy="17" r="0.5" fill="currentColor"/>
    </svg>`
};

// State
let state = {
    shareID: null,
    passcodeHash: null,
    showData: null,
    users: [],
    channels: [],
    departments: [],
    channelColors: {},
    departmentColors: {},
    isAuthenticated: false,
    isSyncing: false,
    lastUpdated: null
};

// CloudKit instance
let cloudKit = null;
let database = null;

// DOM Elements
const views = {
    loading: document.getElementById('loading-view'),
    passcode: document.getElementById('passcode-view'),
    error: document.getElementById('error-view'),
    editor: document.getElementById('editor-view')
};

// Initialize app
document.addEventListener('DOMContentLoaded', init);

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    state.shareID = urlParams.get('share');

    if (!state.shareID) {
        showError('No share link provided. Please use a valid share URL.');
        return;
    }

    try {
        await initCloudKit();
        await loadShareSession();
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to connect to the server. Please try again later.');
    }
}

async function initCloudKit() {
    return new Promise((resolve) => {
        CloudKit.configure({
            containers: [{
                containerIdentifier: CONFIG.containerIdentifier,
                apiTokenAuth: {
                    apiToken: CONFIG.apiToken,
                    persist: true
                },
                environment: CONFIG.environment
            }]
        });

        cloudKit = CloudKit.getDefaultContainer();
        database = cloudKit.publicCloudDatabase;
        resolve();
    });
}

async function loadShareSession() {
    showView('loading');

    try {
        const response = await database.fetchRecords([state.shareID]);

        if (!response.records || response.records.length === 0) {
            showError('This share link is invalid or has been revoked.');
            return;
        }

        const record = response.records[0];

        if (!record.fields.isActive || !record.fields.isActive.value) {
            showError('This share has been revoked by the owner.');
            return;
        }

        if (record.fields.expiresAt && record.fields.expiresAt.value) {
            const expiresAt = new Date(record.fields.expiresAt.value);
            if (new Date() > expiresAt) {
                showError('This share link has expired.');
                return;
            }
        }

        state.passcodeHash = record.fields.passcodeHash.value;

        const showName = record.fields.showName ? record.fields.showName.value : 'Shared Show';
        document.getElementById('show-name-display').textContent = showName;

        showView('passcode');
        document.getElementById('passcode-input').focus();

    } catch (error) {
        console.error('Error loading share session:', error);
        showError('Failed to load share. The link may be invalid or expired.');
    }
}

document.getElementById('passcode-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const passcode = document.getElementById('passcode-input').value;
    const errorEl = document.getElementById('passcode-error');

    const enteredHash = await hashPasscode(passcode);

    if (enteredHash !== state.passcodeHash) {
        errorEl.textContent = 'Incorrect passcode. Please try again.';
        errorEl.classList.remove('hidden');
        document.getElementById('passcode-input').value = '';
        document.getElementById('passcode-input').focus();
        return;
    }

    state.isAuthenticated = true;
    errorEl.classList.add('hidden');
    await loadSharedData();
});

async function hashPasscode(passcode) {
    const encoder = new TextEncoder();
    const data = encoder.encode(passcode);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadSharedData() {
    showView('loading');

    try {
        const showResponse = await database.fetchRecords([`${state.shareID}_show`]);
        if (showResponse.records && showResponse.records.length > 0) {
            const showRecord = showResponse.records[0];
            state.showData = {
                name: showRecord.fields.name ? showRecord.fields.name.value : 'Shared Show',
                channels: showRecord.fields.channels ? showRecord.fields.channels.value : [],
                departments: showRecord.fields.departments ? showRecord.fields.departments.value : [],
                channelSlotCount: showRecord.fields.channelSlotCount ? showRecord.fields.channelSlotCount.value : 6
            };

            if (showRecord.fields.channelColorsJSON && showRecord.fields.channelColorsJSON.value) {
                try {
                    state.channelColors = JSON.parse(showRecord.fields.channelColorsJSON.value);
                } catch (e) {
                    state.channelColors = {};
                }
            }

            if (showRecord.fields.departmentColorsJSON && showRecord.fields.departmentColorsJSON.value) {
                try {
                    state.departmentColors = JSON.parse(showRecord.fields.departmentColorsJSON.value);
                } catch (e) {
                    state.departmentColors = {};
                }
            }
        }

        const query = {
            recordType: 'SharedUser',
            filterBy: [{
                fieldName: 'shareID',
                comparator: 'EQUALS',
                fieldValue: { value: state.shareID }
            }]
        };

        const usersResponse = await database.performQuery(query);

        if (usersResponse.records) {
            state.users = usersResponse.records.map(record => ({
                recordName: record.recordName,
                userID: record.fields.userID ? record.fields.userID.value : '',
                firstName: record.fields.firstName ? record.fields.firstName.value : '',
                lastName: record.fields.lastName ? record.fields.lastName.value : '',
                nickname: record.fields.nickname ? record.fields.nickname.value : '',
                beltpackNumber: record.fields.beltpackNumber ? record.fields.beltpackNumber.value : null,
                channelAssignments: record.fields.channelAssignments ? record.fields.channelAssignments.value : [],
                department: record.fields.department ? record.fields.department.value : '',
                role: record.fields.role ? record.fields.role.value : '',
                headsetType: record.fields.headsetType ? record.fields.headsetType.value : 'Single Ear',
                recordChangeTag: record.recordChangeTag
            }));

            state.users.sort((a, b) => (a.beltpackNumber || 999) - (b.beltpackNumber || 999));
        }

        state.lastUpdated = new Date();

        showView('editor');
        renderEditor();

        setInterval(refreshData, CONFIG.refreshInterval);

    } catch (error) {
        console.error('Error loading shared data:', error);
        showError('Failed to load user data. Please try again.');
    }
}

function renderEditor() {
    document.getElementById('show-title').textContent = state.showData.name;
    updateSyncStatus('synced');
    updateLastUpdated();

    const channelCount = state.showData.channelSlotCount || 6;
    const headerCell = document.getElementById('channel-headers');
    headerCell.colSpan = channelCount;
    headerCell.textContent = `Channels`;

    const tbody = document.getElementById('users-body');
    tbody.innerHTML = '';

    state.users.forEach(user => {
        const row = createUserRow(user);
        tbody.appendChild(row);
    });
}

function createUserRow(user) {
    const row = document.createElement('tr');
    row.dataset.recordName = user.recordName;

    // BP#
    const bpCell = document.createElement('td');
    bpCell.className = 'bp-cell';
    bpCell.textContent = user.beltpackNumber || '--';
    row.appendChild(bpCell);

    // First Name
    row.appendChild(createEditableCell(user, 'firstName', user.firstName));

    // Last Name
    row.appendChild(createEditableCell(user, 'lastName', user.lastName));

    // Username (nickname)
    row.appendChild(createEditableCell(user, 'nickname', user.nickname, true));

    // Department
    row.appendChild(createDepartmentCell(user));

    // Headset (icon with hidden select)
    row.appendChild(createHeadsetCell(user));

    // Channel assignments
    const channelCount = state.showData.channelSlotCount || 6;
    for (let i = 0; i < channelCount; i++) {
        row.appendChild(createChannelCell(user, i));
    }

    return row;
}

function createEditableCell(user, field, value, isUsername = false) {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.dataset.field = field;
    input.dataset.recordName = user.recordName;

    if (isUsername) {
        input.className = 'username-input';
        input.placeholder = '.USERNAME';
    }

    let debounceTimer;
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        input.classList.add('saving');
        debounceTimer = setTimeout(() => saveField(user.recordName, field, input.value), 500);
    });

    cell.appendChild(input);
    return cell;
}

function createDepartmentCell(user) {
    const cell = document.createElement('td');

    if (user.department) {
        const badge = document.createElement('span');
        badge.className = 'dept-badge';

        const color = state.departmentColors[user.department];
        if (color) {
            const dot = document.createElement('span');
            dot.className = 'dept-color-dot';
            dot.style.backgroundColor = color;
            badge.appendChild(dot);
        }

        const text = document.createElement('span');
        text.textContent = user.department;
        badge.appendChild(text);

        cell.appendChild(badge);
    } else {
        cell.textContent = '--';
        cell.style.color = 'var(--text-muted)';
    }

    return cell;
}

function createHeadsetCell(user) {
    const cell = document.createElement('td');
    cell.className = 'headset-cell';

    const wrapper = document.createElement('div');
    wrapper.className = 'headset-icon-wrapper';
    wrapper.title = user.headsetType || 'Single Ear';

    // Icon
    const iconSpan = document.createElement('span');
    iconSpan.innerHTML = HEADSET_TYPES[user.headsetType] || HEADSET_TYPES['Single Ear'];
    wrapper.appendChild(iconSpan);

    // Hidden select
    const select = document.createElement('select');
    select.dataset.recordName = user.recordName;

    Object.keys(HEADSET_TYPES).forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        select.appendChild(option);
    });

    select.value = user.headsetType || 'Single Ear';

    select.addEventListener('change', () => {
        iconSpan.innerHTML = HEADSET_TYPES[select.value];
        wrapper.title = select.value;
        saveField(user.recordName, 'headsetType', select.value);
    });

    wrapper.appendChild(select);
    cell.appendChild(wrapper);
    return cell;
}

function createChannelCell(user, index) {
    const cell = document.createElement('td');
    cell.className = 'channel-cell';

    const wrapper = document.createElement('div');
    wrapper.className = 'channel-select-wrapper';

    const currentChannel = user.channelAssignments[index] || '';

    // Create the bubble
    const bubble = document.createElement('span');
    bubble.className = 'channel-bubble';
    updateChannelBubble(bubble, currentChannel);

    // Hidden select
    const select = document.createElement('select');
    select.dataset.recordName = user.recordName;
    select.dataset.channelIndex = index;

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '--';
    select.appendChild(emptyOption);

    state.showData.channels.forEach(channel => {
        const option = document.createElement('option');
        option.value = channel;
        option.textContent = channel;
        select.appendChild(option);
    });

    select.value = currentChannel;

    select.addEventListener('change', () => {
        updateChannelBubble(bubble, select.value);
        saveChannelAssignment(user.recordName, index, select.value);
    });

    wrapper.appendChild(bubble);
    wrapper.appendChild(select);
    cell.appendChild(wrapper);
    return cell;
}

function updateChannelBubble(bubble, channelName) {
    bubble.className = 'channel-bubble';

    if (!channelName) {
        bubble.classList.add('empty');
        bubble.textContent = '--';
        bubble.style.backgroundColor = '';
    } else {
        const color = state.channelColors[channelName.toUpperCase()];
        if (color) {
            bubble.classList.add('has-color');
            bubble.style.backgroundColor = color;
        } else {
            bubble.classList.add('no-color');
            bubble.style.backgroundColor = '';
        }
        bubble.textContent = channelName;
    }
}

function getChannelColor(channelName) {
    if (!channelName) return null;
    return state.channelColors[channelName.toUpperCase()] || null;
}

async function saveField(recordName, field, value) {
    updateSyncStatus('syncing');

    try {
        const user = state.users.find(u => u.recordName === recordName);
        if (!user) return;

        user[field] = value;

        const recordToSave = {
            recordType: 'SharedUser',
            recordName: recordName,
            recordChangeTag: user.recordChangeTag,
            fields: {
                [field]: { value: value },
                updatedAt: { value: Date.now() }
            }
        };

        const response = await database.saveRecords([recordToSave]);

        if (response.records && response.records.length > 0) {
            user.recordChangeTag = response.records[0].recordChangeTag;
        }

        const input = document.querySelector(`input[data-record-name="${recordName}"][data-field="${field}"]`);
        if (input) {
            input.classList.remove('saving');
            input.classList.add('saved');
            setTimeout(() => input.classList.remove('saved'), 500);
        }

        state.lastUpdated = new Date();
        updateSyncStatus('synced');
        updateLastUpdated();

    } catch (error) {
        console.error('Error saving field:', error);
        updateSyncStatus('error');
    }
}

async function saveChannelAssignment(recordName, index, channel) {
    updateSyncStatus('syncing');

    try {
        const user = state.users.find(u => u.recordName === recordName);
        if (!user) return;

        while (user.channelAssignments.length <= index) {
            user.channelAssignments.push('');
        }
        user.channelAssignments[index] = channel;

        const recordToSave = {
            recordType: 'SharedUser',
            recordName: recordName,
            recordChangeTag: user.recordChangeTag,
            fields: {
                channelAssignments: { value: user.channelAssignments },
                updatedAt: { value: Date.now() }
            }
        };

        const response = await database.saveRecords([recordToSave]);

        if (response.records && response.records.length > 0) {
            user.recordChangeTag = response.records[0].recordChangeTag;
        }

        state.lastUpdated = new Date();
        updateSyncStatus('synced');
        updateLastUpdated();

    } catch (error) {
        console.error('Error saving channel assignment:', error);
        updateSyncStatus('error');
    }
}

async function refreshData() {
    if (state.isSyncing || !state.isAuthenticated) return;

    state.isSyncing = true;

    try {
        const query = {
            recordType: 'SharedUser',
            filterBy: [{
                fieldName: 'shareID',
                comparator: 'EQUALS',
                fieldValue: { value: state.shareID }
            }]
        };

        const response = await database.performQuery(query);

        if (response.records) {
            let hasChanges = false;

            response.records.forEach(record => {
                const existingUser = state.users.find(u => u.recordName === record.recordName);
                if (existingUser && existingUser.recordChangeTag !== record.recordChangeTag) {
                    existingUser.firstName = record.fields.firstName ? record.fields.firstName.value : '';
                    existingUser.lastName = record.fields.lastName ? record.fields.lastName.value : '';
                    existingUser.nickname = record.fields.nickname ? record.fields.nickname.value : '';
                    existingUser.channelAssignments = record.fields.channelAssignments ? record.fields.channelAssignments.value : [];
                    existingUser.department = record.fields.department ? record.fields.department.value : '';
                    existingUser.headsetType = record.fields.headsetType ? record.fields.headsetType.value : 'Single Ear';
                    existingUser.recordChangeTag = record.recordChangeTag;
                    hasChanges = true;
                }
            });

            if (hasChanges) {
                renderEditor();
                state.lastUpdated = new Date();
                updateLastUpdated();
            }
        }

    } catch (error) {
        console.error('Error refreshing data:', error);
    }

    state.isSyncing = false;
}

function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

function showError(message) {
    document.getElementById('error-message').textContent = message;
    showView('error');
}

function updateSyncStatus(status) {
    const statusEl = document.getElementById('sync-status');
    statusEl.className = 'sync-status ' + status;

    const textEl = statusEl.querySelector('.sync-text');
    switch (status) {
        case 'syncing':
            textEl.textContent = 'Syncing...';
            break;
        case 'synced':
            textEl.textContent = 'Synced';
            break;
        case 'error':
            textEl.textContent = 'Error';
            break;
    }
}

function updateLastUpdated() {
    if (!state.lastUpdated) return;

    const el = document.getElementById('last-updated');
    const now = new Date();
    const diff = Math.floor((now - state.lastUpdated) / 1000);

    if (diff < 60) {
        el.textContent = 'Just now';
    } else if (diff < 3600) {
        const mins = Math.floor(diff / 60);
        el.textContent = `${mins}m ago`;
    } else {
        el.textContent = state.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

setInterval(updateLastUpdated, 60000);

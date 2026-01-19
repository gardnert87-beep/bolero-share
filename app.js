// Bolero Manager Web Share - CloudKit Integration

// Configuration
const CONFIG = {
    containerIdentifier: 'iCloud.com.TomGardner.BoleroManager',
    apiToken: 'bfdc86e315b19a4681a21bb4b952a3cdc4d45c654c26afe93edea018e9db72d7',
    environment: 'production',
    refreshInterval: 5000 // 5 seconds
};

// State
let state = {
    shareID: null,
    passcodeHash: null,
    showData: null,
    users: [],
    channels: [],
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
    // Get share ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    state.shareID = urlParams.get('share');

    if (!state.shareID) {
        showError('No share link provided. Please use a valid share URL.');
        return;
    }

    // Initialize CloudKit
    try {
        await initCloudKit();
        await loadShareSession();
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to connect to the server. Please try again later.');
    }
}

async function initCloudKit() {
    return new Promise((resolve, reject) => {
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

        // For public database access, we don't need user authentication
        resolve();
    });
}

async function loadShareSession() {
    showView('loading');

    try {
        // Fetch share session record
        const response = await database.fetchRecords([state.shareID]);

        if (!response.records || response.records.length === 0) {
            showError('This share link is invalid or has been revoked.');
            return;
        }

        const record = response.records[0];

        // Check if share is active
        if (!record.fields.isActive || !record.fields.isActive.value) {
            showError('This share has been revoked by the owner.');
            return;
        }

        // Check expiration
        if (record.fields.expiresAt && record.fields.expiresAt.value) {
            const expiresAt = new Date(record.fields.expiresAt.value);
            if (new Date() > expiresAt) {
                showError('This share link has expired.');
                return;
            }
        }

        // Store passcode hash for verification
        state.passcodeHash = record.fields.passcodeHash.value;

        // Show show name
        const showName = record.fields.showName ? record.fields.showName.value : 'Shared Show';
        document.getElementById('show-name-display').textContent = showName;

        // Show passcode view
        showView('passcode');
        document.getElementById('passcode-input').focus();

    } catch (error) {
        console.error('Error loading share session:', error);
        showError('Failed to load share. The link may be invalid or expired.');
    }
}

// Passcode form handler
document.getElementById('passcode-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const passcode = document.getElementById('passcode-input').value;
    const errorEl = document.getElementById('passcode-error');

    // Hash the entered passcode and compare
    const enteredHash = await hashPasscode(passcode);

    if (enteredHash !== state.passcodeHash) {
        errorEl.textContent = 'Incorrect passcode. Please try again.';
        errorEl.classList.remove('hidden');
        document.getElementById('passcode-input').value = '';
        document.getElementById('passcode-input').focus();
        return;
    }

    // Passcode correct - load data
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
        // Fetch show data
        const showResponse = await database.fetchRecords([`${state.shareID}_show`]);
        if (showResponse.records && showResponse.records.length > 0) {
            const showRecord = showResponse.records[0];
            state.showData = {
                name: showRecord.fields.name ? showRecord.fields.name.value : 'Shared Show',
                channels: showRecord.fields.channels ? showRecord.fields.channels.value : [],
                channelSlotCount: showRecord.fields.channelSlotCount ? showRecord.fields.channelSlotCount.value : 6
            };
        }

        // Fetch users
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
                recordChangeTag: record.recordChangeTag
            }));

            // Sort by beltpack number
            state.users.sort((a, b) => (a.beltpackNumber || 999) - (b.beltpackNumber || 999));
        }

        state.lastUpdated = new Date();

        // Show editor
        showView('editor');
        renderEditor();

        // Start auto-refresh
        setInterval(refreshData, CONFIG.refreshInterval);

    } catch (error) {
        console.error('Error loading shared data:', error);
        showError('Failed to load user data. Please try again.');
    }
}

function renderEditor() {
    // Set title
    document.getElementById('show-title').textContent = state.showData.name;
    updateSyncStatus('synced');
    updateLastUpdated();

    // Render channel headers
    const channelCount = state.showData.channelSlotCount || 6;
    const headerCell = document.getElementById('channel-headers');
    headerCell.colSpan = channelCount;
    headerCell.textContent = `Channels (1-${channelCount})`;

    // Render users
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

    // Nickname
    row.appendChild(createEditableCell(user, 'nickname', user.nickname));

    // Department (read-only)
    const deptCell = document.createElement('td');
    deptCell.textContent = user.department || '--';
    deptCell.style.color = 'var(--text-secondary)';
    row.appendChild(deptCell);

    // Role (read-only)
    const roleCell = document.createElement('td');
    roleCell.textContent = user.role || '--';
    roleCell.style.color = 'var(--text-secondary)';
    row.appendChild(roleCell);

    // Channel assignments
    const channelCount = state.showData.channelSlotCount || 6;
    for (let i = 0; i < channelCount; i++) {
        row.appendChild(createChannelCell(user, i));
    }

    return row;
}

function createEditableCell(user, field, value) {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.dataset.field = field;
    input.dataset.recordName = user.recordName;

    let debounceTimer;
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        input.classList.add('saving');
        debounceTimer = setTimeout(() => saveField(user.recordName, field, input.value), 500);
    });

    cell.appendChild(input);
    return cell;
}

function createChannelCell(user, index) {
    const cell = document.createElement('td');
    cell.className = 'channel-cell';

    const select = document.createElement('select');
    select.dataset.recordName = user.recordName;
    select.dataset.channelIndex = index;

    // Empty option
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '--';
    select.appendChild(emptyOption);

    // Channel options
    state.showData.channels.forEach(channel => {
        const option = document.createElement('option');
        option.value = channel;
        option.textContent = channel;
        select.appendChild(option);
    });

    // Set current value
    const currentChannel = user.channelAssignments[index] || '';
    select.value = currentChannel;

    select.addEventListener('change', () => {
        saveChannelAssignment(user.recordName, index, select.value);
    });

    cell.appendChild(select);
    return cell;
}

async function saveField(recordName, field, value) {
    updateSyncStatus('syncing');

    try {
        const user = state.users.find(u => u.recordName === recordName);
        if (!user) return;

        // Update local state
        user[field] = value;

        // Save to CloudKit
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

        // Flash saved indicator
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

        // Update local state
        while (user.channelAssignments.length <= index) {
            user.channelAssignments.push('');
        }
        user.channelAssignments[index] = channel;

        // Save to CloudKit
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
                    // Update local data
                    existingUser.firstName = record.fields.firstName ? record.fields.firstName.value : '';
                    existingUser.lastName = record.fields.lastName ? record.fields.lastName.value : '';
                    existingUser.nickname = record.fields.nickname ? record.fields.nickname.value : '';
                    existingUser.channelAssignments = record.fields.channelAssignments ? record.fields.channelAssignments.value : [];
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
            textEl.textContent = 'Sync Error';
            break;
    }
}

function updateLastUpdated() {
    if (!state.lastUpdated) return;

    const el = document.getElementById('last-updated');
    const now = new Date();
    const diff = Math.floor((now - state.lastUpdated) / 1000);

    if (diff < 60) {
        el.textContent = 'Updated just now';
    } else if (diff < 3600) {
        const mins = Math.floor(diff / 60);
        el.textContent = `Updated ${mins} min${mins > 1 ? 's' : ''} ago`;
    } else {
        el.textContent = `Updated at ${state.lastUpdated.toLocaleTimeString()}`;
    }
}

// Update the "last updated" display every minute
setInterval(updateLastUpdated, 60000);

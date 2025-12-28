import { appState } from './state.js';
import { getUsers, addUser, updateUser, deleteUser } from './auth.js';
import { showSavingIndicator, hideSavingIndicator } from './utils.js';

let allUsers = []; // Cache for users to avoid re-fetching

/**
 * Renders the custom multi-select component for access restrictions.
 * @param {HTMLElement} container - The div where the component should be rendered.
 * @param {string[]} preselectedItems - An array of already selected team/dispatcher names.
 */
function renderAccessMultiSelect(container, preselectedItems = []) {
    let selectedItems = [...preselectedItems];
    const allOptions = [
        ...appState.allTeamNames.map(name => ({ value: name, group: 'Teams' })),
        ...appState.allDispatcherNames.map(name => ({ value: name, group: 'Dispatchers' }))
    ];

    function renderComponent() {
        const availableOptions = allOptions
            .filter(opt => !selectedItems.includes(opt.value))
            .sort((a, b) => a.value.localeCompare(b.value));

        const groupedOptions = availableOptions.reduce((acc, opt) => {
            if (!acc[opt.group]) acc[opt.group] = [];
            acc[opt.group].push(opt);
            return acc;
        }, {});

        const pillsHTML = selectedItems.map(item => `
            <div class="multiselect-pill" data-value="${item}">
                <span>${item}</span>
                <button type="button" class="multiselect-pill-remove" data-value="${item}">&times;</button>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="multiselect-container" tabindex="0">
                ${pillsHTML}
                <input type="text" class="multiselect-search-input" placeholder="Search teams or dispatchers...">
            </div>
            <div class="multiselect-dropdown hidden"></div>
        `;

        const searchInput = container.querySelector('.multiselect-search-input');
        const dropdown = container.querySelector('.multiselect-dropdown');

        function showDropdown(filter = '') {
            let optionsHTML = '';
            const groupOrder = ['Teams', 'Dispatchers']; // <-- This is the new line that fixes the order
            const filteredGroups = groupOrder.filter(group =>
                groupedOptions[group] && groupedOptions[group].some(opt => opt.value.toLowerCase().includes(filter.toLowerCase()))
            );

            if (filteredGroups.length === 0) {
                optionsHTML = `<div class="multiselect-option text-gray-500">No matches found.</div>`;
            } else {
                filteredGroups.forEach(group => {
                    optionsHTML += `<div class="multiselect-option is-group-label">${group}</div>`;
                    groupedOptions[group].forEach(opt => {
                        if (opt.value.toLowerCase().includes(filter.toLowerCase())) {
                            optionsHTML += `<div class="multiselect-option" data-value="${opt.value}">${opt.value}</div>`;
                        }
                    });
                });
            }
            dropdown.innerHTML = optionsHTML;
            dropdown.classList.remove('hidden');
        }

        container.querySelector('.multiselect-container').addEventListener('click', () => searchInput.focus());
        searchInput.addEventListener('focus', () => showDropdown());
        searchInput.addEventListener('input', () => showDropdown(searchInput.value));
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) dropdown.classList.add('hidden');
        }, true);

        dropdown.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('multiselect-option') && e.target.dataset.value) {
                selectedItems.push(e.target.dataset.value);
                renderComponent();
                setTimeout(() => container.querySelector('.multiselect-search-input').focus(), 0);
            }
        });

        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('multiselect-pill-remove')) {
                const itemToRemove = e.target.dataset.value;
                selectedItems = selectedItems.filter(item => item !== itemToRemove);
                renderComponent();
                setTimeout(() => container.querySelector('.multiselect-search-input').focus(), 0);
            }
        });
    }

    renderComponent();
    // A way for the form handler to retrieve the selected items
    container.getSelectedItems = () => selectedItems;
}


/**
 * Main function to render the admin panel. Fetches users and builds the UI.
 */
export async function renderAdminPanel() {
    const contentContainer = document.getElementById('admin-settings-content');
    if (!contentContainer) return;

    contentContainer.innerHTML = `<div class="text-center p-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mx-auto"></div><p class="mt-4 text-gray-400">Loading Users...</p></div>`;

    try {
        allUsers = await getUsers();
        contentContainer.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-teal-400">User Management</h3>
                <button id="add-new-user-btn" class="save-btn !bg-teal-600 hover:!bg-teal-700">Add New User</button>
            </div>
            <div id="user-table-container" class="overflow-auto max-h-[65vh] border border-gray-700 rounded-lg"></div>
        `;
        renderUserTable();
        initializeAdminEventListeners();
    } catch (error) {
        contentContainer.innerHTML = `<div class="text-center p-8 text-red-400">${error.message}</div>`;
    }
}

/**
 * Renders the HTML table with all users.
 */
function renderUserTable() {
    const tableContainer = document.getElementById('user-table-container');
    if (!tableContainer) return;

    tableContainer.innerHTML = `
        <table class="min-w-full divide-y divide-gray-700">
            <thead class="bg-gray-700 sticky top-0 z-10">
                <tr>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">User</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Role</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Access Permissions</th>
                    <th class="px-4 py-2 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Loads Access</th>
                    <th class="px-4 py-2 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Delegation Access</th>
                    <th class="px-4 py-2 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Last Seen</th>
                    <th class="px-4 py-2 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-800">
                ${allUsers.map(user => `
                    <tr class="hover:bg-gray-700/50">
                        <td class="px-4 py-2 font-medium whitespace-nowrap">${user.email}</td>
                        <td class="px-4 py-2 whitespace-nowrap">${user.role}</td>
                        <td class="px-4 py-2 font-mono text-xs text-gray-400">${user.access || '-'}</td>
                        <td class="px-4 py-2 text-center">${user.permissions && user.permissions.hasLoadsAccess ? '✅' : '❌'}</td>
                        <td class="px-4 py-2 text-center">${user.permissions && user.permissions.hasDelegationAccess ? '✅' : '❌'}</td>
                        <td class="px-4 py-2 text-center text-xs text-gray-400">
                            ${user.last_seen ? new Date(user.last_seen).toLocaleString() : 'Never'}
                        </td>
                        <td class="px-4 py-2 text-right">
                            <div class="flex justify-end items-center gap-x-2">
                                <button class="toolbar-btn !p-2 edit-user-btn" data-user-id="${user.userId || user.id}" title="Edit User">✏️</button>
                                <button class="toolbar-btn !p-2 !bg-red-800 hover:!bg-red-700 delete-user-btn" data-user-id="${user.userId || user.id}" title="Delete User">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Opens the user form modal for either adding a new user or editing an existing one.
 * @param {object|null} user - The user object to edit, or null to add a new one.
 */
function openUserFormModal(user = null) {
    const modal = document.getElementById('user-form-modal');
    const title = document.getElementById('user-form-title');
    const form = document.getElementById('user-form');
    const passwordInput = document.getElementById('user-password-input');
    const accessContainer = document.getElementById('user-access-multiselect-container');

    form.reset();
    document.getElementById('user-id-input').value = '';

    if (user) {
        // Editing user
        title.textContent = 'Edit User';
        document.getElementById('user-id-input').value = user.userId;
        document.getElementById('user-email-input').value = user.email;
        document.getElementById('user-role-select').value = user.role;
        document.getElementById('user-loads-access-checkbox').checked = user.permissions.hasLoadsAccess || false;
        document.getElementById('user-delegation-access-checkbox').checked = user.permissions.hasDelegationAccess || false;
        
        passwordInput.placeholder = 'Leave blank to keep current password';
        passwordInput.required = false;
        
        const preselectedAccess = user.access ? user.access.split(',').map(item => item.trim()) : [];
        renderAccessMultiSelect(accessContainer, preselectedAccess);

    } else {
        // Adding new user
        title.textContent = 'Add New User';
        passwordInput.placeholder = 'Password';
        passwordInput.required = true;

        renderAccessMultiSelect(accessContainer, []);
    }

    // Role-based UI logic
    const roleSelect = document.getElementById('user-role-select');
    const roleDescription = document.getElementById('user-role-description');

    const roleExplanations = {
        'Admin': 'Full access to all features, including user management and all data across all teams and dispatchers.',
        'Operations': 'Full access to view all teams, dispatchers, and data. Cannot manage users.',
        'Team Lead': "Can view data for specific teams or dispatchers assigned under 'Access Permissions'. Cannot manage users.",
        'Dispatcher': "Can only view their own data. The dispatcher's name must be assigned under 'Access Permissions'."
    };
    
    const handleRoleChange = () => {
        if (!roleSelect) return;
        const selectedRole = roleSelect.value;
        const isAdminOrOps = selectedRole === 'Admin' || selectedRole === 'Operations';
        
        // Hide Access Permissions dropdown for Admins and Operations
        if (accessContainer?.parentElement) {
            accessContainer.parentElement.style.display = isAdminOrOps ? 'none' : 'block';
        }

        // Update the role description text
        if (roleDescription) {
            roleDescription.textContent = roleExplanations[selectedRole] || '';
        }
    };

    if (roleSelect) {
        roleSelect.onchange = handleRoleChange;
    }

    handleRoleChange(); // Initial setup based on current role

    modal.classList.remove('hidden');
}

/**
 * Handles the submission of the add/edit user form.
 * @param {Event} e - The form submission event.
 */
async function handleUserFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const saveBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const userId = document.getElementById('user-id-input').value;
    const password = document.getElementById('user-password-input').value;
    const accessContainer = document.getElementById('user-access-multiselect-container');
    const role = document.getElementById('user-role-select').value;
    
    const isAdminOrOps = role === 'Admin' || role === 'Operations';

    const userData = {
        userId: userId || null,
        email: document.getElementById('user-email-input').value,
       role: role,
        access: isAdminOrOps ? '' : accessContainer.getSelectedItems().join(', '),
        permissions: {
            hasLoadsAccess: document.getElementById('user-loads-access-checkbox').checked,
            hasDelegationAccess: document.getElementById('user-delegation-access-checkbox').checked,
        }
    };

    if (password) {
        userData.password = password;
    }

    showSavingIndicator(); // Show indicator
    try {
        if (userId) {
            await updateUser(userData);
        } else {
            await addUser(userData);
        }
        document.getElementById('user-form-modal').classList.add('hidden');
        await renderAdminPanel(); // Refresh the user list
    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        hideSavingIndicator(); // Hide indicator
        saveBtn.disabled = false;
        saveBtn.textContent = originalBtnText;
    }
}

/**
 * Sets up all necessary event listeners for the admin panel.
 */
function initializeAdminEventListeners() {
    document.getElementById('add-new-user-btn')?.addEventListener('click', () => openUserFormModal(null));

    document.getElementById('user-table-container')?.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('.edit-user-btn');
        const deleteBtn = e.target.closest('.delete-user-btn');

        if (editBtn) {
            const userId = editBtn.dataset.userId;
            const userToEdit = allUsers.find(u => String(u.userId) === String(userId));
            if (userToEdit) {
                openUserFormModal(userToEdit);
            }
        }

        if (deleteBtn) {
            const userId = deleteBtn.dataset.userId;
            const userToDelete = allUsers.find(u => String(u.userId) === String(userId));
            if (userToDelete && confirm(`Are you sure you want to delete the user: ${userToDelete.email}?`)) {
                try {
                    await deleteUser(userId);
                    renderAdminPanel(); // Refresh list
                } catch (error) {
                    alert(`Error: ${error.message}`);
                }
            }
        }
    });

    document.getElementById('close-user-form-modal-btn')?.addEventListener('click', () => {
        document.getElementById('user-form-modal').classList.add('hidden');
    });

    const userForm = document.getElementById('user-form');
    userForm.removeEventListener('submit', handleUserFormSubmit);
    userForm.addEventListener('submit', handleUserFormSubmit);
}
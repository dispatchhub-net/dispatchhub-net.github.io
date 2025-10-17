// 1.DispatchHub/auth.js

import { appState } from './state.js';
import { AUTH_APPS_SCRIPT_URL, SETTINGS_APPS_SCRIPT_URL } from './config.js';
import { hasPermission, PERMISSIONS, ROLES } from './permissions.js';

// (The normalizeUserObject, login, validateSession, logout, clearSession, and postAuthRequest functions remain the same)

/**
 * Normalizes the keys of the user object to lowercase.
 * @param {object} user - The user object from the backend.
 * @returns {object|null} A new user object with lowercase keys.
 */
function normalizeUserObject(user) {
    if (!user) return null;
    const newUser = {};
    for (const key in user) {
        newUser[key.toLowerCase()] = user[key];
    }
    // Handle the Permissions property which might be a JSON string
    if (typeof newUser.permissions === 'string') {
        try {
            newUser.permissions = JSON.parse(newUser.permissions);
        } catch (e) {
            console.error("Failed to parse user permissions string:", newUser.permissions);
            newUser.permissions = {};
        }
    }
    return newUser;
}


// --- CORE AUTHENTICATION FUNCTIONS ---

/**
 * Attempts to log in the user with the provided credentials.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>} The user object on success.
 * @throws {Error} On failure.
 */
export async function login(email, password) {
    const response = await postAuthRequest('login', { email, password });
    if (response.status === 'success') {
        appState.auth.isLoggedIn = true;
        const normalizedUser = normalizeUserObject(response.user);
        appState.auth.user = normalizedUser;

        

        appState.auth.token = response.token;
        // Store session in sessionStorage to persist across page reloads
        sessionStorage.setItem('dispatcherHubSession', JSON.stringify({
            email: normalizedUser.email,
            token: response.token
        }));
        return normalizedUser;
    } else {
        throw new Error(response.message || 'Login failed.');
    }
}

/**
 * Validates a stored session token.
 * @returns {Promise<object|null>} The user object if valid, otherwise null.
 */
export async function validateSession() {
    const session = JSON.parse(sessionStorage.getItem('dispatcherHubSession'));
    if (!session || !session.email || !session.token) {
        return null;
    }

    try {
        const response = await postAuthRequest('validateToken', { email: session.email, token: session.token });
        if (response.status === 'success') {
            appState.auth.isLoggedIn = true;
            const normalizedUser = normalizeUserObject(response.user);
            appState.auth.user = normalizedUser;

            

            appState.auth.token = session.token;
            return normalizedUser;
        } else {
            clearSession();
            return null;
        }
    } catch (error) {
        console.error("Session validation failed:", error);
        clearSession();
        return null;
    }
}

/**
 * Logs the user out by clearing local session and notifying the server.
 */
export async function logout() {
    const session = JSON.parse(sessionStorage.getItem('dispatcherHubSession'));
    if (session && session.email) {
        try {
            // Notify server to invalidate the token (optional but good practice)
            await postAuthRequest('logout', { email: session.email });
        } catch (error) {
            console.error("Server logout failed, clearing client session anyway.", error);
        }
    }
    clearSession();
    // The window reload is now handled in main.js after showing the loader.
}

/**
 * Clears all session information from the client.
 */
function clearSession() {
    appState.auth.isLoggedIn = false;
    appState.auth.user = null;
    appState.auth.token = null;
    sessionStorage.removeItem('dispatcherHubSession');
}

// --- PERMISSION HELPERS ---

export function isAdmin() {
  return appState.auth.user?.role?.trim() === ROLES.ADMIN;
}

export function hasLoadsAccess() {
  // This function now uses the centralized permission check.
  // It also includes the specific override from the user's profile.
  return hasPermission(appState.auth.user, PERMISSIONS.VIEW_LOADS) || appState.auth.user?.permissions?.hasLoadsAccess === true;
}

export function canViewSnapshot() {
  return hasPermission(appState.auth.user, PERMISSIONS.VIEW_SNAPSHOT);
}

// --- GENERIC API REQUEST FUNCTION ---

/**
 * Sends a POST request to the authentication Apps Script.
 * @param {string} action The action to perform (e.g., 'login').
 * @param {object} payload The data to send with the action.
 * @returns {Promise<object>} The JSON response from the server.
 */
async function postAuthRequest(action, payload) {
    const response = await fetch(AUTH_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain;charset=utf-8', // Apps Script requirement
        },
        body: JSON.stringify({ action, payload }),
        redirect: 'follow'
    });

    if (!response.ok) {
        throw new Error(`Network error: ${response.statusText}`);
    }

    return response.json();
}

// --- USER MANAGEMENT API FUNCTIONS (for Admins) ---

/**
 * Fetches the list of all users from the backend.
 * @returns {Promise<Array>} A list of user objects.
 */
export async function getUsers() {
    const { user, token } = appState.auth;
    if (!user || !token || !hasPermission(user, PERMISSIONS.MANAGE_USERS)) throw new Error("Permission Denied.");

    const response = await postAuthRequest('getUsers', { adminEmail: user.email, adminToken: token });
    if (response.status === 'success') {
        return response.users;
    } else {
        throw new Error(response.message || 'Failed to fetch users.');
    }
}

/**
 * Adds a new user to the system.
 * @param {object} userData - The new user's data, including email, password, role, etc.
 * @returns {Promise<object>} The success response.
 */
export async function addUser(userData) {
    const { user, token } = appState.auth;
    if (!user || !token || !hasPermission(user, PERMISSIONS.MANAGE_USERS)) throw new Error("Permission Denied.");

    const response = await postAuthRequest('addUser', { adminEmail: user.email, adminToken: token, userData });
    if (response.status === 'success') {
        return response;
    } else {
        throw new Error(response.message || 'Failed to add user.');
    }
}

/**
 * Updates an existing user's data.
 * @param {object} userData - The user data to update, must include userId.
 * @returns {Promise<object>} The success response.
 */
export async function updateUser(userData) {
    const { user, token } = appState.auth;
    if (!user || !token || !hasPermission(user, PERMISSIONS.MANAGE_USERS)) throw new Error("Permission Denied.");

    const response = await postAuthRequest('updateUser', { adminEmail: user.email, adminToken: token, userData });
    if (response.status === 'success') {
        return response;
    } else {
        throw new Error(response.message || 'Failed to update user.');
    }
}

/**
 * Deletes a user from the system.
 * @param {string|number} userId - The ID of the user to delete.
 * @returns {Promise<object>} The success response.
 */
export async function deleteUser(userId) {
    const { user, token } = appState.auth;
    if (!user || !token || !hasPermission(user, PERMISSIONS.MANAGE_USERS)) throw new Error("Permission Denied.");

    const response = await postAuthRequest('deleteUser', { adminEmail: user.email, adminToken: token, userId });
    if (response.status === 'success') {
        return response;
    } else {
        throw new Error(response.message || 'Failed to delete user.');
    }
}


// --- WHITELIST PERMISSION HELPERS ---

/**
 * Checks if the current user can view data for a specific team.
 * @param {string} teamName - The name of the team to check.
 * @returns {boolean}
 */
export function canViewTeam(teamName) {
    const user = appState.auth.user;
    
    if (hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS) || user?.permissions?.viewAllTeams === true) {
        return true;
    }

    let allowedItems = [];
    if (user && user.access) {
        if (Array.isArray(user.access)) {
            allowedItems = user.access.map(item => String(item).trim().toLowerCase());
        } else if (typeof user.access === 'string' && user.access.trim()) {
            allowedItems = user.access.split(',').map(item => item.trim().toLowerCase());
        }
    }

    if (allowedItems.length === 0) {
        return false;
    }

    // This is now a strict, exact match.
    if (user.role === 'Team Lead' || user.role === 'Operations') {
        const hasAccess = allowedItems.includes(teamName.toLowerCase());
        return hasAccess;
    }

    if (user.role === 'Dispatcher') {
        const dispatcherNameFromAccess = allowedItems[0];
        if (!dispatcherNameFromAccess) return false;

        const dispatcherInfo = appState.profiles.liveDriverCountData.find(d => d.dispatcher_name?.toLowerCase() === dispatcherNameFromAccess);
        if (dispatcherInfo && dispatcherInfo.dispatcher_team) {
            const hasAccess = dispatcherInfo.dispatcher_team.toLowerCase() === teamName.toLowerCase();
            return hasAccess;
        }
        
        const historicalDispatcherInfo = appState.allHistoricalData
            .filter(d => d.dispatcherName?.toLowerCase() === dispatcherNameFromAccess)
            .sort((a,b) => new Date(b.date) - new Date(a.date));
        
        if (historicalDispatcherInfo.length > 0 && historicalDispatcherInfo[0].dispatcherTeam) {
            const hasAccess = historicalDispatcherInfo[0].dispatcherTeam.toLowerCase() === teamName.toLowerCase();
            return hasAccess;
        }
    }

    return false;
}

/**
 * Checks if the current user can view data for a specific dispatcher.
 * @param {string} dispatcherName - The name of the dispatcher to check.
 * @returns {boolean}
 */
export function canViewDispatcher(dispatcherName) {
    const user = appState.auth.user;
    if (hasPermission(user, PERMISSIONS.VIEW_ALL_DISPATCHERS) || user?.permissions?.viewAllDispatchers === true) {
        return true;
    }
    if (!user || !user.access) {
        return false;
    }

    const allowedItems = (Array.isArray(user.access) ? user.access : String(user.access).split(','))
        .map(item => String(item).trim().toLowerCase())
        .filter(Boolean);

    if (allowedItems.length === 0) {
        return false;
    }
    
    const targetDispatcherName = dispatcherName.toLowerCase();

    // A 'Dispatcher' can only see their own data.
    if (user.role === 'Dispatcher') {
        return allowedItems.includes(targetDispatcherName);
    }

    // For 'Team Lead' or 'Operations' roles.
    if (user.role === 'Team Lead' || user.role === 'Operations') {
        // 1. Check if they have direct access to the dispatcher by name.
        if (allowedItems.includes(targetDispatcherName)) {
            return true;
        }

        // 2. If not, find the dispatcher's full composite team name and check for an exact match.
        const specialPrefixes = ['agnius', 'miles', 'uros'];
        let dispatcherTeamName = null;
        let dispatcherCompanyName = null;

        // Check live data first for the most current team info.
        const liveInfo = appState.profiles.liveDriverCountData.find(d => d.dispatcher_name?.toLowerCase() === targetDispatcherName);
        if (liveInfo) {
            dispatcherTeamName = liveInfo.dispatcher_team;
            dispatcherCompanyName = liveInfo.company_name;
        } else {
            // Fallback to historical data if not in live data.
            const historicalInfo = appState.allHistoricalData.find(d => d.dispatcherName?.toLowerCase() === targetDispatcherName);
            if(historicalInfo) {
                dispatcherTeamName = historicalInfo.dispatcherTeam;
                // Note: Historical data might not have a separate company name field for this logic.
                // This logic assumes the most relevant data is in liveDriverCountData.
            }
        }

        if (dispatcherTeamName) {
            const teamLower = dispatcherTeamName.toLowerCase();
            const prefix = specialPrefixes.find(p => teamLower.startsWith(p));
            let finalTeamToCheck;

            if (prefix && dispatcherCompanyName) {
                // Construct the full composite name (e.g., "Agnius SMJ")
                finalTeamToCheck = `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} ${dispatcherCompanyName}`;
            } else {
                // Use the team name as-is for non-composite teams (e.g., "SMT")
                finalTeamToCheck = dispatcherTeamName;
            }
            
            // Perform a strict, exact match against the user's permissions.
            if (allowedItems.includes(finalTeamToCheck.toLowerCase())) {
                return true;
            }
        }
    }

    // If no conditions are met, deny access.
    return false;
}

/**
 * Updates the fleet health settings in the Google Sheet.
 * @param {object} settings - The settings object to save.
 * @returns {Promise<object>} The success response.
 */
export async function updateFleetHealthSettings(settings) {
    const { user, token } = appState.auth;
    if (!user || !token || !hasPermission(user, PERMISSIONS.MANAGE_USERS)) throw new Error("Permission Denied.");

    // This uses the new settings URL you've added to config.js
    const response = await fetch(SETTINGS_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({
            action: 'updateSettings',
            payload: {
                adminEmail: user.email,
                adminToken: token,
                settings: settings,
            },
        }),
        redirect: 'follow'
    });

    if (!response.ok) {
        throw new Error(`Network error: ${response.statusText}`);
    }

    return response.json();
}
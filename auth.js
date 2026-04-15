// 1.DispatchHub/auth.js

import { appState } from './state.js';
import { supabase, AUTH_APPS_SCRIPT_URL, SETTINGS_APPS_SCRIPT_URL } from './config.js'; // Added supabase
import { hasPermission, PERMISSIONS, ROLES } from './permissions.js';

// --- HELPER: Hash Password to SHA-256 (Matches your spreadsheet) ---
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

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

export async function login(email, password) {
    // 1. Hash the input password
    const hashedPassword = await sha256(password);

    // 2. Call Supabase
    const { data: user, error } = await supabase
        .rpc('login_custom', { 
            user_email: email, 
            user_hash: hashedPassword 
        });

    if (error) {
        console.error("Login Error:", error);
        throw new Error("Connection failed. Please try again.");
    }

    if (!user) {
        throw new Error("Invalid email or password.");
    }

    // 3. Update App State
    appState.auth.isLoggedIn = true;
    appState.auth.user = user;
    
    // --- FIX: Save the token/hash so other functions can use it ---
    appState.auth.token = user.token || hashedPassword; 

    // 4. Store session locally
    sessionStorage.setItem('dispatcherHubSession', JSON.stringify({
        email: user.email,
        hash: hashedPassword,
        token: appState.auth.token 
    }));

    return user;
}

export async function validateSession() {
    const session = JSON.parse(sessionStorage.getItem('dispatcherHubSession'));
    if (!session || !session.email || !session.hash) return null;

    try {
        const { data: user, error } = await supabase
            .rpc('login_custom', { 
                user_email: session.email, 
                user_hash: session.hash 
            });

        if (user && !error) {
            appState.auth.isLoggedIn = true;
            appState.auth.user = user;
            
            // --- FIX: Restore the token here too ---
            appState.auth.token = user.token || session.hash;
            
            return user;
        }
    } catch (e) {
        console.error("Session validation error:", e);
    }
    
    clearSession();
    return null;
}

export async function logout() {
    clearSession();
    // No server call needed for this custom auth method
}

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

// --- USER MANAGEMENT API FUNCTIONS (Using Supabase RPC) ---

export async function getUsers() {
    const { user } = appState.auth;
    // We check permission here to fail fast on the client side
    if (!user || !hasPermission(user, PERMISSIONS.MANAGE_USERS)) throw new Error("Permission Denied.");

    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('email');

    if (error) throw new Error(error.message);
    
    return data.map(u => ({
        ...u,
        userId: u.id 
    }));
}

export async function addUser(userData) {
    const { user } = appState.auth;
    if (!user || !hasPermission(user, PERMISSIONS.MANAGE_USERS)) throw new Error("Permission Denied.");

    // Hash the password if provided
    let passwordHash = null;
    if (userData.password) {
        passwordHash = await sha256(userData.password);
    }

    // Call your new SQL function: admin_add_user
    const { data, error } = await supabase.rpc('admin_add_user', {
        requestor_email: user.email,
        new_email: userData.email,
        new_password_hash: passwordHash,
        new_role: userData.role,
        new_access: userData.access,
        new_permissions: userData.permissions || {}
    });

    if (error) throw new Error(error.message);
    return data;
}

export async function updateUser(userData) {
    const { user } = appState.auth;
    if (!user || !hasPermission(user, PERMISSIONS.MANAGE_USERS)) throw new Error("Permission Denied.");

    let passwordHash = null;
    if (userData.password) {
        passwordHash = await sha256(userData.password);
    }

    // Call your new SQL function: admin_update_user
    const { data, error } = await supabase.rpc('admin_update_user', {
        requestor_email: user.email,
        target_user_id: userData.userId,
        new_email: userData.email,
        new_role: userData.role,
        new_access: userData.access,
        new_permissions: userData.permissions || {},
        new_password_hash: passwordHash 
    });

    if (error) throw new Error(error.message);
    return data;
}

export async function deleteUser(userId) {
    const { user } = appState.auth;
    if (!user || !hasPermission(user, PERMISSIONS.MANAGE_USERS)) throw new Error("Permission Denied.");

    // Call your new SQL function: admin_delete_user
    const { data, error } = await supabase.rpc('admin_delete_user', {
        requestor_email: user.email,
        target_user_id: userId
    });

    if (error) throw new Error(error.message);
    return data;
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

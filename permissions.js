// 1.DispatchHub/permissions.js

export const PERMISSIONS = {
    VIEW_LOADS: 'view:loads',
    VIEW_DELEGATION: 'view:delegation',
    VIEW_SNAPSHOT: 'view:snapshot',
    MANAGE_USERS: 'manage:users',
    VIEW_ALL_TEAMS: 'view:all_teams',
    VIEW_ALL_DISPATCHERS: 'view:all_dispatchers',
  };
  
  export const ROLES = {
    ADMIN: 'Admin',
    TEAM_LEAD: 'Team Lead',
    OPERATIONS: 'Operations',
    DISPATCHER: 'Dispatcher',
  };
  
  const userPermissions = {
    [ROLES.ADMIN]: [
      PERMISSIONS.VIEW_LOADS,
      PERMISSIONS.VIEW_SNAPSHOT,
      PERMISSIONS.MANAGE_USERS,
      PERMISSIONS.VIEW_ALL_TEAMS,
      PERMISSIONS.VIEW_ALL_DISPATCHERS,
    ],
    [ROLES.TEAM_LEAD]: [
      PERMISSIONS.VIEW_SNAPSHOT,
    ],
    [ROLES.OPERATIONS]: [
      PERMISSIONS.VIEW_SNAPSHOT,
      PERMISSIONS.VIEW_ALL_TEAMS,
      PERMISSIONS.VIEW_ALL_DISPATCHERS,
    ],
    [ROLES.DISPATCHER]: [],
  };
  
  export function hasPermission(user, permission) {
    if (!user || !user.role) {
      return false;
    }
  
    const userRole = user.role.trim();
    
    // Admins have all permissions implicitly
    if (userRole === ROLES.ADMIN) {
      return true;
    }
  
    const permissionsForRole = userPermissions[userRole];
  
    if (!permissionsForRole) {
      return false;
    }
  
    return permissionsForRole.includes(permission);
  }
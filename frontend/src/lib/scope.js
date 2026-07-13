// src/lib/scope.js
// Build the Self / Team / All scope tabs for a user, driven by Access Control.
//  - ADMIN: sees everything company-wide, so no scope tabs.
//  - 'team' is gated by the `view_team` permission (employees excluded by default).
//  - 'all' stays FINANCE-only (ADMIN already handled above).
export function scopeTabsFor(role, accessControl) {
  if (role === 'ADMIN') return [];
  const canTeam = (accessControl?.view_team || ['MANAGER', 'FINANCE', 'ADMIN']).includes(role);
  const tabs = [['self', 'Self']];
  if (canTeam) tabs.push(['team', 'Team']);
  if (role === 'FINANCE') tabs.push(['all', 'All']);
  return tabs;
}

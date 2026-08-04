/**
 * In-page snippet that resolves `username` to a numeric user id in `userId`.
 *
 * `web_profile_info` answers HTTP 400 for business and professional accounts,
 * so the commands that need an id fall back to feed-by-username. Its root
 * `user.pk` is the profile owner; `items[0].user.pk` can be a pinned collab
 * author. Callers must already have `username` and `opts` in scope.
 */
export function buildResolveInstagramUserIdJs() {
    return `
  const r1 = await fetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username), opts);
  if (r1.status === 404) throw new Error('User not found: ' + username);
  let userId = r1.ok ? ((await r1.json())?.data?.user?.id || '') : '';
  if (!userId) {
    const r1b = await fetch('https://www.instagram.com/api/v1/feed/user/' + encodeURIComponent(username) + '/username/?count=1', opts);
    if (!r1b.ok) throw new Error(r1b.status === 404 ? 'User not found: ' + username : 'HTTP ' + r1b.status + ' - make sure you are logged in to Instagram');
    userId = String((await r1b.json())?.user?.pk || '');
    if (!userId) throw new Error('Instagram feed returned no profile owner for: ' + username);
  }`;
}

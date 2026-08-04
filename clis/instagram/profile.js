import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'profile',
    access: 'read',
    description: 'Get Instagram user profile info',
    domain: 'www.instagram.com',
    args: [
        { name: 'username', required: true, positional: true, help: 'Instagram username' },
    ],
    columns: ['username', 'name', 'followers', 'following', 'posts', 'verified', 'bio'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const opts = { credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459' } };
  const r1 = await fetch(
    'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username),
    opts
  );
  if (r1.status === 404) throw new Error('User not found: ' + username);
  if (r1.ok) {
    const data = await r1.json();
    const u = data?.data?.user;
    if (!u) throw new Error('User not found: ' + username);
    return [{
      username: u.username,
      name: u.full_name || '',
      bio: (u.biography || '').replace(/\\n/g, ' ').substring(0, 120),
      followers: u.edge_followed_by?.count ?? 0,
      following: u.edge_follow?.count ?? 0,
      posts: u.edge_owner_to_timeline_media?.count ?? 0,
      verified: u.is_verified ? 'Yes' : 'No',
      url: 'https://www.instagram.com/' + u.username,
    }];
  }
  // web_profile_info answers HTTP 400 for business/professional accounts.
  // Resolve the id via feed-by-username (its root user.pk is the profile
  // owner), then read the full profile from users/<id>/info/.
  const r2 = await fetch(
    'https://www.instagram.com/api/v1/feed/user/' + encodeURIComponent(username) + '/username/?count=1',
    opts
  );
  if (!r2.ok) throw new Error(r2.status === 404 ? 'User not found: ' + username : 'HTTP ' + r2.status + ' - make sure you are logged in to Instagram');
  const pk = String((await r2.json())?.user?.pk || '');
  if (!pk) throw new Error('Instagram feed returned no profile owner for: ' + username);
  const r3 = await fetch('https://www.instagram.com/api/v1/users/' + pk + '/info/', opts);
  if (!r3.ok) throw new Error('HTTP ' + r3.status + ' - make sure you are logged in to Instagram');
  const u = (await r3.json())?.user;
  if (!u) throw new Error('Instagram user info returned no profile for: ' + username);
  return [{
    username: u.username,
    name: u.full_name || '',
    bio: (u.biography || '').replace(/\\n/g, ' ').substring(0, 120),
    followers: u.follower_count ?? 0,
    following: u.following_count ?? 0,
    posts: u.media_count ?? 0,
    verified: u.is_verified ? 'Yes' : 'No',
    url: 'https://www.instagram.com/' + u.username,
  }];
})()
` },
    ],
});

import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'save',
    access: 'write',
    description: 'Save (bookmark) an Instagram post',
    domain: 'www.instagram.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'Username of the post author',
        },
        { name: 'index', type: 'int', default: 1, help: 'Post index (1 = most recent)' },
    ],
    columns: ['status', 'user', 'post'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const idx = \${{ args.index }} - 1;
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const opts = { credentials: 'include', headers };

  // web_profile_info answers HTTP 400 for business accounts; feed-by-username needs no user id. See #2234.
  const r1 = await fetch('https://www.instagram.com/api/v1/feed/user/' + encodeURIComponent(username) + '/username/?count=' + (idx + 1), opts);
  if (!r1.ok) throw new Error(r1.status === 404 ? 'User not found: ' + username : 'HTTP ' + r1.status + ' - make sure you are logged in to Instagram');
  const posts = (await r1.json())?.items || [];
  if (idx >= posts.length) throw new Error('Post index ' + (idx + 1) + ' not found');
  const pk = posts[idx].pk;
  const caption = (posts[idx].caption?.text || '').substring(0, 60);

  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
  const r2 = await fetch('https://www.instagram.com/api/v1/web/save/' + pk + '/save/', {
    method: 'POST', credentials: 'include',
    headers: { ...headers, 'X-CSRFToken': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r2.ok) throw new Error('Failed to save: HTTP ' + r2.status);
  return [{ status: 'Saved', user: username, post: caption || '(post #' + (idx+1) + ')' }];
})()
` },
    ],
});

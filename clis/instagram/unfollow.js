import { cli } from '@jackwener/opencli/registry';
import { buildResolveInstagramUserIdJs } from './_shared/user-id.js';
cli({
    site: 'instagram',
    name: 'unfollow',
    access: 'write',
    description: 'Unfollow an Instagram user',
    domain: 'www.instagram.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'Instagram username to unfollow',
        },
    ],
    columns: ['status', 'username'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const opts = { credentials: 'include', headers };

  ${buildResolveInstagramUserIdJs()}

  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
  const r2 = await fetch('https://www.instagram.com/api/v1/friendships/destroy/' + userId + '/', {
    method: 'POST',
    credentials: 'include',
    headers: { ...headers, 'X-CSRFToken': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r2.ok) throw new Error('Failed to unfollow: HTTP ' + r2.status);
  return [{ status: 'Unfollowed', username }];
})()
` },
    ],
});

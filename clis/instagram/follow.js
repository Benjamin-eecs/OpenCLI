import { cli } from '@jackwener/opencli/registry';
import { buildResolveInstagramUserIdJs } from './_shared/user-id.js';
cli({
    site: 'instagram',
    name: 'follow',
    access: 'write',
    description: 'Follow an Instagram user',
    domain: 'www.instagram.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'Instagram username to follow',
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
  const r2 = await fetch('https://www.instagram.com/api/v1/friendships/create/' + userId + '/', {
    method: 'POST',
    credentials: 'include',
    headers: { ...headers, 'X-CSRFToken': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r2.ok) throw new Error('Failed to follow: HTTP ' + r2.status);
  const d2 = await r2.json();
  const status = d2?.friendship_status?.following ? 'Following' : d2?.friendship_status?.outgoing_request ? 'Request sent' : 'Followed';
  return [{ status, username }];
})()
` },
    ],
});

import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const INSTAGRAM_APP_ID = '936619743392459';
const LIKE_LABELS = ['Like', '赞'];
const UNLIKE_LABELS = ['Unlike', '取消赞'];

function unwrapEvaluateResult(result) {
    return result && typeof result === 'object' && !Array.isArray(result) && 'data' in result && 'session' in result
        ? result.data
        : result;
}

function labelSelector(labels) {
    return labels.map((label) => `svg[aria-label="${label}"]`).join(', ');
}

export function buildReadPostsJs(username, count) {
    return `(async () => {
  const res = await fetch(
    'https://www.instagram.com/api/v1/feed/user/' + encodeURIComponent(${JSON.stringify(username)}) + '/username/?count=' + ${count},
    { credentials: 'include', headers: { 'X-IG-App-ID': '${INSTAGRAM_APP_ID}' } }
  );
  if (!res.ok) return { error: res.status };
  const items = (await res.json())?.items || [];
  return {
    items: items.map((item) => ({
      code: item.code || '',
      caption: (item.caption?.text || '').substring(0, 60),
      liked: !!item.has_liked,
    })),
  };
})()`;
}

// Comment rows repeat the like labels on 16px icons, so only a 24px icon in a
// sparse section/div[role="group"] is the post control (#2241).
function buildFindControlJs(body) {
    return `(() => {
  const isActionBar = (icon) => {
    const bar = icon.closest('section, div[role="group"]');
    return !!bar && bar.querySelectorAll('svg[aria-label]').length <= 8;
  };
  const control = Array.from(document.querySelectorAll('${labelSelector([...LIKE_LABELS, ...UNLIKE_LABELS])}'))
    .find((icon) => Math.round(icon.getBoundingClientRect().width) >= 24 && isActionBar(icon)) || null;
  const liked = control ? ${JSON.stringify(UNLIKE_LABELS)}.includes(control.getAttribute('aria-label')) : null;
${body}
})()`;
}

export function buildToggleLikeJs(shouldLike) {
    return buildFindControlJs(`  if (!control) return { found: false };
  if (liked === ${shouldLike}) return { found: true, already: true };
  const button = control.closest('div[role="button"], button');
  if (!button) return { found: false };
  button.click();
  return { found: true, already: false };`);
}

export function buildReadLikeStateJs(shouldLike) {
    return buildFindControlJs(`  return liked === ${shouldLike};`);
}

export async function setInstagramPostLike(page, kwargs, shouldLike) {
    const username = String(kwargs.username || '').trim();
    const index = kwargs.index;
    const command = shouldLike ? 'instagram like' : 'instagram unlike';
    if (!Number.isInteger(index) || index < 1) {
        throw new ArgumentError('--index must be a positive integer', 'e.g. --index 2 for the second most recent post');
    }

    const feed = unwrapEvaluateResult(await page.evaluate(buildReadPostsJs(username, index)));
    if (feed?.error) {
        throw feed.error === 404
            ? new EmptyResultError(command, `No Instagram user named ${username}.`)
            : new CommandExecutionError(`Instagram returned HTTP ${feed.error} for ${username}'s posts`, 'Verify you are logged in to Instagram.');
    }
    const posts = Array.isArray(feed?.items) ? feed.items : [];
    const post = posts[index - 1];
    if (!post) {
        throw new EmptyResultError(command, posts.length === 0
            ? `No visible posts for ${username}; check the username and whether the account is private.`
            : `Post index ${index} not found; ${username} has ${posts.length} recent posts.`);
    }
    if (!post.code) {
        throw new CommandExecutionError('Instagram feed returned a post without a shortcode', 'The response shape may have changed.');
    }

    const label = post.caption || `(post #${index})`;
    const settled = [{ status: shouldLike ? 'Already liked' : 'Already unliked', user: username, post: label }];
    if (post.liked === shouldLike) return settled;

    await page.goto(`https://www.instagram.com/p/${post.code}/`, { settleMs: 2000 });
    let click = null;
    for (let attempt = 0; attempt < 5 && !click?.found; attempt += 1) {
        if (attempt > 0) await page.sleep(1);
        click = unwrapEvaluateResult(await page.evaluate(buildToggleLikeJs(shouldLike)));
    }
    if (!click?.found) {
        throw new CommandExecutionError(
            `Could not find the like control on ${post.code}`,
            'Open the post in the browser and check whether Instagram is asking you to log in, or set the interface language to English.',
        );
    }
    if (click.already) return settled;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        await page.sleep(1);
        if (unwrapEvaluateResult(await page.evaluate(buildReadLikeStateJs(shouldLike))) !== true) continue;
        // A rejected action reverts the icon shortly after the optimistic flip.
        await page.sleep(2);
        if (unwrapEvaluateResult(await page.evaluate(buildReadLikeStateJs(shouldLike))) === true) {
            return [{ status: shouldLike ? 'Liked' : 'Unliked', user: username, post: label }];
        }
        break;
    }
    throw new CommandExecutionError(
        `Instagram did not keep the ${shouldLike ? 'like' : 'unlike'} on ${post.code}`,
        'The action may have been rejected. Retry later, or check the post in the browser.',
    );
}

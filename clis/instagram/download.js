import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EXIT_CODES } from '@jackwener/opencli/errors';
import { httpDownload } from '@jackwener/opencli/download';
const INSTAGRAM_APP_ID = '936619743392459';
const INSTAGRAM_HOST_SUFFIX = 'instagram.com';
const INSTAGRAM_SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SUPPORTED_KINDS = new Set(['p', 'reel', 'tv']);
function displayPath(filePath) {
    const home = os.homedir();
    return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}
export function resolveOutputDir(value) {
    const raw = String(value || '').trim();
    if (!raw) return path.join(os.homedir(), 'Downloads', 'Instagram');
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return path.resolve(raw);
}
/** A shortcode is the media id written in Instagram's base64 alphabet. */
export function shortcodeToMediaId(shortcode) {
    const raw = String(shortcode || '');
    if (!raw) return '';
    let mediaId = 0n;
    for (const character of raw) {
        const digit = INSTAGRAM_SHORTCODE_ALPHABET.indexOf(character);
        if (digit < 0) return '';
        mediaId = mediaId * 64n + BigInt(digit);
    }
    return mediaId.toString();
}
export function parseInstagramMediaTarget(input) {
    const raw = String(input || '').trim();
    if (!raw) {
        throw new ArgumentError('Instagram URL is required', 'Expected https://www.instagram.com/p/... or https://www.instagram.com/reel/...');
    }
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new ArgumentError(`Invalid Instagram URL: ${raw}`, 'Expected https://www.instagram.com/p/<shortcode>/ or /reel/<shortcode>/');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new ArgumentError(`Unsupported URL protocol: ${url.protocol}`);
    }
    const host = url.hostname.toLowerCase();
    if (host !== INSTAGRAM_HOST_SUFFIX && !host.endsWith(`.${INSTAGRAM_HOST_SUFFIX}`)) {
        throw new ArgumentError(`Unsupported host: ${host}`, 'Only instagram.com URLs are supported');
    }
    const segments = url.pathname.split('/').filter(Boolean);
    let kind;
    let shortcode;
    if (segments.length >= 2 && SUPPORTED_KINDS.has(segments[0])) {
        kind = segments[0];
        shortcode = segments[1];
    }
    else if (segments.length >= 3 && SUPPORTED_KINDS.has(segments[1])) {
        kind = segments[1];
        shortcode = segments[2];
    }
    if (!kind || !shortcode) {
        throw new ArgumentError(`Unsupported Instagram media URL: ${raw}`, 'Only /p/<shortcode>/, /reel/<shortcode>/, and /tv/<shortcode>/ links are supported');
    }
    if (!shortcodeToMediaId(shortcode)) {
        throw new ArgumentError(`Invalid Instagram shortcode: ${shortcode}`, 'Copy the link straight from the post, without escaping it');
    }
    return {
        kind: kind,
        shortcode,
        canonicalUrl: `https://www.instagram.com/${kind}/${shortcode}/`,
    };
}
export function buildInstagramDownloadItems(shortcode, items) {
    return items
        .filter((item) => item?.url)
        .map((item, index) => {
        const fallbackExt = item.type === 'video' ? '.mp4' : '.jpg';
        let ext = fallbackExt;
        try {
            const pathname = new URL(item.url).pathname;
            const candidateExt = path.extname(pathname).toLowerCase();
            if (candidateExt && candidateExt.length <= 8)
                ext = candidateExt;
        }
        catch {
            ext = fallbackExt;
        }
        return {
            type: item.type,
            url: item.url,
            filename: `${shortcode}_${String(index + 1).padStart(2, '0')}${ext}`,
        };
    });
}
export function buildInstagramFetchScript(shortcode) {
    // The persisted GraphQL query this used to send now answers HTTP 200 with
    // an execution error and no media, which read as a private post (#2247).
    // The media info endpoint carries the same fields and needs no rotating id.
    return `
    (async () => {
      const shortcode = ${JSON.stringify(shortcode)};
      const mediaId = ${JSON.stringify(shortcodeToMediaId(shortcode))};
      const url = 'https://www.instagram.com/api/v1/media/' + mediaId + '/info/';
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json,text/plain,*/*',
          'X-IG-App-ID': ${JSON.stringify(INSTAGRAM_APP_ID)},
        },
      });
      const rawText = await res.text();

      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        return {
          ok: false,
          errorCode: 'COMMAND_EXEC',
          error: 'Instagram returned non-JSON content while fetching media metadata',
        };
      }

      const message = typeof data?.message === 'string' ? data.message : '';
      const lowered = (message || '').toLowerCase();

      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || data?.require_login) {
          return { ok: false, errorCode: 'AUTH_REQUIRED', error: message || ('HTTP ' + res.status) };
        }
        if (res.status === 429) {
          return { ok: false, errorCode: 'RATE_LIMITED', error: message || 'HTTP 429' };
        }
        if (res.status === 404 || res.status === 410 || data?.status === 'fail') {
          return { ok: false, errorCode: 'PRIVATE_OR_UNAVAILABLE', error: message || ('HTTP ' + res.status) };
        }
        return { ok: false, errorCode: 'COMMAND_EXEC', error: message || ('HTTP ' + res.status) };
      }

      if (data?.require_login) {
        return { ok: false, errorCode: 'AUTH_REQUIRED', error: message || 'Instagram login required' };
      }
      if (lowered.includes('wait a few minutes') || lowered.includes('rate')) {
        return { ok: false, errorCode: 'RATE_LIMITED', error: message || 'Instagram rate limit triggered' };
      }

      const media = Array.isArray(data?.items) ? data.items[0] : null;
      if (!media) {
        return {
          ok: false,
          errorCode: 'PRIVATE_OR_UNAVAILABLE',
          error: message || 'Post may be private, unavailable, or inaccessible to the current browser session',
        };
      }

      const nodes = Array.isArray(media?.carousel_media) && media.carousel_media.length > 0
        ? media.carousel_media
        : [media];

      // Candidate order is not guaranteed, so pick the widest rather than the
      // first, and keep the declared media_type: a video whose renditions are
      // missing must yield no url instead of falling back to its cover image.
      const widest = (candidates) => (Array.isArray(candidates) ? candidates : [])
        .reduce((best, candidate) => !best || (Number(candidate?.width) || 0) > (Number(best?.width) || 0) ? candidate : best, null);
      const pickUrl = (node) => node?.media_type === 2
        ? { type: 'video', url: String(widest(node?.video_versions)?.url || '') }
        : { type: 'image', url: String(widest(node?.image_versions2?.candidates)?.url || '') };

      const items = nodes.map(pickUrl).filter((item) => item.url);

      return {
        ok: true,
        shortcode: media.code || shortcode,
        owner: media?.user?.username || '',
        items,
      };
    })()
  `;
}
function ensurePage(page) {
    if (!page)
        throw new CommandExecutionError('Browser session required');
    return page;
}
function normalizeFetchResult(result) {
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError('Failed to fetch Instagram media metadata');
    }
    return result;
}
function handleFetchFailure(result) {
    const message = result.error || 'Instagram media fetch failed';
    if (result.errorCode === 'AUTH_REQUIRED') {
        throw new AuthRequiredError('instagram.com', message);
    }
    if (result.errorCode === 'RATE_LIMITED') {
        throw new CliError('RATE_LIMITED', message, 'Wait a few minutes and retry, or switch to a browser session with a warmer Instagram login state.', EXIT_CODES.TEMPFAIL);
    }
    if (result.errorCode === 'PRIVATE_OR_UNAVAILABLE') {
        throw new CommandExecutionError(message, 'Open the post in a logged-in browser session and retry');
    }
    throw new CommandExecutionError(message);
}
async function downloadInstagramMedia(items, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    for (const item of items) {
        const destPath = path.join(outputDir, item.filename);
        const result = await httpDownload(item.url, destPath, {
            timeout: item.type === 'video' ? 120000 : 60000,
        });
        if (!result.success) {
            throw new CommandExecutionError(`Failed to download ${item.filename}: ${result.error || 'unknown error'}`);
        }
    }
}
cli({
    site: 'instagram',
    name: 'download',
    access: 'read',
    description: 'Download images and videos from Instagram posts and reels',
    domain: 'www.instagram.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', positional: true, required: true, help: 'Instagram post / reel / tv URL' },
        { name: 'path', default: '~/Downloads/Instagram', help: 'Download directory' },
    ],
    func: async (page, kwargs) => {
        const browserPage = ensurePage(page);
        const target = parseInstagramMediaTarget(String(kwargs.url ?? ''));
        const outputRoot = resolveOutputDir(kwargs.path);
        await browserPage.goto(target.canonicalUrl);
        const fetchResult = normalizeFetchResult(await browserPage.evaluate(buildInstagramFetchScript(target.shortcode)));
        if (!fetchResult.ok)
            handleFetchFailure(fetchResult);
        const shortcode = fetchResult.shortcode || target.shortcode;
        const mediaItems = buildInstagramDownloadItems(shortcode, fetchResult.items || []);
        if (mediaItems.length === 0) {
            throw new CommandExecutionError('No downloadable media found');
        }
        const savedDir = path.join(outputRoot, shortcode);
        await downloadInstagramMedia(mediaItems, savedDir);
        console.log(`📁 saved: ${displayPath(savedDir)}`);
        return null;
    },
});

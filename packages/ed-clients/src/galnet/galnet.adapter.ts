/**
 * GalNet — Frontier's in-universe news feed.
 *
 * Read from `cms.zaonce.net`, the Drupal CMS that actually backs GalNet, rather
 * than scraping the community site's HTML. The JSON:API gives titles, publish
 * dates and the guid that forms the article URL, and it will not break the next
 * time Frontier restyles a page.
 *
 * Note the two dates: `published_at` is real-world, `field_galnet_date` is the
 * in-universe one ("23 JUL 3312"). Both are carried, because the in-universe
 * date is the one an Elite player recognises and the real one is what we sort by.
 */

export interface GalnetArticle {
  readonly id: string;
  readonly title: string;
  /** Real-world ISO timestamp. */
  readonly publishedAt: string;
  /** In-universe date as Frontier writes it, e.g. "23 JUL 3312". */
  readonly gameDate: string;
  readonly url: string;
}

export interface IGalnetClient {
  latest(limit: number): Promise<readonly GalnetArticle[]>;
}

const CMS = 'https://cms.zaonce.net/en-GB/jsonapi/node/galnet_article';
const ARTICLE = 'https://community.elitedangerous.com/galnet/uid';
const TIMEOUT_MS = 8_000;

interface CmsNode {
  id?: string;
  attributes?: {
    title?: string;
    published_at?: string;
    field_galnet_date?: string;
    field_galnet_guid?: string;
  };
}

export class GalnetAdapter implements IGalnetClient {
  constructor(private readonly timeoutMs: number = TIMEOUT_MS) {}

  async latest(limit = 12): Promise<readonly GalnetArticle[]> {
    const url = `${CMS}?page%5Blimit%5D=${limit}&sort=-published_at`;

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          accept: 'application/vnd.api+json',
          'user-agent': 'GrimsSquadHub/1.0 (+https://grims-squad.com)',
        },
        // Cached for an hour. GalNet publishes a few times a week, so polling
        // harder would be rude to Frontier and would change nothing on screen.
        next: { revalidate: 3600 },
      } as RequestInit);
      if (!res.ok) return [];

      const body = (await res.json()) as { data?: CmsNode[] };
      return (body.data ?? [])
        .map((n) => {
          const a = n.attributes ?? {};
          const guid = a.field_galnet_guid;
          if (typeof a.title !== 'string' || typeof guid !== 'string') return null;
          return {
            id: guid,
            title: a.title,
            publishedAt: a.published_at ?? '',
            gameDate: a.field_galnet_date ?? '',
            url: `${ARTICLE}/${guid}`,
          } satisfies GalnetArticle;
        })
        .filter((x): x is GalnetArticle => x !== null);
    } catch {
      // An empty list, never a throw. GalNet is decoration on the landing page;
      // Frontier's CMS having a bad day must not take our homepage down with it.
      return [];
    } finally {
      clearTimeout(t);
    }
  }
}

/** Deterministic client for tests. Titles are obviously fictional on purpose. */
export class GalnetFake implements IGalnetClient {
  constructor(private readonly articles: readonly GalnetArticle[] = FAKE) {}
  async latest(limit = 12): Promise<readonly GalnetArticle[]> {
    return this.articles.slice(0, limit);
  }
}

const FAKE: readonly GalnetArticle[] = [
  {
    id: 'fake-1',
    title: 'Test Article Alpha',
    publishedAt: '3312-07-23T14:00:00.000Z',
    gameDate: '23 JUL 3312',
    url: 'https://community.elitedangerous.com/galnet/uid/fake-1',
  },
  {
    id: 'fake-2',
    title: 'Test Article Beta',
    publishedAt: '3312-07-16T14:00:00.000Z',
    gameDate: '16 JUL 3312',
    url: 'https://community.elitedangerous.com/galnet/uid/fake-2',
  },
];

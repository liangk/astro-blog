import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

export async function GET(context) {
	const posts = (await getCollection('blog')).sort((a, b) => {
		const dateDiff = (b.data.pubDate?.valueOf() ?? 0) - (a.data.pubDate?.valueOf() ?? 0);
		if (dateDiff !== 0) return dateDiff;

		const seriesA = a.data.series_order ?? Number.POSITIVE_INFINITY;
		const seriesB = b.data.series_order ?? Number.POSITIVE_INFINITY;
		if (seriesA !== seriesB) return seriesA - seriesB;

		return a.data.title.localeCompare(b.data.title);
	});
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: posts.map((post) => ({
			...post.data,
			link: `/blog/${post.id}/`,
		})),
	});
}

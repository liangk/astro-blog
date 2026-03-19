import { getCollection, type CollectionEntry } from 'astro:content';

export const BLOG_POSTS_PER_PAGE = 10;

export type BlogPost = CollectionEntry<'blog'>;

export const sortBlogPosts = (posts: BlogPost[]) => [...posts].sort((a, b) => {
	const dateDiff = (b.data.pubDate?.valueOf() ?? 0) - (a.data.pubDate?.valueOf() ?? 0);
	if (dateDiff !== 0) return dateDiff;

	const seriesA = Number(a.data.series_order ?? Number.POSITIVE_INFINITY);
	const seriesB = Number(b.data.series_order ?? Number.POSITIVE_INFINITY);
	if (seriesA !== seriesB) return seriesA - seriesB;

	return a.data.title.localeCompare(b.data.title);
});

export const getAllBlogPosts = async () => {
	return sortBlogPosts(await getCollection('blog'));
};

export const getBlogPageData = async (page = 1, pageSize = BLOG_POSTS_PER_PAGE) => {
	const posts = await getAllBlogPosts();
	const totalPages = Math.max(1, Math.ceil(posts.length / pageSize));
	const currentPage = Math.min(Math.max(page, 1), totalPages);
	const start = (currentPage - 1) * pageSize;

	return {
		currentPage,
		pageSize,
		posts: posts.slice(start, start + pageSize),
		allPosts: posts,
		totalPages,
		totalPosts: posts.length,
	};
};

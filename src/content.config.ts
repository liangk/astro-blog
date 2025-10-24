import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date().optional(),
			updatedDate: z.coerce.date().optional(),
			heroImage: image().optional(),
			repo: z.string().optional(),
		}).passthrough(),
});

const docs = defineCollection({
	loader: glob({ base: './src/content/docs-lite', pattern: '**/*.md' }),
	schema: ({ image }) =>
		z.object({
			title: z.string().optional(),
			description: z.string().optional(),
			section: z.string().optional(),
			order: z.number().optional(),
		}).passthrough(),
});

export const collections = { blog, docs };

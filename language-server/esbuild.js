const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build language-server started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build language-server finished');
		});
	},
};

async function main() {
	if (!watch) {
		for (const obsolete of ['api-query-index.js', 'api-query-index.js.map'])
			fs.rmSync(path.join('dist', obsolete), { force: true });
	}
	const ctx = await esbuild.context({
		entryPoints: {
			server: 'src/server.ts',
			'debug-database-cache-worker': 'src/debugDatabaseCacheWorker.ts',
		},
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		banner: {
			js: '#!/usr/bin/env node',
		},
		outdir: 'dist',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});

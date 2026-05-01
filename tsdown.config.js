import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ["./src/main.mjs"],
	outDir: "dist",
	outputOptions: {
		entryFileNames: "module.js"
	},
	platform: "browser",
	minify: true,
	sourcemap: true,
	deps: {
		onlyBundle: false,
		alwaysBundle: () => true
	},
	css: {
		fileName: "module.css",
		minify: true
	},
	checks: {
		circularDependency: true,
	}
});

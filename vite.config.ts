import { defineConfig } from 'vite'

/**
 * Library build (design §10.3's SDK). Two outputs because integrators arrive
 * two ways: bundlers take the ESM entry, and a `<script>` tag on a page with no
 * build step takes the UMD one and finds `window.GingerDocsEmbed`.
 *
 * `emptyOutDir: false` because `tsc -p tsconfig.build.json` writes the type
 * declarations into the same folder first, and Vite would otherwise delete them
 * on its way in.
 */
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      name: 'GingerDocsEmbed',
      formats: ['es', 'umd'],
      fileName: format => `gingerdocs-embed.${format === 'umd' ? 'umd.cjs' : 'js'}`,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})

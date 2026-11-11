import { mergeConfig } from 'vite'
import config from '../vite.config.ts'
// Isolated runners must not reload halfway through assertions when files change.
export default mergeConfig(config, { cacheDir: `node_modules/.tmp/vite-suite-${process.pid}`, server: { hmr: false, watch: null } })

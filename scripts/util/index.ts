import env from './env'
import { resolveRoot } from './resolve'
import { homedir } from 'node:os'
import path from 'node:path'

export const ROOT = resolveRoot()
export const OUTPUT = env.static('SCHOLAR_PLUGIN_OUT', {
    default: env.dynamic({
        win32: path.join(homedir(), 'Documents', 'Cowork', 'System'),
        default: path.join(ROOT, 'out'),
    }),
})
export const FIXTURE = env.flag('SCHOLAR_BUILD_FIXTURE')
export const COMPILE = env.flag('SCHOLAR_BUILD_VEC_FORCE_COMPILE')

export function noop() {}

const createHook =
    (condition: boolean) =>
    async <F extends () => unknown = () => unknown>(
        callback: F,
        options?: { default?: F }
    ): Promise<Awaited<ReturnType<F>>> =>
        (condition
            ? await callback()
            : options?.default && (await options.default())) as Awaited<ReturnType<F>>

export default {
    noop,
    sh: (
        array: TemplateStringsArray,
        ...expressions: Bun.ShellExpression[]
    ): Bun.$.ShellPromise => Bun.$(array, ...expressions).cwd(ROOT),
    subpath(...segments: string[]) {
        return path.join(ROOT, ...segments)
    },
    abort(code: string, message: string): never {
        process.stderr.write(`${code}: ${message}\n`)
        process.exit(1)
    },
    onfixture: createHook(FIXTURE),
    oncompile: createHook(COMPILE),
}

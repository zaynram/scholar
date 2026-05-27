interface EnvOptions {
  default?: string
}
type EnvReturn<C extends EnvOptions> = C extends {
  default: string
}
  ? string
  : string | void

export default {
  dynamic<
    TConfig extends Partial<Record<typeof process.platform, string>> &
      EnvOptions,
  >(config: TConfig): EnvReturn<typeof config> {
    const key = [process.platform, "default"].find((x) => x in config)
    if (!key) throw Error(`unsupported platform: ${process.platform}`)
    return config[key as keyof typeof config] as EnvReturn<typeof config>
  },
  flag(key: string) {
    return this.static(key, { default: "0" }) === "1"
  },
  static<TOptions extends EnvOptions>(
    key: string,
    options: TOptions = {} as TOptions,
  ): EnvReturn<typeof options> {
    const value = process.env[key] ?? options.default
    return (typeof value === "string" ? value.trim() : value) as EnvReturn<
      typeof options
    >
  },
}

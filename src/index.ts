import { Context, deduplicate, noop, Schema, Session } from 'koishi'
import zhCN from './locales/zh-CN.yml'
import {} from '@koishijs/plugin-admin'

declare module 'koishi' {
  namespace Command {
    interface Config {
      userCall?: 'enabled' | 'disabled' | 'aliasOnly' | 'aliasOrAppel'
    }
  }

  interface Channel {
    enable: string[]
    disable: string[]
  }
}

export interface Config {
  mutuallyExclusiveGroups?: string[][]
}

export const name = 'switch'
export const using = ['database'] as const
export const Config: Schema<Config> = Schema.object({
  mutuallyExclusiveGroups: Schema.array(Schema.array(Schema.string()).role('table')).default([]).description('互斥组'),
})

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh', zhCN)

  ctx.schema.extend('command', Schema.object({
    userCall: /* Schema.computed( */
      Schema.union([
        Schema.const('enabled').description('允许用户调用'),
        Schema.const('disabled').description('禁止用户调用'),
        Schema.const('aliasOnly').description('仅允许用户使用别名调用'),
        Schema.const('aliasOrAppel').description('允许用户使用别名或称呼调用'),
      ]).role('radio').default('enabled')/* ,
    ) */.description('默认用户调用方式。'),
  }), 900)

  ctx.model.extend('channel', {
    enable: 'list',
    disable: 'list',
  })

  ctx.permissions.define('command:(value)', {
    depends: ({ value }) => [`switch:${value}`],
  })

  ctx.permissions.provide('switch:(value)', ({ value }, session: Partial<Session<any, 'enable' | 'disable'>>) => {
    if (session.isDirect) return true
    let command = ctx.$commander.get(value)
    // ignore normal command execution
    if (!command || command?.name === session.argv?.command?.name) return true
    const { enable = [], disable = [] } = session.channel || {}
    while (command) {
      if (command.config.userCall === 'disabled') {
        if (!enable.includes(command.name)) return false
      } else if (disable.includes(command.name)) {
        return false
      }
      command = command.parent
    }
    return true
  })

  ctx.before('attach-channel', (session, fields) => {
    if (!session.argv) return
    fields.add('enable')
    fields.add('disable')
  })

  ctx.on('attach', (session: Session<never, 'enable' | 'disable'>) => {
    if (session.isDirect) return
    let command = session.argv?.command
    const { enable = [], disable = [] } = session.channel || {}
    while (command) {
      if (command.config.userCall === 'disabled') {
        if (!enable.includes(command.name)) session.response = noop
        return
      } else if (disable.includes(command.name)) {
        session.response = noop
        return
      } else if (command.config.userCall === 'aliasOnly') {
        const [name] = session.stripped.content.toLowerCase().slice(session.stripped.prefix.length).split(' ', 1)
        if (name === command.name) session.response = noop
      } else if (command.config.userCall === 'aliasOrAppel') {
        const [name] = session.stripped.content.toLowerCase().slice(session.stripped.prefix.length).split(' ', 1)
        if (name === command.name && !session.stripped.appel) session.response = noop
      }
      command = command.parent
    }
  })

  ctx.command('switch <...command>', '启用和禁用功能', { authority: 3, admin: { channel: true } })
    .channelFields(['enable', 'disable'])
    .userFields(['authority'])
    .option('enable', '-e')
    .option('disable', '-d')
    .option('reset', '-r')
    .option('resetAll', '-R')
    .action(async ({ session, options }, ...names: string[]) => {
      const channel = session.channel
      if (+!!options.enable + +!!options.disable + +!!options.reset + +!!options.resetAll > 1) return session.text('.conflict')

      if (!names.length) {
        if (options.resetAll) {
          channel.enable = []
          channel.disable = []
          await channel.$update()
          return session.text('.reset')
        }

        const output = []
        if (!options.disable && channel.enable.length) output.push(session.text('.list-enabled', [channel.enable.join(', ')]))
        if (!options.enable && channel.disable.length) output.push(session.text('.list-disabled', [channel.disable.join(', ')]))
        if (options.reset && output.length) output.push(session.text('.reset-ready'))
        return output.length ? output.join('\n') : session.text('.none')
      }

      const candidates: [string, boolean | undefined][] = deduplicate(names).map(x => [x, undefined])
      const isEnabled = (name: string, initial: boolean) => {
        if (initial) return !channel.disable.includes(name)
        else return channel.enable.includes(name)
      }

      const forbidden = [], enable = [], disable = []
      const enableMap = Object.fromEntries(channel.enable.map((name) => [name, true]))
      const disableMap = Object.fromEntries(channel.disable.map((name) => [name, true]))

      for (let i = 0; i < candidates.length; i++) {
        const [name, pref] = candidates[i]
        const command = ctx.$commander.get(name)
        if (!command || session.resolve(command.config.authority) >= session.user.authority) {
          forbidden.push(name)
          break
        }

        const initial = command.config.userCall !== 'disabled'
        const current = isEnabled(name, initial)
        if (options.reset) {
          if (current !== initial) (initial ? enable : disable).push(name)
          enableMap[name] = false
          disableMap[name] = false
        } else if (options.enable || pref === true) {
          if (disableMap[name] || (!enableMap[name] && !initial)) {
            enable.push(name)
            config.mutuallyExclusiveGroups
              ?.find(group => group?.includes(name))
              ?.forEach(x => x !== name && !candidates.find(([y]) => x === y) && candidates.push([x, false]))
          }
          enableMap[name] = !initial
          disableMap[name] = false
        } else if (options.disable || pref === false) {
          if (enableMap[name] || (!disableMap[name] && initial)) disable.push(name)
          enableMap[name] = false
          disableMap[name] = initial
        } else {
          if (!current && (disableMap[name] || (!enableMap[name] && !initial))) {
            enable.push(name)
            config.mutuallyExclusiveGroups
              ?.find(group => group?.includes(name))
              ?.forEach(x => x !== name && !candidates.find(([y]) => x === y) && candidates.push([x, false]))
          }
          if (current && (enableMap[name] || (!disableMap[name] && initial))) disable.push(name)
          enableMap[name] = current ? false : !initial
          disableMap[name] = current ? initial : false
        }
      }

      const comma = session.text('general.comma')
      if (forbidden.length) return session.text('.forbidden', [forbidden.join(comma)])
      if (!enable.length && !disable.length) return session.text('.unchanged')

      channel.enable = Object.keys(enableMap).filter((name) => enableMap[name])
      channel.disable = Object.keys(disableMap).filter((name) => disableMap[name])
      await channel.$update()

      const output: string[] = []
      if (enable.length) output.push(session.text('.enabled', [enable.join(comma)]))
      if (disable.length) output.push(session.text('.disabled', [disable.join(comma)]))
      return session.text('.output', [output.join(comma)])
    })
}

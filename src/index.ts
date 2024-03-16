import { Context, deduplicate, noop, Schema, Session } from 'koishi'
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

export interface Config {}

export const name = 'switch'
export const using = ['database'] as const
export const Config: Schema<Config> = Schema.object({})

export function apply(ctx: Context, config: Config = {}) {
  ctx.i18n.define('zh', require('./locales/zh-CN'))

  ctx.schema.extend('command', Schema.object({
    userCall: Schema.union([
      Schema.const('enabled').description('允许用户调用'),
      Schema.const('disabled').description('禁止用户调用'),
      Schema.const('aliasOnly').description('仅允许用户使用别名调用'),
      Schema.const('aliasOrAppel').description('允许用户使用别名或称呼调用'),
    ]).role('radio').description('默认用户调用方式。').default('enabled'),
  }), 900)

  ctx.model.extend('channel', {
    enable: 'list',
    disable: 'list',
  })

  ctx.before('attach-channel', (session, fields) => {
    if (!session.argv) return
    fields.add('enable')
    fields.add('disable')
  })

  // check channel
  ctx.on('attach', (session: Session<never, 'enable' | 'disable'>) => {
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
        return
      } else if (command.config.userCall === 'aliasOrAppel') {
        const [name] = session.stripped.content.toLowerCase().slice(session.stripped.prefix.length).split(' ', 1)
        if (name === command.name && !session.stripped.appel) session.response = noop
        return
      }
      command = command.parent as any
    }
  })

  ctx.command('switch <command...>', '启用和禁用功能', { authority: 3, admin: { channel: true } })
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

      names = deduplicate(names)
      const isEnabled = (name, initial) => {
        if (initial) return !channel.disable.includes(name)
        else return channel.enable.includes(name)
      }

      const forbidden = [], enable = [], disable = []
      const enableMap = Object.fromEntries(channel.enable.map((name) => [name, true]))
      const disableMap = Object.fromEntries(channel.disable.map((name) => [name, true]))

      names.forEach((name) => {
        const command = ctx.$commander.get(name)
        if (!command || session.resolve(command.config.authority) >= session.user.authority) {
          forbidden.push(name)
          return
        }

        const initial = command.config.userCall !== 'disabled'
        const current = isEnabled(name, initial)
        if (options.reset) {
          if (current !== initial) (initial ? enable : disable).push(name)
          enableMap[name] = false
          disableMap[name] = false
        } else if (options.enable) {
          if (disableMap[name] || (!enableMap[name] && !initial)) enable.push(name)
          enableMap[name] = !initial
          disableMap[name] = false
        } else if (options.disable) {
          if (enableMap[name] || (!disableMap[name] && initial)) disable.push(name)
          enableMap[name] = false
          disableMap[name] = initial
        } else {
          if (!current && (disableMap[name] || (!enableMap[name] && !initial))) enable.push(name)
          if (current && (enableMap[name] || (!disableMap[name] && initial))) disable.push(name)
          enableMap[name] = current ? false : !initial
          disableMap[name] = current ? initial : false
        }
      })

      if (forbidden.length) return session.text('.forbidden', [forbidden.join(', ')])
      if (!enable.length && !disable.length) return session.text('.unchanged')

      channel.enable = Object.keys(enableMap).filter((name) => enableMap[name])
      channel.disable = Object.keys(disableMap).filter((name) => disableMap[name])

      const output: string[] = []
      if (enable.length) output.push(session.text('.enabled', [enable.join(', ')]))
      if (disable.length) output.push(session.text('.disabled', [disable.join(', ')]))
      await channel.$update()
      return session.text('.output', [output.join('，')])
    })
}

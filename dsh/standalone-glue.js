import React from 'react'
import { ResearchSessionOverview } from '../src/research-project-home.js'
import { ResearchConsole } from '../src/research-console.js'
import { ResearchComposerLauncher } from '../src/composer-launcher.js'
import { ResearchComposerOverlay } from '../src/composer-overlay.js'
import { ResearchDraftEnhancerHost, recordPromptKitLoadError } from './prompt-enhancer-glue.js'
import { ensureResearchProviders } from './prompt-studio-glue.js'
import { loadPromptKit } from '../src/promptkit-loader.js'
import { registerResearchSlots } from './slot-registry.js'
import { registerDepositionSessions } from '../src/knowledge-deposition.js'
import { ResearchPluginStatusSection, ResearchKitBadge, ResearchKitDiagnosticsAction, ResearchKitOpenWorkbenchAction, ResearchKitPresetConfig, RESEARCH_KIT_CONSOLE_VIEW } from '../src/plugin-status.js'
import { ResearchToolView, researchToolNames } from '../src/research-toolview.js'
import { ResearchMessageDepositAction } from '../src/message-deposit-action.js'
import { currentMainSessionId, insertResearchMaterial, launchResearchSession, researchMaterialInput, returnToConversation, supportsSessionLaunch } from '../src/lib/host-navigation.js'

function ResearchSidebarIcon({ size = 16 } = {}) {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': 'true',
    stroke: 'currentColor',
    strokeWidth: '1.4',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }, [
    React.createElement('path', { key: 'neck', d: 'M6 2.25h4' }),
    React.createElement('path', { key: 'body', d: 'M6.75 2.25v3.4L3.4 11.45A1.5 1.5 0 0 0 4.7 13.7h6.6a1.5 1.5 0 0 0 1.3-2.25L9.25 5.65v-3.4' }),
    React.createElement('path', { key: 'liquid', d: 'M4.9 10.2h6.2' }),
  ])
}

export function researchKitApply(ctx) {
  const hostNavigation = {
    uiWorkspace: ctx.get?.('uiWorkspace'),
    uiConversation: ctx.get?.('uiConversation'),
    conversation: ctx.get?.('conversation'),
    sessions: ctx.sessions,
  }
  const openConversation = typeof hostNavigation.uiWorkspace?.openSession === 'function'
    ? () => returnToConversation({ ...hostNavigation, view: RESEARCH_KIT_CONSOLE_VIEW })
    : null
  const launchSession = supportsSessionLaunch(hostNavigation)
    ? input => launchResearchSession(hostNavigation, input)
    : null
  function ResearchConsoleHost(props) {
    const insertMaterialReference = researchMaterialInput(hostNavigation, props.sessionId)
      ? path => insertResearchMaterial(hostNavigation, props.sessionId, path) : null
    return React.createElement(ResearchConsole, { ...props, launchSession, insertMaterialReference })
  }
  function ResearchSidebarConsoleHost() {
    const [activeSessionId, setActiveSessionId] = React.useState(() => currentMainSessionId(ctx.sessions))
    React.useEffect(() => {
      const sync = () => setActiveSessionId(currentMainSessionId(ctx.sessions))
      sync()
      const unsubscribe = ctx.sessions?.list?.subscribe?.(sync)
      return () => { if (typeof unsubscribe === 'function') unsubscribe() }
    }, [])
    const insertMaterialReference = researchMaterialInput(hostNavigation, activeSessionId)
      ? path => insertResearchMaterial(hostNavigation, activeSessionId, path) : null
    return React.createElement('div', { className: 'rk-sidebar-main-shell' },
      React.createElement(ResearchConsole, { sessionId: activeSessionId, launchSession, insertMaterialReference }))
  }
  function ResearchComposerOverlayHost(props) {
    return React.createElement(ResearchComposerOverlay, { ...props, sessions: ctx.sessions })
  }
  const components = [
    ResearchConsoleHost,        // dsh-research-kit-console
    ResearchComposerLauncher,   // dsh-research-kit-launcher
    ResearchComposerOverlayHost, // dsh-research-kit-overlay
    ResearchDraftEnhancerHost   // dsh-research-kit-draft-enhancer（prompt-enhancer-glue.js）
  ]
  const disposers = [registerResearchSlots(ctx, components)]
  disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: RESEARCH_KIT_CONSOLE_VIEW,
  }, ResearchSidebarConsoleHost)))
  disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: RESEARCH_KIT_CONSOLE_VIEW,
    order: 25,
    label: () => '科研工作台',
  }, ResearchSidebarIcon)))
  disposers.push(ctx.slots.inject('conversation.session.panel.section', () => ctx.slots.register({
    name: 'conversation.session.panel.section',
    id: 'dsh-research-kit-project', label: '科研项目', order: 90,
  }, ResearchSessionOverview)))
  disposers.push(ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section',
    id: 'dsh-research-kit-status',
  }, ResearchPluginStatusSection)))
  disposers.push(ctx.slots.inject('plugins.detail.badge', () => ctx.slots.register({
    name: 'plugins.detail.badge',
    id: 'dsh-research-kit-badge',
  }, ResearchKitBadge)))
  disposers.push(ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions',
    id: 'dsh-research-kit-diagnostics',
  }, ResearchKitDiagnosticsAction)))
  disposers.push(ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions',
    id: 'dsh-research-kit-open-workbench',
  }, props => React.createElement(ResearchKitOpenWorkbenchAction, { ...props, open: openConversation }))))
  disposers.push(ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config', key: 'dsh-research-kit#dsh-research-kit',
  }, ResearchKitPresetConfig)))
  disposers.push(ctx.slots.inject('tool.call.toolview', () => {
    const toolDisposers = researchToolNames.map(key => ctx.slots.register({ name: 'tool.call.toolview', key }, ResearchToolView))
    return () => toolDisposers.forEach(dispose => dispose?.())
  }))
  const resolveDepositProvider = async () => {
    try {
      const PromptKit = await loadPromptKit()
      recordPromptKitLoadError(null)
      return ensureResearchProviders(PromptKit).researchAssetProvider
    } catch (error) { recordPromptKitLoadError(error); throw error }
  }
  const depositAssetProvider = {
    list: async () => (await resolveDepositProvider()).list(),
    save: async input => (await resolveDepositProvider()).save(input),
  }
  disposers.push(ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'dsh-research-kit-review-deposit', order: 90,
  }, props => React.createElement(ResearchMessageDepositAction, {
    ...props, sessions: ctx.sessions, assetProvider: () => depositAssetProvider,
  }))))
  registerDepositionSessions(ctx.sessions)
  disposers.push(() => registerDepositionSessions(null))
  return () => disposers.forEach(dispose => dispose?.())
}

import { useTranslation } from '../../i18n'

const SETTING_HELP_TOPICS = [
  'treeAnimation', 'moodAnimation', 'liveMarkdown', 'noteCodeWrap',
  'plantumlMode', 'plantumlPort', 'plantumlRemote', 'namingTemplates',
  'workflowPresets', 'workflowOutputs', 'workflowContent', 'workflowNameRules',
  'agentService', 'agentCapability'
] as const

export type SettingHelpTopic = typeof SETTING_HELP_TOPICS[number]

export default function SettingHelp({ topic }: { topic: SettingHelpTopic }): React.JSX.Element {
  const { t } = useTranslation()
  const fields = ['feature', 'purpose', 'audience', 'effect'] as const

  return <details className="setting-help" data-setting-help={topic}>
    <summary>{t('settingsHelp.toggle')}</summary>
    <dl>
      {fields.map((field) => <div key={field}>
        <dt>{t(`settingsHelp.${field}`)}</dt>
        <dd>{t(`settingsHelp.topics.${topic}.${field}`)}</dd>
      </div>)}
    </dl>
  </details>
}

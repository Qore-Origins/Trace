import { useEffect, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import type { AgentProfile, AgentProfileInput, AgentProfileList, AgentProviderPreset } from '@shared/agent-types'
import { invoke } from '../ipc-client'
import { getMessage, getModal } from '../antd-host'
import { useTranslation } from '../i18n'

const EMPTY_LIST: AgentProfileList = { profiles: [], defaultProfileId: null }
const EMPTY_DRAFT: AgentProfileInput = { name: '', endpoint: '', model: '', presetId: null }

export default function AgentSettingsSection({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const generation = useRef(0)
  const [list, setList] = useState<AgentProfileList>(EMPTY_LIST)
  const [providers, setProviders] = useState<readonly AgentProviderPreset[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<AgentProfileInput>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const current = list.profiles.find((profile) => profile.id === selectedId)

  const selectProfile = (profile?: AgentProfile): void => {
    setKeyDraft('')
    setSelectedId(profile?.id ?? '')
    setDraft(profile ? { name: profile.name, endpoint: profile.endpoint, model: profile.model, presetId: profile.presetId } : { ...EMPTY_DRAFT })
  }
  useEffect(() => {
    const token = ++generation.current
    setError(false); setBusy(false); setList(EMPTY_LIST); selectProfile()
    if (!active) { setLoading(false); return }
    setLoading(true)
    void Promise.all([invoke('agent:provider:list'), invoke('agent:profile:list')]).then(([catalog, profiles]) => {
      if (generation.current !== token) return
      setProviders(catalog); setList(profiles)
      selectProfile(profiles.profiles.find((profile) => profile.id === profiles.defaultProfileId))
    }).catch(() => { if (generation.current === token) setError(true) }).finally(() => { if (generation.current === token) setLoading(false) })
    return () => { generation.current += 1 }
  }, [active])

  const operate = async (operation: (token: number) => Promise<void>): Promise<void> => {
    const token = generation.current
    if (!active || busy || loading) return
    setBusy(true); setError(false)
    try { await operation(token) } catch { if (generation.current === token) { setError(true); getMessage().error(t('agentSettings.operationFailed')) } }
    finally { if (generation.current === token) setBusy(false) }
  }
  const refresh = async (preferredId: string, token: number, preserveDraft = false): Promise<void> => {
    if (generation.current !== token) return
    const profiles = await invoke('agent:profile:list')
    if (generation.current !== token) return
    setList(profiles)
    if (preserveDraft && profiles.profiles.some((profile) => profile.id === preferredId)) return
    selectProfile(profiles.profiles.find((profile) => profile.id === preferredId) ?? profiles.profiles.find((profile) => profile.id === profiles.defaultProfileId))
  }
  const save = (): void => { void operate(async (token) => {
    const saved = selectedId ? await invoke('agent:profile:update', { ...draft, id: selectedId }) : await invoke('agent:profile:create', draft)
    await refresh(saved.id, token)
  }) }
  const remove = (): void => {
    const id = selectedId, token = generation.current
    getModal().confirm({ title: t('agentSettings.deleteTitle'), content: t('agentSettings.deleteWarning'), okText: t('common.delete'), cancelText: t('common.cancel'), onOk: async () => {
      if (generation.current !== token) return
      await operate(async (currentToken) => { await invoke('agent:profile:delete', { id }); await refresh('', currentToken) })
    } })
  }
  const saveKey = (): void => {
    const key = keyDraft
    setKeyDraft('')
    void operate(async (token) => { await invoke('agent:key:set', { id: selectedId, key }); await refresh(selectedId, token, true) })
  }
  const testCapability = (): void => {
    const id = selectedId, token = generation.current
    getModal().confirm({ title: t('agentSettings.testTitle'), content: t('agentSettings.testWarning'), okText: t('agentSettings.startTest'), cancelText: t('common.cancel'), onOk: async () => {
      if (generation.current !== token) return
      await operate(async (currentToken) => { await invoke('agent:capability:test', { id }); await refresh(id, currentToken) })
    } })
  }
  const savedConfiguration = Boolean(current && draft.endpoint === current.endpoint && draft.model === current.model && draft.name === current.name && draft.presetId === current.presetId)
  const safeCategory = current?.capability.errorCategory
  const knownCategories = ['missing-key', 'unsupported', 'authentication', 'http', 'protocol', 'limit', 'timeout', 'network', 'validation', 'cancelled', 'internal']
  if (!active) return <></>
  return <section className="agent-settings" aria-label={t('agentSettings.title')}>
    <p className="agent-settings-hint">{t('agentSettings.description')}</p>
    {loading && <div role="status">{t('common.loading')}</div>}
    {error && <div role="alert">{t('agentSettings.operationFailed')}</div>}
    <fieldset disabled={loading || busy}>
      <label>{t('agentSettings.profiles')}<select aria-label={t('agentSettings.profiles')} value={selectedId} onChange={(event) => selectProfile(list.profiles.find((profile) => profile.id === event.target.value))}>
        <option value="">{t('agentSettings.newProfile')}</option>
        {list.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.id === list.defaultProfileId ? ` (${t('agentSettings.default')})` : ''}</option>)}
      </select></label>
      <Button onClick={() => selectProfile()}>{t('agentSettings.newProfile')}</Button>
      <label>{t('agentSettings.preset')}<select aria-label={t('agentSettings.preset')} value={draft.presetId ?? ''} onChange={(event) => {
        const preset = providers.find((provider) => provider.id === event.target.value)
        setDraft(preset ? { name: preset.name, endpoint: preset.endpoint, model: preset.model, presetId: preset.id } : { ...EMPTY_DRAFT })
      }}>
        <option value="">{t('agentSettings.custom')}</option>
        {(['direct', 'aggregator'] as const).map((category) => <optgroup key={category} label={t(`agentSettings.${category}`)}>
          {providers.filter((provider) => provider.category === category).map((provider) => <option key={provider.id} value={provider.id}>{t(`agentSettings.providers.${provider.id}`)}</option>)}
        </optgroup>)}
      </select></label>
      <span className="agent-settings-hint">{t('agentSettings.protocol')}</span>
      <label>{t('agentSettings.name')}<Input aria-label={t('agentSettings.name')} value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>{t('agentSettings.endpoint')}<Input aria-label={t('agentSettings.endpoint')} value={draft.endpoint} maxLength={2048} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} /></label>
      <label>{t('agentSettings.model')}<Input aria-label={t('agentSettings.model')} value={draft.model} maxLength={160} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
      <div className="agent-settings-actions">
        <Button onClick={save} disabled={!draft.name.trim() || !draft.endpoint.trim() || !draft.model.trim()}>{t('agentSettings.save')}</Button>
        <Button disabled={!current || list.defaultProfileId === selectedId} onClick={() => { void operate(async (token) => { await invoke('agent:profile:setDefault', { id: selectedId }); await refresh(selectedId, token, true) }) }}>{t('agentSettings.setDefault')}</Button>
        <Button danger disabled={!current} onClick={remove}>{t('agentSettings.delete')}</Button>
      </div>
      {current && <>
        <div role="status">{t(`agentSettings.keyStatus.${current.keyStatus}`)}</div>
        <label>API Key<Input type="password" aria-label="API Key" autoComplete="new-password" value={keyDraft} maxLength={4096} onChange={(event) => setKeyDraft(event.target.value)} /></label>
        <p className="agent-settings-hint">{t('agentSettings.keyHint')}</p>
        <div className="agent-settings-actions">
          <Button disabled={!keyDraft.trim()} onClick={saveKey}>{t('agentSettings.saveKey')}</Button>
          <Button disabled={current.keyStatus === 'missing'} onClick={() => { setKeyDraft(''); void operate(async (token) => { await invoke('agent:key:remove', { id: selectedId }); await refresh(selectedId, token, true) }) }}>{t('agentSettings.removeKey')}</Button>
        </div>
        <div role="status">{t(`agentSettings.capability.${current.capability.status}`)}
          {current.capability.testedAt && <time dateTime={current.capability.testedAt}> · {t('agentSettings.testedAt')}: {new Date(current.capability.testedAt).toLocaleString(i18n.language)}</time>}
          {safeCategory && <span> · {t(`agentSettings.errors.${knownCategories.includes(safeCategory) ? safeCategory : 'internal'}`)}</span>}
        </div>
        <Button disabled={!savedConfiguration} onClick={testCapability}>{t('agentSettings.test')}</Button>
        <p className="agent-settings-hint">{t(savedConfiguration ? 'agentSettings.chatHint' : 'agentSettings.saveFirst')}</p>
      </>}
    </fieldset>
  </section>
}

import { Check, CircleAlert, Cpu, Info, Keyboard, KeyRound, Puzzle, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AppInfo } from '@shared/api'
import type { ComponentId, ComponentStatus } from '@shared/components'
import type { SecretName, Settings } from '@shared/settings'
import { setModuleEnabled, useModules } from '@renderer/core/modules/registry'
import { runJob } from '@renderer/core/store/jobs'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { LANGUAGES, useT, type TKey } from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { bytes } from '@renderer/lib/format'
import { Button, Select, Switch, TextInput } from '@renderer/ui/controls'
import { Field, Progress } from '@renderer/ui/layout'
import { Dialog } from '@renderer/ui/overlays'
import { toast } from '@renderer/ui/toast'
import { Shortcuts } from './Shortcuts'
import s from './settings.module.css'

type Tab = 'general' | 'shortcuts' | 'ai' | 'modules' | 'about'

const TABS: { id: Tab; label: TKey; icon: React.ComponentType }[] = [
  { id: 'general', label: 'settings.general', icon: SlidersHorizontal },
  { id: 'shortcuts', label: 'settings.shortcuts', icon: Keyboard },
  { id: 'ai', label: 'settings.ai', icon: Cpu },
  { id: 'modules', label: 'settings.modules', icon: Puzzle },
  { id: 'about', label: 'settings.about', icon: Info }
]

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('general')
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('settings.title')} wide>
      <div className={s.layout}>
        <nav className={s.nav}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={s.navItem} data-active={tab === id} onClick={() => setTab(id)}>
              <Icon />
              {t(label)}
            </button>
          ))}
        </nav>
        <div className={s.body}>
          {tab === 'general' && <General />}
          {tab === 'shortcuts' && <Shortcuts />}
          {tab === 'ai' && <Ai />}
          {tab === 'modules' && <Modules />}
          {tab === 'about' && <About />}
        </div>
      </div>
    </Dialog>
  )
}

function General() {
  const t = useT()
  const settings = useSettings((st) => st.settings)
  return (
    <div className={s.group}>
      <Field label={t('settings.language')}>
        <Select value={settings.language} onChange={(language) => void settingsActions.update({ language })} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} />
      </Field>
      <Field label={t('settings.previewQuality')}>
        <Select<Settings['previewQuality']>
          value={settings.previewQuality}
          onChange={(previewQuality) => void settingsActions.update({ previewQuality })}
          options={[
            { value: 'full', label: t('viewer.qualityFull') },
            { value: 'half', label: t('viewer.qualityHalf') },
            { value: 'quarter', label: t('viewer.qualityQuarter') }
          ]}
        />
      </Field>
      <Field label={t('timeline.snapping')}>
        <Switch checked={settings.snapping} onChange={(snapping) => void settingsActions.update({ snapping })} />
      </Field>
      <Field label={t('settings.proxyLarge')}>
        <Switch checked={settings.proxyLarge} label={t('settings.proxyLarge')} onChange={(proxyLarge) => void settingsActions.update({ proxyLarge })} />
      </Field>
      <p className={s.hint}>{t('settings.proxyLargeHint')}</p>
    </div>
  )
}

const COMPONENT_ORDER: ComponentId[] = ['whisper-runtime', 'whisper-base', 'whisper-small', 'whisper-large-v3-turbo', 'piper-runtime', 'piper-voice-tr', 'piper-voice-en', 'rvm-matting', 'face-detector', 'llm-runtime', 'llm-gemma']

function Ai() {
  const t = useT()
  const settings = useSettings((st) => st.settings)
  const secrets = useSettings((st) => st.secrets)
  const [components, setComponents] = useState<ComponentStatus[]>([])
  const [installing, setInstalling] = useState<ComponentId | null>(null)

  const refresh = useCallback(async () => setComponents(await api.components.list()), [])
  useEffect(() => void refresh(), [refresh])

  const install = async (id: ComponentId) => {
    setInstalling(id)
    try {
      await runJob('components.install', { id }, t('components.installing', { name: t(`component.${id}`) }))
    } catch (err) {
      toast.error(t('components.failed'), err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
      await refresh()
    }
  }
  const remove = async (id: ComponentId) => {
    await api.components.remove(id)
    await refresh()
  }

  const byId = new Map(components.map((c) => [c.id, c]))

  return (
    <div className={s.stack}>
      <div className={s.group}>
        <div className={s.groupTitle}>{t('settings.captions')}</div>
        <Field label={t('settings.whisperModel')}>
          <Select<Settings['captions']['model']>
            value={settings.captions.model}
            onChange={(model) => void settingsActions.update({ captions: { ...settings.captions, model } })}
            options={[
              { value: 'base', label: t('settings.model.base') },
              { value: 'small', label: t('settings.model.small') },
              { value: 'large-v3-turbo', label: t('settings.model.turbo') }
            ]}
          />
        </Field>
        <Field label={t('settings.captionLanguage')}>
          <Select<Settings['captions']['language']>
            value={settings.captions.language}
            onChange={(language) => void settingsActions.update({ captions: { ...settings.captions, language } })}
            options={[
              { value: 'auto', label: t('settings.langAuto') },
              { value: 'tr', label: 'Türkçe' },
              { value: 'en', label: 'English' }
            ]}
          />
        </Field>
      </div>

      <div className={s.group}>
        <div className={s.groupTitle}>{t('settings.keys')}</div>
        <p className={s.note}>{t('settings.keysNote')}</p>
        <SecretRow name="elevenlabs" label={t('settings.elevenlabs')} hint={t('settings.elevenlabsHint')} present={secrets.elevenlabs} />
        <SecretRow name="replicate" label={t('settings.replicate')} hint={t('settings.replicateHint')} present={secrets.replicate} />
        <SecretRow name="anthropic" label={t('settings.anthropic')} hint={t('settings.anthropicHint')} present={secrets.anthropic} />
        <Field label={t('settings.elevenVoice')}>
          <TextInput
            defaultValue={settings.tts.elevenVoiceId}
            onBlur={(e) => e.target.value.trim() && void settingsActions.update({ tts: { elevenVoiceId: e.target.value.trim() } })}
          />
        </Field>
      </div>

      <div className={s.group}>
        <div className={s.groupTitle}>{t('settings.components')}</div>
        <p className={s.note}>{t('settings.componentsNote')}</p>
        {COMPONENT_ORDER.map((id) => {
          const c = byId.get(id)
          return (
            <div key={id} className={s.componentRow}>
              <div className={s.componentText}>
                <span>{t(`component.${id}`)}</span>
                <span className={s.dim}>{bytes(c?.size ?? 0)}</span>
              </div>
              {installing === id ? (
                <div style={{ width: 120 }}>
                  <Progress value={null} />
                </div>
              ) : c?.installed ? (
                <>
                  <span className={s.installed}>
                    <Check /> {t('settings.installed')}
                  </span>
                  <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => remove(id)} aria-label={t('common.remove')} />
                </>
              ) : (
                <Button size="sm" disabled={!!installing} onClick={() => install(id)}>
                  {t('components.download')}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SecretRow({ name, label, hint, present }: { name: SecretName; label: string; hint: string; present: boolean }) {
  const t = useT()
  const [value, setValue] = useState('')
  const save = async (v: string | null) => {
    try {
      await settingsActions.setSecret(name, v)
      setValue('')
      toast.success(v ? t('settings.keySaved') : t('settings.keyRemoved'))
    } catch (err) {
      toast.error(t('common.error'), err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <div className={s.secret}>
      <div className={s.secretHead}>
        <KeyRound />
        <span>{label}</span>
        <span className={present ? s.installed : s.dim}>{present ? t('settings.keyActive') : t('settings.keyLocal')}</span>
      </div>
      <div className={s.secretRow}>
        <TextInput type="password" placeholder={present ? '••••••••••••' : hint} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button size="sm" disabled={!value.trim()} onClick={() => save(value)}>
          {t('common.save')}
        </Button>
        {present && (
          <Button size="sm" variant="ghost" onClick={() => save(null)}>
            {t('common.remove')}
          </Button>
        )}
      </div>
    </div>
  )
}

function Modules() {
  const t = useT()
  const records = useModules((st) => st.records)
  const disabled = useSettings((st) => st.settings.disabledModules)
  const list = Object.values(records).sort((a, b) => a.id.localeCompare(b.id))

  const toggle = (id: string, enabled: boolean) => {
    setModuleEnabled(id, enabled)
    void settingsActions.update({ disabledModules: enabled ? disabled.filter((x) => x !== id) : [...new Set([...disabled, id])] })
  }

  return (
    <div className={s.group}>
      <p className={s.note}>{t('settings.modulesNote')}</p>
      {list.map((r) => (
        <div key={r.id} className={s.moduleRow}>
          <div className={s.componentText}>
            <span>{r.def?.name() ?? r.id}</span>
            {r.status === 'failed' ? (
              <span className={s.error}>
                <CircleAlert /> {t('settings.moduleFailed')}: {r.error}
              </span>
            ) : r.errorCount > 0 ? (
              <span className={s.warn}>{t('settings.moduleErrors', { count: r.errorCount })}: {r.error}</span>
            ) : (
              <span className={s.dim}>{r.def?.description?.() ?? ''}</span>
            )}
          </div>
          <Switch checked={r.status === 'active'} disabled={r.status === 'failed' || r.def?.core} onChange={(v) => toggle(r.id, v)} label={r.def?.name() ?? r.id} />
        </div>
      ))}
    </div>
  )
}

function About() {
  const t = useT()
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => void api.app.info().then(setInfo), [])
  return (
    <div className={s.group}>
      <Field label={t('settings.version')}>{info?.version ?? '…'}</Field>
      <Field label={t('settings.whatsNew')}>
        {/* Clearing the "seen" mark shows the what's-new sheet again. */}
        <Button size="sm" onClick={() => void settingsActions.update({ whatsNewSeen: '' })}>
          {t('settings.showWhatsNew')}
        </Button>
      </Field>
      <Field label={t('settings.projectsFolder')}>
        <Button size="sm" onClick={() => info && void api.app.revealPath(info.projectsDir)}>
          {t('home.reveal')}
        </Button>
      </Field>
      <Field label={t('settings.logs')}>
        <Button size="sm" onClick={() => info && void api.app.revealPath(info.logsDir)}>
          {t('home.reveal')}
        </Button>
      </Field>
    </div>
  )
}

import { useCallback } from 'react'
import { create } from 'zustand'
import type { Language } from '@shared/settings'
import { en } from './en'
import { tr } from './tr'

export type TKey = keyof typeof tr
export type TParams = Record<string, string | number>

const dictionaries: Record<Language, Record<TKey, string>> = { tr, en }

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'English' }
]

export const useLanguage = create<{ lang: Language; setLang(lang: Language): void }>((set) => ({
  lang: 'tr',
  setLang: (lang) => {
    document.documentElement.lang = lang
    set({ lang })
  }
}))

function interpolate(text: string, params?: TParams): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

export function translate(key: TKey, params?: TParams, lang = useLanguage.getState().lang): string {
  return interpolate(dictionaries[lang][key] ?? key, params)
}

/** Hook returning `t(key, params)` for the current language. */
export function useT() {
  const lang = useLanguage((s) => s.lang)
  return useCallback((key: TKey, params?: TParams) => translate(key, params, lang), [lang])
}

/**
 * Modules ship their own strings so each module folder is self-contained. English must define
 * every Turkish key (enforced by the type).
 */
export interface Strings<K extends string> {
  tr: Record<K, string>
  en: Record<K, string>
}

export function defineStrings<K extends string>(strings: { tr: Record<K, string>; en: Record<NoInfer<K>, string> }): Strings<K> {
  return strings
}

export function useStrings<K extends string>(strings: Strings<K>) {
  const lang = useLanguage((s) => s.lang)
  return useCallback((key: K, params?: TParams) => interpolate(strings[lang][key] ?? key, params), [lang, strings])
}

export function stringsT<K extends string>(strings: Strings<K>) {
  return (key: K, params?: TParams) => interpolate(strings[useLanguage.getState().lang][key] ?? key, params)
}

import { describe, expect, it } from 'vitest'
import { tokensToWords } from '../../src/worker/handlers/captions'

// whisper.cpp JSON is read as latin1 bytes (UTF-8 is decoded per word).
const tok = (text: string, from: number) => ({ text: Buffer.from(text, 'utf8').toString('latin1'), offsets: { from, to: from + 300 } })

describe('whisper tokens', () => {
  it('drops sound annotations such as [Music] and (applause)', () => {
    const words = tokensToWords({
      transcription: [{ tokens: [tok(' [Telefon', 0), tok(' çalıyor]', 300), tok(' Merhaba', 600), tok(' (alkış)', 900), tok(' dünya', 1200)] }]
    })
    expect(words.map((w) => w.text)).toEqual(['Merhaba', 'dünya'])
  })
})

import { defineStrings, stringsT } from '@renderer/i18n'

export const strings = defineStrings({
  tr: {
    name: 'Maske',
    desc: 'Klibin yalnızca belirli bir şeklin içini (veya dışını) gösterir.',
    section: 'Maske',
    change: 'Maskeyi değiştir',
    move: 'Maskeyi taşı',
    'type.none': 'Yok',
    'type.linear': 'Doğrusal',
    'type.mirror': 'Ayna',
    'type.circle': 'Daire',
    'type.rectangle': 'Dikdörtgen',
    'type.heart': 'Kalp',
    'type.star': 'Yıldız',
    x: 'Konum X',
    y: 'Konum Y',
    width: 'Genişlik',
    height: 'Yükseklik',
    band: 'Bant',
    rotation: 'Döndürme',
    feather: 'Yumuşatma',
    roundness: 'Köşe',
    invert: 'Ters çevir'
  },
  en: {
    name: 'Mask',
    desc: 'Shows only the inside (or outside) of a shape.',
    section: 'Mask',
    change: 'Change mask',
    move: 'Move mask',
    'type.none': 'None',
    'type.linear': 'Linear',
    'type.mirror': 'Mirror',
    'type.circle': 'Circle',
    'type.rectangle': 'Rectangle',
    'type.heart': 'Heart',
    'type.star': 'Star',
    x: 'Position X',
    y: 'Position Y',
    width: 'Width',
    height: 'Height',
    band: 'Band',
    rotation: 'Rotation',
    feather: 'Feather',
    roundness: 'Roundness',
    invert: 'Invert'
  }
})

export const maskT = stringsT(strings)

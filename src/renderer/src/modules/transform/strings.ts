import { defineStrings, stringsT } from '@renderer/i18n'

export const strings = defineStrings({
  tr: {
    name: 'Dönüştür ve anahtar kare',
    desc: 'Konum, ölçek, döndürme ve opaklık; zaman içinde anahtar karelerle canlandırma.',
    section: 'Dönüştür',
    x: 'Konum X',
    y: 'Konum Y',
    scale: 'Ölçek',
    rotation: 'Döndürme',
    opacity: 'Opaklık',
    fit: 'Sığdır',
    fill: 'Doldur',
    reset: 'Dönüştürmeyi sıfırla',
    move: 'Taşı',
    resize: 'Ölçekle',
    rotate: 'Döndür'
  },
  en: {
    name: 'Transform & keyframes',
    desc: 'Position, scale, rotation and opacity, animated with keyframes.',
    section: 'Transform',
    x: 'Position X',
    y: 'Position Y',
    scale: 'Scale',
    rotation: 'Rotation',
    opacity: 'Opacity',
    fit: 'Fit',
    fill: 'Fill',
    reset: 'Reset transform',
    move: 'Move',
    resize: 'Scale',
    rotate: 'Rotate'
  }
})
export const transformT = stringsT(strings)

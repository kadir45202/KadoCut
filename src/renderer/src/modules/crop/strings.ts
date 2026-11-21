import { defineStrings, stringsT } from '@renderer/i18n'

export const strings = defineStrings({
  tr: {
    name: 'Kırp ve çevir',
    desc: 'Serbest veya oranlı kırpma, 90° döndürme, yatay/dikey aynalama.',
    section: 'Kırp ve çevir',
    onCanvas: 'Elle kırp',
    free: 'Serbest',
    ratio: 'Kırpma oranı',
    left: 'Sol',
    top: 'Üst',
    right: 'Sağ',
    bottom: 'Alt',
    rotate: 'Döndür',
    rotateLeft: '90° sola döndür',
    rotateRight: '90° sağa döndür',
    flipH: 'Yatay aynala',
    flipV: 'Dikey aynala',
    reset: 'Kırpmayı sıfırla',
    edit: 'Kırp'
  },
  en: {
    name: 'Crop & flip',
    desc: 'Free or ratio crop, 90° rotation, horizontal/vertical mirroring.',
    section: 'Crop & flip',
    onCanvas: 'Drag to crop',
    free: 'Free',
    ratio: 'Crop ratio',
    left: 'Left',
    top: 'Top',
    right: 'Right',
    bottom: 'Bottom',
    rotate: 'Rotate',
    rotateLeft: 'Rotate 90° left',
    rotateRight: 'Rotate 90° right',
    flipH: 'Flip horizontally',
    flipV: 'Flip vertically',
    reset: 'Reset crop',
    edit: 'Crop'
  }
})

export const cropT = stringsT(strings)

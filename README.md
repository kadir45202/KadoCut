# Maker

Reels ve videolar için masaüstü video düzenleyici ve Lightroom tarzı fotoğraf stüdyosu (Windows). Electron + React + TypeScript.

- **Video düzenleyici:** zaman çizelgesi, WebGL2 compositor, efektler, geçişler, başlık şablonları, ses mikseri, MP4 / GIF / ses dışa aktarma.
- **Fotoğraf Stüdyosu:** yıkıcı olmayan düzenleme, maskeler, ton eğrisi, HSL, ön ayarlar, toplu dışa aktarma.
- **Yapay zeka araçları:** altyazı, gürültü azaltma, arka plan silme, metin okutma, çeviri ve daha fazlası. Varsayılan olarak **yerel** çalışır; isteğe bağlı olarak kendi API anahtarınla bulut sağlayıcılarını kullanabilirsin.
- Arayüz Türkçe ve İngilizce.

> Bu depo kaynak kodunu içerir. API anahtarları, projeler ve ayarlar depoda değil, kullanıcının kendi bilgisayarında (`Belgeler\Maker`, `%APPDATA%\Maker`) tutulur.

## Gereksinimler

- Windows 10 / 11
- [Node.js](https://nodejs.org) (LTS) ve npm
- İnternet bağlantısı: FFmpeg ilk kurulumda indirilir; yerel yapay zeka modelleri ilk kullanımda indirilir

## Çalıştırma

```bash
git clone <depo-adresi>
cd maker
npm install
npm run fetch:ffmpeg   # FFmpeg 7.1.1 (gyan.dev) → resources/bin/win
npm run dev            # geliştirme modu
```

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Uygulamayı geliştirme modunda açar |
| `npm run build` / `npm start` | Derler / derlenmiş hâlini açar |
| `npm run typecheck` | Tüm TypeScript tip kontrolü |
| `npm test` | Birim ve iş testleri (timeline kuralları, animasyon, vuruş algılama, ses seviyesi, hareket takibi…) |
| `npm run test:e2e` | Gerçek uygulamayı açıp uçtan uca test eder (pencere ekran dışında ve sessiz çalışır) |
| `MAKER_E2E_AI=1 npm run test:e2e` | Yerel yapay zeka araçlarını da test eder (modelleri bir kez indirir) |
| `npm run test:e2e:photos` | Fotoğraf Stüdyosu'nu uçtan uca test eder (içe aktarma, puan/bayrak, geliştirme, kırpma, maskeler, lens, anlık görüntü, filigranlı dışa aktarma, Reels) |
| `npm run test:e2e:pro` | 0.3 araçlarını uçtan uca test eder (efektler, işaretler, seslendirme kaydı, dışa aktarma biçimleri, sabitleme, ters oynatma…; sahte mikrofonla, sessiz) |
| `npm run gen:sfx` | Hazır ses efektlerini yeniden üretir |

## Kurulum dosyası (Windows)

```bash
npm run dist
```

Çıktı: `dist\Maker-Kurulum-<sürüm>.exe` (kullanıcı bazlı kurulum, yönetici izni gerekmez; Masaüstü ve Başlat menüsü kısayolu oluşturur, kurulum klasörü seçilebilir). Kaldırma işlemi projeleri ve ayarları silmez. Simge `npm run gen:icon` ile `build/icon.png` olarak yeniden üretilir. Kurulum dosyası dijital olarak imzalı değildir; Windows SmartScreen ilk açılışta uyarı gösterebilir.

Paketlenmiş uygulamayı test etmek için: `MAKER_E2E_EXE=dist/win-unpacked/Maker.exe npm run test:e2e`

### Fotoğraf Stüdyosu: 0.5 ile gelenler
- **Maskeler (yerel ayarlar):** fırça (boyut, yumuşaklık, silgi / Alt, `[` `]` ile boyut), doğrusal ve radyal degrade; maske başına pozlama, kontrast, vurgular, gölgeler, netlik, pus giderme, sıcaklık, renk tonu ve doygunluk; ters çevirme; kırmızı kaplama (O). Fotoğraf başına en çok 8 maske. Maskeler (`engine/photo/masks.ts`) saf TypeScript ile 1024 piksellik kaplama görüntülerine çizilir ve doku dizisi olarak shader'a verilir; fırça yalnız yeni eklenen kısmı boyar.
- **Lens ve perspektif:** bozulma, lens vinyeti, renk saçağı (K/C, M/S), dikey / yatay perspektif ve ölçek.
- **Kırpılma uyarısı (J):** patlamış vurgular kırmızı, ezilmiş gölgeler mavi. Histogram artık uyarılardan ve kaplamalardan bağımsız, temiz bir küçük çizimden ölçülür.
- **1:1 görünüm (Z ya da çift tık):** gerekirse tam çözünürlüklü fotoğraf yüklenir; sürükleyerek ya da tekerlekle kaydırılır.
- **Anlık görüntüler:** ayarların adlandırılmış kayıtları; tıklayınca geri dönülür (geri alınabilir).
- **Kitaplık:** eklenme sırası / ada / puana göre sıralama.
- **Dışa aktarma:** metin filigranı (konum, boyut, opaklık), numaralı dosya adları (`Tatil-001.jpg`…), 1350 px (Instagram) seçeneği.
- **Reels / video oluştur:** seçili fotoğraflar ayarlarıyla işlenip `Belgeler\Maker\Photos\Video` altına yazılır, yeni bir video projesi (9:16, 4:5, 1:1, 16:9) açılır ve slayt gösterisi penceresi gelir.
- Katalog 2. sürüme geçti; eski kataloglar açılırken otomatik yükseltilir (`upgradeCatalog`).

### Fotoğraf Stüdyosu (0.4)
Ana ekrandaki **Fotoğraf Stüdyosu** kartından açılır; Lightroom gibi **Kitaplık** ve **Geliştir** ekranları vardır. Düzenlemeler yıkıcı değildir: orijinal dosyalar hiç değiştirilmez, ayarlar `Belgeler\Maker\Photos\catalog.json` kataloğunda saklanır.
- **Kitaplık:** JPEG / PNG / WebP / BMP; TIFF ve HEIC önizleme için PNG'ye çevrilir. Yıldız (0–5), seç / reddet bayrağı (P / X / U), filtreler, çoklu seçim, ayarları kopyala / yapıştır (Ctrl+Shift+C / V), sanal kopya, katalogdan kaldırma.
- **Geliştir:** beyaz dengesi, pozlama, kontrast, vurgular / gölgeler / beyazlar / siyahlar, doku, netlik, pus giderme, canlılık, doygunluk, otomatik ton; ton eğrisi; 8 renkli HSL karıştırıcı (siyah-beyazda S/B karışımı); gölge / orta ton / vurgu renk çarkları; keskinleştirme ve gürültü azaltma; kırpma sonrası vinyet ve gren; oran sabitlemeli kırpma ve ±45° düzleştirme (R); önce / sonra (\); fotoğraf başına geri al / yinele.
- **Ön ayarlar:** 12 hazır görünüm (üzerine gelince canlı önizleme) ve kullanıcı ön ayarları.
- **Dışa aktarma:** seçili fotoğraflar tam çözünürlükteki orijinalden JPEG (kalite seçilebilir) veya PNG olarak; uzun kenar sınırı; aynı adlı dosyanın üzerine yazılmaz.
- **Motor** (`engine/photo`): WebGL2; her fotoğraf için bir kez yarım ve 1/8 çözünürlükte bulanık katmanlar hazırlanır, tüm ayarlar tek bir geçişte uygulanır, bu yüzden kaydırıcılar büyük fotoğraflarda da anında tepki verir.

### 0.3 ile gelenler
- **İzleyici:** Reels / TikTok / Shorts güvenli alanları, üçte bir ızgarası, sürüklerken akıllı hizalama (kenar, merkez, üçte birler; Alt ile serbest), histogram / dalga formu / vektörskop.
- **Zaman çizelgesi:** işaretler (M, Shift+M / Ctrl+Shift+M), giriş/çıkış aralığı (I / O, Alt+X), işaretlerden YouTube bölüm listesi, geçmiş menüsü (istenen adıma dönme), komut paleti (Ctrl+Shift+P veya F1).
- **Ses:** mikrofonla seslendirme kaydı (geri sayım, kayıtta videoyu oynatma, Ctrl+Shift+R), ses değiştirici, seviye göstergesi.
- **Dışa aktarma:** MP4, GIF, yalnız ses (M4A / MP3 / WAV), tek kare PNG (kapak görseli); giriş–çıkış aralığını dışa aktarma.
- **Medya:** arama ve tür filtresi, eksik dosyaları bir klasörde arayıp toplu yeniden bağlama, kullanılmayan medyayı kaldırma, dış dosyaları proje klasörüne toplama (taşınabilir proje).
- **Klip araçları:** görüntü sabitleme, ters oynatma, ton eğrileri, 27 efekt, 9 başlık şablonu (alt bant, büyük başlık, alıntı, bölüm başlığı, haber bandı…), 6 yeni geçiş (döndür, flaş, glitch, daire, sağa / aşağı kaydır).
- **Slayt gösterisi:** seçilen fotoğraflardan yavaş yakınlaşma / kaydırma hareketli slaytlar; isteğe bağlı müzik ve ritme göre kesim (Medya → ⋯ menüsü).
- **Proje:** 720p / 1080p / 2K / 4K tuval ve 24–60 fps (hiçbir şey seçili değilken sağdaki Proje bölümü); kare hızı değişince kesimler yeni kare ızgarasına oturur.
- **J / K / L** ile geri / dur / ileri oynatma; aynı tuşa tekrar basınca hız iki katına çıkar (8×'e kadar; ses yalnız 1×'te çalar).
- **Yenilikler penceresi** güncellemeden sonra bir kez açılır; Ayarlar → Hakkında'dan yeniden gösterilebilir.
- Proje biçimi v4'tür (işaretler, aralık, ses değiştirici, sabitleme, eğriler); eski projeler açılırken otomatik yükseltilir.

Projeler `Belgeler\Maker\Projects\<id>\` altında saklanır (`project.json`, `media/`, `backups/`, `thumbnail.jpg`).
Ayarlar, önbellek, indirilen yapay zeka bileşenleri ve kayıt dosyaları `%APPDATA%\Maker` altındadır.

## Mimari

```
src/
  shared/     Ortak tipler: proje şeması (zod, sürümlü), IPC sözleşmesi, iş tanımları
  main/       Electron ana süreci: proje deposu, media:// protokolü, iş yöneticisi, export
  worker/     Ağır işler (FFmpeg, Whisper, Piper, RVM, bulut API'leri) — her iş ayrı bir süreçte
  preload/    Güvenli köprüler (editör: sandbox; export penceresi: FFmpeg boruları)
  renderer/src/
    core/     Proje modeli, store'lar (undo/redo), modül sistemi, medya analizi
    engine/   Sahne hesaplama, WebGL compositor, ses mikseri, önizleme, export
    features/ Ekranlar: ana sayfa, editör, timeline, export, ayarlar
    modules/  Araçlar (her klasör bağımsız bir modül)
```

### Hata yalıtımı
- **Her araç bir modül.** Yüklenemeyen modül "arızalı" işaretlenir, diğerleri çalışır. Komut hataları yakalanır; panel çökerse yalnızca o panel hata kartı gösterir. Ayarlar → Modüller'den her modül kapatılabilir.
- **Modüller projeyi doğrudan değiştiremez.** Her düzenleme `projectActions.apply()` üzerinden yapılır; sonuç şema ve timeline kurallarıyla doğrulanır, geçersizse reddedilir ve proje değişmez.
- **Ağır işler ayrı süreçlerde.** Her iş kendi `utilityProcess`'inde çalışır; çökme, zaman aşımı veya iptal yalnızca o işi etkiler (alt süreçler dahil sonlandırılır).
- **Export ayrı bir gizli pencerede** çalışır; önizlemeyle aynı sahne ve compositor kodunu kullanır (ekranda ne görüyorsan çıktı o).
- **Kayıt:** her değişiklikten ~1 sn sonra atomik yazım, 10 dakikada bir yedek; bozuk dosyada en son yedek geri yüklenir.

### Görüntü ve ses hattı
- **Compositor (WebGL2):** kırpma/aynalama → chroma key → renk düzeltme → 3D LUT → maske → opaklık → blend mode; geçişler için ekran-uzayı silme, hareket bulanıklığı ve renk flaşı. Ayarlama katmanları altındaki görüntüyü okuyup renk / bulanıklık / pikselleştirme uygular.
- **Geçişler** kesimin ortasına yerleşir; klipler yer değiştirmez, kaynak medya yetmezse kenar karesi tutulur.
- **Animasyonlar** (giriş / çıkış / döngü) klibin kendi anahtar karelerinin üstüne eklenir; daktilo efekti ve altyazı vurguları (renk, kutu, büyütme, kelime kelime) metin çiziminde uygulanır.
- **İç içe sekans:** grup klipleri çizim ve ses için düz bir görünüme açılır (`engine/expand.ts`); önizleme, export ve mikser bu görünümü kullanır.
- **Ses mikseri** önizlemede gerçek zamanlı, export'ta çevrimdışı aynı kodla çalışır: ses düzeyi anahtar kareleri, fade, hız/perde koruma, otomatik ses kısma, EQ ve kompresör. Export'ta istenirse ses seviyesi LUFS hedefine eşitlenir (BS.1770, −1 dBFS tepe sınırı).
- **Efekt katmanları:** 27 ekran efekti (VHS, glitch, film greni, kamera sarsıntısı, bölünmüş ekran, ayna, parıltı…) ayarlama katmanının shader'ında çalışır; zamanla değişen efektler klibin yerel zamanını kullanır, böylece önizleme ve export aynıdır.
- **Renk:** pozlama/kontrast/sıcaklık… → 3D LUT → ton eğrileri (ana + R/G/B, monoton kübik spline, 256'lık doku).
- **Ses değiştirici** (telefon, radyo, megafon, yankı, salon, robot, su altı) mikserin klip zincirinde WebAudio düğümleriyle uygulanır; önizlemede stereo seviye göstergesi vardır.
- **Fontlar:** Maker'a gömülü 24 font (Türkçe karakterli), bilgisayarda kurulu fontlar ve kullanıcının eklediği font dosyaları (`%APPDATA%\Maker\fonts`).

### Yapay zeka sağlayıcıları
| Araç | API anahtarı varsa | Yoksa (yerel) |
| --- | --- | --- |
| Otomatik altyazı | — | Whisper (whisper.cpp) |
| Gürültü azaltma | ElevenLabs Audio Isolation | FFmpeg spektral filtre (afftdn) |
| Arka plan silme | Replicate (Robust Video Matting) | RVM ONNX modeli (DirectML/GPU, yoksa CPU) |
| Metin okutma | ElevenLabs | Piper |
| Metinden kurgu, dolgu kelime temizleme | — | Whisper (tüm dosya bir kez yazıya dökülür) |
| Otomatik çerçeveleme, yüz bulanıklaştırma | — | UltraFace ONNX yüz algılama |
| Hareket takibi | — | Normalize çapraz korelasyon (FFmpeg gri kareler) |
| Altyazı çevirisi | Claude (Opus 5.5) | llama.cpp + Gemma 2 2B |
| Öne çıkan anlar (uzun videodan kısa klip) | Claude (Opus 5.5) | Konuşma yoğunluğuna göre puanlama |
| Görüntü sabitleme | — | FFmpeg vid.stab (iki geçiş) |
| Ters oynatma | — | FFmpeg (4 sn'lik parçalar halinde, bellek dostu) |

Claude istekleri sunucu taraflı yedek modelle (`fallbacks: "default"`) gönderilir: güvenlik nedeniyle reddedilen bir istek Anthropic'in önerdiği modelle yeniden denenir.

Bulut çağrısı hata verirse yerel yönteme düşülür ve kullanıcıya bildirilir. Anahtarlar Windows güvenli deposunda (DPAPI) şifreli tutulur ve arayüze hiç gönderilmez.

## Yeni bir araç (modül) eklemek

`src/renderer/src/modules/<ad>/index.tsx` oluşturup `defineModule` ile dışa aktarman yeterli; kayıt otomatik yapılır.

```tsx
export default defineModule({
  id: 'ornek',
  name: () => t('name'),
  commands: [{ id: 'ornek.calistir', title: () => t('run'), keys: ['mod+shift+o'], run: () => { /* ... */ } }],
  toolbar: [{ command: 'ornek.calistir', icon: Sparkles, order: 50 }],
  inspector: [{ id: 'ornek.bolum', tab: 'video', order: 50, when: (clip) => clip.kind === 'video', Component: Bolum }],
  panels: [], clipMenu: [], assetMenu: [], viewer: [], dialogs: []
})
```

Metinler modülün içinde `defineStrings({ tr, en })` ile tanımlanır; İngilizce karşılığı eksik olursa derleme hata verir.
Proje şeması değişirse `PROJECT_SCHEMA_VERSION` artırılır ve `src/shared/project/migrate.ts` içine geçiş eklenir.

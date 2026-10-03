# VIZIMALL ürün ekleme

VIZIMALL ürünleri her mağaza açıldığında Shopify Storefront API'den okur.
Ürün listesi site kodunda tutulmaz. Görünürlük için ülke ve mağaza tag'lerinin
ikisi de eşleşmelidir. Bir üründe birden çok ülke veya mağaza tag'i olabilir.

## Ülke tag'leri

| Ülke | Tag |
| --- | --- |
| Germany | `country-germany` |
| France | `country-france` |
| Netherlands | `country-netherlands` |
| Poland | `country-poland` |
| Spain | `country-spain` |
| Portugal | `country-portugal` |
| Italy | `country-italy` |
| Greece | `country-greece` |

## Mağaza tag'leri

`store-tech`, `store-home`, `store-pets`, `store-beauty`, `store-fashion`, `store-kids`

Örnek: Almanya'daki teknoloji mağazası için `country-germany` + `store-tech`.
Ülke tag’i, o ülkeye hazırlama süresi dahil en fazla 8 günlük teslimat doğrulanınca eklenir.
Son talimatla 4–8 gün de kabul edilir; her ürünün gerçek tahmini süresini yazın.
Başka ülkedeki depodan gönderim de bu süreyi karşılıyorsa kullanılabilir.
Her ilave ülke tag’i için stok, hazırlama süresi ve hedef ülkenin teslimat süresi ayrı doğrulanır.
İş günü ile takvim günü ayrımını ürünün teslimat açıklamasında açıkça belirtin.
Çocuk kitabı/oyuncak için ülke tag’i + `store-kids` kullanın. Kitabın dilini,
yaş aralığını ve oyuncakların üretici güvenlik bilgilerini ürün açıklamasına ekleyin.

## Shopify'da ürün yayımlama

1. Ürünün adını, açıklamasını, görsellerini, fiyatını, varyantlarını ve stok bilgilerini girin.
2. İlgili ülke ve mağaza tag'lerini tam olarak yukarıdaki gibi ekleyin.
3. Ürün durumunu **Active** yapın ve **Headless** satış kanalında yayımlayın.
4. Ürünün seçilen ülkenin Shopify Market/katalog ayarlarında satışa açık olduğundan emin olun.

Başka koleksiyon kurmanız veya siteye ürün kodu eklemeniz gerekmez. Yeni ürün
mağaza sayfasının sonraki açılışında/yenilenmesinde sorgulanır. Shopify arama
indeksinin güncellenmesi kısa süre alabilir.

## Alışveriş

Ülke → sanal mağaza → ürün/varyant → Bag → Secure checkout.
Sepet ülkeye göre ayrı tutulur, aynı ülkenin farklı mağazalarından ürünler birlikte alınabilir.
Ödeme öncesi tag ve stok yeniden kontrol edilir. Shopify son fiyatı, kargo ve
vergileri hesaplar. Ödeme bilgileri VIZIMALL'da toplanmaz. Üyelik zorunlu değildir;
mevcut My account bağlantısı Shopify müşteri hesabına gider.

Shopify Payments/diğer ödeme sağlayıcısı, kargo bölgeleri ve işletme bilgilerinin
Shopify tarafında tamamlanması gerekir. Tag'ler teslimat/kargo ayarı oluşturmaz.
Site bağlantısının çalışması tek başına gerçek ödeme kabulünün hazır olduğunu doğrulamaz.

Gezilen AVM ülkesi ile teslimat adresi ayrı kavramlardır. Almanya AVM’sinden alışveriş
yapan bir müşteri Yunanistan adresi girebilir; bu rotada gönderim daha uzun sürebilir
veya mevcut olmayabilir. Mağaza, ürün ve sepet bu ayrımı açıklar. Kargo seçenekleri
girilen adrese göre Shopify checkout’ta hesaplanır; ürün tag’leri başka ülkeye
gönderim izni veya kesin teslimat süresi oluşturmaz.

## Bağlantı ve güvenlik

`shopify-config.js` yalnızca public Storefront token içerir. Admin/private token
kullanılmaz. API sürümü `2026-10` olarak sabitlenmiştir. Public token tarayıcıda
görünmesi için tasarlanmıştır. Gerekli izinler: ürün listeleri, ürün tag'leri ve
alışveriş/checkout. Müşteri okuma/yazma izinleri kapalıdır.

Kaynaklar: [Shopify public erişimi](https://shopify.dev/docs/api/storefront/2026-10),
[ürün filtreleri](https://shopify.dev/docs/api/storefront/2026-10/queries/products),
[Shopify checkout](https://shopify.dev/docs/api/storefront/2026-10/mutations/cartCreate).

Lifestyle konumu Kids & Play olarak değiştirilmiştir; panorama ve harita korunmuştur.
Mağaza adresi `kids.html` olur; eski `lifestyle.html` ve `travel.html` bağlantıları da
aynı Kids ürünlerini gösterir. Eski `store-lifestyle` tag’i yerine `store-kids` kullanın.
Fashion ve eski `auto.html` bağlantısı çalışmaya devam eder.

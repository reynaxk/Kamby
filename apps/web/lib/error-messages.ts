/**
 * friendlyError's messages in every Kamby language (2026-10-09). Errors are built outside React
 * (toasts, catch blocks), so this reads the page language from <html lang> instead of a hook.
 * `api*` entries translate the API's most common English messages by their opening words.
 */
export type ErrorKey = 'cancelled' | 'balance' | 'expired' | 'rateLimit' | 'network' | 'server' | 'fallback' | 'apiMinimum' | 'apiRoute' | 'apiNoQuote' | 'apiWrongChainUsdc';

const EN: Record<ErrorKey, string> = {
  cancelled: 'You cancelled this in your wallet — nothing was sent.',
  balance: 'Not enough balance for this trade.',
  expired: 'The network took too long and this trade expired — nothing was charged. Please try again.',
  rateLimit: 'Too many requests right now — wait a few seconds and try again.',
  network: 'Connection problem — check your internet and try again.',
  server: 'Something went wrong on our side — please try again in a moment.',
  fallback: 'Something went wrong — please try again.',
  apiMinimum: 'Minimum trade size is $2.00.',
  apiRoute: 'This trade route is too complex right now — try a different amount or again in a moment.',
  apiNoQuote: 'No live quote is available for this trade right now — try again shortly.',
  apiWrongChainUsdc: 'Not enough USDC on this chain — deposit USDC on this chain to trade here.',
};

const T: Record<string, Partial<Record<ErrorKey, string>>> = {
  zh: { cancelled: '你已在钱包中取消，未发送任何内容。', balance: '余额不足，无法完成此交易。', expired: '网络超时，交易已过期，未扣除任何费用。请重试。', rateLimit: '请求过多，请稍等几秒再试。', network: '网络连接问题，请检查网络后重试。', server: '我们这边出了点问题，请稍后再试。', fallback: '出了点问题，请重试。', apiMinimum: '最低交易金额为 $2.00。', apiRoute: '当前交易路径过于复杂，请换个金额或稍后再试。', apiNoQuote: '暂时无法获取实时报价，请稍后再试。', apiWrongChainUsdc: '此链上的 USDC 不足，请在此链充值 USDC 后再交易。' },
  ko: { cancelled: '지갑에서 취소했습니다 — 아무것도 전송되지 않았습니다.', balance: '이 거래를 위한 잔액이 부족합니다.', expired: '네트워크 지연으로 거래가 만료되었습니다 — 비용은 청구되지 않았습니다. 다시 시도하세요.', rateLimit: '요청이 너무 많습니다 — 몇 초 후 다시 시도하세요.', network: '연결 문제 — 인터넷을 확인하고 다시 시도하세요.', server: '서버에 문제가 발생했습니다 — 잠시 후 다시 시도하세요.', fallback: '문제가 발생했습니다 — 다시 시도하세요.', apiMinimum: '최소 거래 금액은 $2.00입니다.', apiRoute: '지금은 거래 경로가 너무 복잡합니다 — 다른 금액으로 또는 잠시 후 시도하세요.', apiNoQuote: '지금은 실시간 견적을 받을 수 없습니다 — 잠시 후 다시 시도하세요.', apiWrongChainUsdc: '이 체인의 USDC가 부족합니다 — 이 체인에 USDC를 입금하세요.' },
  ja: { cancelled: 'ウォレットでキャンセルしました。何も送信されていません。', balance: 'この取引に必要な残高が足りません。', expired: 'ネットワークの遅延で取引が期限切れになりました。料金はかかっていません。もう一度お試しください。', rateLimit: 'リクエストが多すぎます。数秒待ってからお試しください。', network: '接続の問題です。インターネットを確認してもう一度お試しください。', server: 'こちらで問題が発生しました。しばらくしてからお試しください。', fallback: '問題が発生しました。もう一度お試しください。', apiMinimum: '最低取引額は $2.00 です。', apiRoute: '現在この取引ルートは複雑すぎます。金額を変えるか、少し後でお試しください。', apiNoQuote: '現在リアルタイムの見積もりを取得できません。少し後でお試しください。', apiWrongChainUsdc: 'このチェーンの USDC が不足しています。このチェーンに USDC を入金してください。' },
  tr: { cancelled: 'Cüzdanında iptal ettin — hiçbir şey gönderilmedi.', balance: 'Bu işlem için bakiye yetersiz.', expired: 'Ağ çok yavaştı ve işlemin süresi doldu — ücret alınmadı. Tekrar dene.', rateLimit: 'Şu an çok fazla istek var — birkaç saniye bekleyip tekrar dene.', network: 'Bağlantı sorunu — internetini kontrol edip tekrar dene.', server: 'Bizim tarafımızda bir sorun oluştu — birazdan tekrar dene.', fallback: 'Bir şeyler ters gitti — tekrar dene.', apiMinimum: 'Minimum işlem tutarı $2.00.', apiRoute: 'Bu işlem rotası şu an çok karmaşık — farklı bir tutar dene ya da biraz sonra tekrar dene.', apiNoQuote: 'Şu an bu işlem için canlı fiyat alınamıyor — birazdan tekrar dene.', apiWrongChainUsdc: 'Bu ağda yeterli USDC yok — burada işlem yapmak için bu ağa USDC yatır.' },
  ru: { cancelled: 'Вы отменили операцию в кошельке — ничего не отправлено.', balance: 'Недостаточно средств для этой сделки.', expired: 'Сеть ответила слишком поздно, сделка истекла — средства не списаны. Попробуйте снова.', rateLimit: 'Слишком много запросов — подождите несколько секунд и повторите.', network: 'Проблема с подключением — проверьте интернет и повторите.', server: 'У нас что-то пошло не так — попробуйте чуть позже.', fallback: 'Что-то пошло не так — попробуйте снова.', apiMinimum: 'Минимальная сумма сделки — $2.00.', apiRoute: 'Маршрут сделки сейчас слишком сложный — попробуйте другую сумму или чуть позже.', apiNoQuote: 'Сейчас нет актуальной котировки для этой сделки — попробуйте чуть позже.', apiWrongChainUsdc: 'Недостаточно USDC в этой сети — пополните USDC в этой сети.' },
  es: { cancelled: 'Lo cancelaste en tu wallet: no se envió nada.', balance: 'Saldo insuficiente para esta operación.', expired: 'La red tardó demasiado y la operación expiró; no se cobró nada. Inténtalo de nuevo.', rateLimit: 'Demasiadas solicitudes: espera unos segundos e inténtalo de nuevo.', network: 'Problema de conexión: revisa tu internet e inténtalo de nuevo.', server: 'Algo falló de nuestro lado; inténtalo en un momento.', fallback: 'Algo salió mal; inténtalo de nuevo.', apiMinimum: 'El mínimo por operación es $2.00.', apiRoute: 'La ruta de esta operación es demasiado compleja ahora; prueba otro monto o más tarde.', apiNoQuote: 'No hay cotización en vivo para esta operación ahora; inténtalo en breve.', apiWrongChainUsdc: 'No tienes suficiente USDC en esta red: deposita USDC en esta red para operar aquí.' },
  pt: { cancelled: 'Você cancelou na sua carteira — nada foi enviado.', balance: 'Saldo insuficiente para esta operação.', expired: 'A rede demorou demais e a operação expirou — nada foi cobrado. Tente novamente.', rateLimit: 'Muitas solicitações agora — espere alguns segundos e tente de novo.', network: 'Problema de conexão — verifique sua internet e tente de novo.', server: 'Algo deu errado do nosso lado — tente novamente em instantes.', fallback: 'Algo deu errado — tente novamente.', apiMinimum: 'O valor mínimo por operação é $2.00.', apiRoute: 'A rota desta operação está complexa demais agora — tente outro valor ou mais tarde.', apiNoQuote: 'Sem cotação ao vivo para esta operação agora — tente em breve.', apiWrongChainUsdc: 'USDC insuficiente nesta rede — deposite USDC nesta rede para operar aqui.' },
  vi: { cancelled: 'Bạn đã hủy trong ví — không có gì được gửi.', balance: 'Số dư không đủ cho giao dịch này.', expired: 'Mạng phản hồi quá chậm nên giao dịch đã hết hạn — không bị trừ phí. Vui lòng thử lại.', rateLimit: 'Quá nhiều yêu cầu — đợi vài giây rồi thử lại.', network: 'Lỗi kết nối — kiểm tra internet và thử lại.', server: 'Có lỗi từ phía chúng tôi — vui lòng thử lại sau ít phút.', fallback: 'Đã xảy ra lỗi — vui lòng thử lại.', apiMinimum: 'Giá trị giao dịch tối thiểu là $2.00.', apiRoute: 'Tuyến giao dịch hiện quá phức tạp — thử số tiền khác hoặc thử lại sau.', apiNoQuote: 'Hiện chưa có báo giá trực tiếp cho giao dịch này — thử lại sau.', apiWrongChainUsdc: 'Không đủ USDC trên mạng này — hãy nạp USDC trên mạng này để giao dịch.' },
  id: { cancelled: 'Kamu membatalkannya di wallet — tidak ada yang dikirim.', balance: 'Saldo tidak cukup untuk transaksi ini.', expired: 'Jaringan terlalu lama dan transaksi kedaluwarsa — tidak ada biaya. Coba lagi.', rateLimit: 'Terlalu banyak permintaan — tunggu beberapa detik lalu coba lagi.', network: 'Masalah koneksi — periksa internet lalu coba lagi.', server: 'Ada masalah di sisi kami — coba lagi sebentar lagi.', fallback: 'Terjadi kesalahan — coba lagi.', apiMinimum: 'Minimal transaksi $2.00.', apiRoute: 'Rute transaksi ini terlalu rumit saat ini — coba jumlah lain atau nanti.', apiNoQuote: 'Belum ada harga langsung untuk transaksi ini — coba sebentar lagi.', apiWrongChainUsdc: 'USDC di jaringan ini tidak cukup — setor USDC di jaringan ini untuk trading di sini.' },
  th: { cancelled: 'คุณยกเลิกในวอลเล็ตแล้ว — ไม่มีการส่งใดๆ', balance: 'ยอดเงินไม่พอสำหรับการเทรดนี้', expired: 'เครือข่ายช้าเกินไปและการเทรดหมดเวลา — ไม่มีการเรียกเก็บเงิน ลองอีกครั้ง', rateLimit: 'มีคำขอมากเกินไป — รอสักครู่แล้วลองใหม่', network: 'การเชื่อมต่อมีปัญหา — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', server: 'ระบบของเรามีปัญหา — ลองใหม่อีกครั้งในอีกสักครู่', fallback: 'เกิดข้อผิดพลาด — ลองใหม่อีกครั้ง', apiMinimum: 'ยอดเทรดขั้นต่ำคือ $2.00', apiRoute: 'เส้นทางการเทรดนี้ซับซ้อนเกินไปตอนนี้ — ลองจำนวนอื่นหรือรอสักครู่', apiNoQuote: 'ยังไม่มีราคาเรียลไทม์สำหรับการเทรดนี้ — ลองใหม่อีกครั้ง', apiWrongChainUsdc: 'USDC บนเครือข่ายนี้ไม่พอ — ฝาก USDC บนเครือข่ายนี้เพื่อเทรด' },
  de: { cancelled: 'Du hast in deiner Wallet abgebrochen – es wurde nichts gesendet.', balance: 'Nicht genug Guthaben für diesen Trade.', expired: 'Das Netzwerk war zu langsam, der Trade ist abgelaufen – es wurde nichts berechnet. Bitte erneut versuchen.', rateLimit: 'Zu viele Anfragen – warte ein paar Sekunden und versuche es erneut.', network: 'Verbindungsproblem – prüfe dein Internet und versuche es erneut.', server: 'Bei uns ist etwas schiefgelaufen – bitte gleich erneut versuchen.', fallback: 'Etwas ist schiefgelaufen – bitte erneut versuchen.', apiMinimum: 'Die Mindesthandelsgröße beträgt $2.00.', apiRoute: 'Diese Route ist gerade zu komplex – versuche einen anderen Betrag oder später erneut.', apiNoQuote: 'Gerade kein Live-Kurs für diesen Trade verfügbar – bitte gleich erneut versuchen.', apiWrongChainUsdc: 'Nicht genug USDC auf dieser Chain – zahle USDC auf dieser Chain ein, um hier zu handeln.' },
  fr: { cancelled: 'Vous avez annulé dans votre wallet — rien n’a été envoyé.', balance: 'Solde insuffisant pour ce trade.', expired: 'Le réseau a été trop lent et le trade a expiré — rien n’a été facturé. Réessayez.', rateLimit: 'Trop de requêtes — attendez quelques secondes et réessayez.', network: 'Problème de connexion — vérifiez votre internet et réessayez.', server: 'Un problème est survenu de notre côté — réessayez dans un instant.', fallback: 'Une erreur est survenue — réessayez.', apiMinimum: 'Le montant minimum par trade est de $2.00.', apiRoute: 'Cette route est trop complexe pour le moment — essayez un autre montant ou plus tard.', apiNoQuote: 'Aucune cotation en direct pour ce trade pour l’instant — réessayez bientôt.', apiWrongChainUsdc: 'Pas assez d’USDC sur ce réseau — déposez des USDC sur ce réseau pour trader ici.' },
  bg: { cancelled: 'Отказа в портфейла си — нищо не е изпратено.', balance: 'Нямаш достатъчно наличност за тази сделка.', expired: 'Мрежата се забави и сделката изтече — нищо не е таксувано. Опитай отново.', rateLimit: 'Твърде много заявки — изчакай няколко секунди и опитай пак.', network: 'Проблем с връзката — провери интернета и опитай пак.', server: 'Нещо се обърка при нас — опитай отново след малко.', fallback: 'Нещо се обърка — опитай отново.', apiMinimum: 'Минималната сделка е $2.00.', apiRoute: 'Маршрутът на сделката е твърде сложен в момента — опитай друга сума или след малко.', apiNoQuote: 'В момента няма цена на живо за тази сделка — опитай след малко.', apiWrongChainUsdc: 'Нямаш достатъчно USDC в тази мрежа — депозирай USDC в тази мрежа, за да търгуваш тук.' },
};

/** The page's language (set by the root layout's <html lang>). */
function pageLocale(): string {
  return typeof document !== 'undefined' ? (document.documentElement.lang || 'en').toLowerCase().split('-')[0] ?? 'en' : 'en';
}

export function errorText(key: ErrorKey): string {
  return T[pageLocale()]?.[key] ?? EN[key];
}

/** The API's own English messages, recognised by how they start, translated when known. */
const API_PREFIXES: { prefix: RegExp; key: ErrorKey }[] = [
  { prefix: /^minimum trade size/i, key: 'apiMinimum' },
  { prefix: /^this trade route is too complex/i, key: 'apiRoute' },
  { prefix: /^no live quote is available/i, key: 'apiNoQuote' },
  { prefix: /^not enough usdc on /i, key: 'apiWrongChainUsdc' },
];

export function translateApiMessage(message: string): string {
  if (pageLocale() === 'en') return message;
  const match = API_PREFIXES.find((p) => p.prefix.test(message));
  return match ? errorText(match.key) : message;
}

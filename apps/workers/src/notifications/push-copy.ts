import type { NotificationType } from '@kamby/domain';

/**
 * The words on a phone notification (2026-10-11), in the language the phone subscribed with.
 * Built from a notification's structured facts only — `{actor}`, `{token}`, `{amount}`,
 * `{pct}` — never stored text. English is the fallback for anything missing.
 */
export interface PushFacts {
  actor: string;
  token: string;
  amount: string;
  pct: string;
  side: 'BUY' | 'SELL' | null;
  /** 📈 / 📉 for a price move, '' otherwise. */
  arrow?: string;
}

type Copy = Record<NotificationType, { title: string; body: string }> & { bought: string; sold: string };

const EN: Copy = {
  bought: 'bought',
  sold: 'sold',
  FOLLOW: { title: 'New follower', body: '{actor} started following you' },
  LIKE: { title: 'New like', body: '{actor} liked your trade' },
  FOLLOWED_TRADER_TRADE: { title: '{actor} just traded', body: '{actor} {side} {amount} of {token}' },
  WHALE_TRADE: { title: '🐋 Whale trade', body: '{actor} {side} {amount} of {token}' },
  TRENDING_TOKEN: { title: '🔥 Trending', body: '{token} is trending on Kamby' },
  WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'Big trade on a coin you watch: {amount} {side}' },
  TRADE_CONFIRMED: { title: '✅ Trade confirmed', body: 'You {side} {amount} of {token}' },
  TRADE_FAILED: { title: '❌ Trade failed', body: "Your {token} trade didn't go through — your USDC is safe" },
  PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} moved {pct} in the last hour' },
  USDC_RECEIVED: { title: '💸 {amount} received', body: '@{actor} sent you {amount}' },
  DM_MESSAGE: { title: "💬 @{actor}", body: "sent you a message" },
  CALL_INCOMING: { title: "📞 @{actor}", body: "is calling you" },
};

const COPY: Record<string, Partial<Copy>> = {
  en: EN,
  bg: {
    USDC_RECEIVED: { title: "💸 Получи {amount}", body: "@{actor} ти прати {amount}" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "ти писа" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "ти звъни" },
    bought: 'купи', sold: 'продаде',
    FOLLOW: { title: 'Нов последовател', body: '{actor} започна да те следва' },
    LIKE: { title: 'Ново харесване', body: '{actor} хареса твоя сделка' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} току-що търгува', body: '{actor} {side} {token} за {amount}' },
    WHALE_TRADE: { title: '🐋 Сделка на кит', body: '{actor} {side} {token} за {amount}' },
    TRENDING_TOKEN: { title: '🔥 В тренд', body: '{token} е в тренд в Kamby' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'Голяма сделка на монета, която следиш: {amount}' },
    TRADE_CONFIRMED: { title: '✅ Сделката е потвърдена', body: 'Ти {side} {token} за {amount}' },
    TRADE_FAILED: { title: '❌ Сделката не мина', body: 'Сделката с {token} не мина — твоите USDC са на сигурно' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} се промени с {pct} за последния час' },
  },
  zh: {
    USDC_RECEIVED: { title: "💸 收到 {amount}", body: "@{actor} 给你发了 {amount}" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "给你发了一条消息" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "正在呼叫你" },
    bought: '买入', sold: '卖出',
    FOLLOW: { title: '新粉丝', body: '{actor} 关注了你' },
    LIKE: { title: '新点赞', body: '{actor} 点赞了你的交易' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} 刚刚交易', body: '{actor} {side}了 {amount} 的 {token}' },
    WHALE_TRADE: { title: '🐋 巨鲸交易', body: '{actor} {side}了 {amount} 的 {token}' },
    TRENDING_TOKEN: { title: '🔥 热门', body: '{token} 正在 Kamby 上走热' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: '你关注的币有大额交易：{amount}' },
    TRADE_CONFIRMED: { title: '✅ 交易已确认', body: '你{side}了 {amount} 的 {token}' },
    TRADE_FAILED: { title: '❌ 交易失败', body: '你的 {token} 交易未成功 — USDC 安全无损' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} 过去一小时变动 {pct}' },
  },
  ko: {
    USDC_RECEIVED: { title: "💸 {amount} 받았어요", body: "@{actor}님이 {amount}를 보냈어요" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "님이 메시지를 보냈어요" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "님이 전화하고 있어요" },
    bought: '매수', sold: '매도',
    FOLLOW: { title: '새 팔로워', body: '{actor}님이 회원님을 팔로우합니다' },
    LIKE: { title: '새 좋아요', body: '{actor}님이 거래에 좋아요를 눌렀습니다' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} 거래', body: '{actor}님이 {token} {amount} {side}' },
    WHALE_TRADE: { title: '🐋 고래 거래', body: '{actor}님이 {token} {amount} {side}' },
    TRENDING_TOKEN: { title: '🔥 트렌딩', body: '{token}이(가) Kamby에서 트렌딩 중' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: '관심 코인에 대규모 거래: {amount}' },
    TRADE_CONFIRMED: { title: '✅ 거래 확인', body: '{token} {amount} {side} 완료' },
    TRADE_FAILED: { title: '❌ 거래 실패', body: '{token} 거래가 실패했습니다 — USDC는 안전합니다' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token}이(가) 지난 1시간 동안 {pct} 변동' },
  },
  ja: {
    USDC_RECEIVED: { title: "💸 {amount} 受け取りました", body: "@{actor} から {amount} が届きました" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "からメッセージが届きました" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "から着信中" },
    bought: '購入', sold: '売却',
    FOLLOW: { title: '新しいフォロワー', body: '{actor} があなたをフォローしました' },
    LIKE: { title: '新しいいいね', body: '{actor} があなたの取引にいいねしました' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} が取引', body: '{actor} が {token} を {amount} {side}' },
    WHALE_TRADE: { title: '🐋 クジラの取引', body: '{actor} が {token} を {amount} {side}' },
    TRENDING_TOKEN: { title: '🔥 トレンド', body: '{token} が Kamby でトレンド入り' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'ウォッチ中のコインで大口取引：{amount}' },
    TRADE_CONFIRMED: { title: '✅ 取引完了', body: '{token} を {amount} {side}しました' },
    TRADE_FAILED: { title: '❌ 取引失敗', body: '{token} の取引は失敗しました — USDC は無事です' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} が直近1時間で {pct} 変動' },
  },
  tr: {
    USDC_RECEIVED: { title: "💸 {amount} geldi", body: "@{actor} sana {amount} gönderdi" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "sana mesaj gönderdi" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "seni arıyor" },
    bought: 'aldı', sold: 'sattı',
    FOLLOW: { title: 'Yeni takipçi', body: '{actor} seni takip etmeye başladı' },
    LIKE: { title: 'Yeni beğeni', body: '{actor} işlemini beğendi' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} işlem yaptı', body: '{actor} {amount} değerinde {token} {side}' },
    WHALE_TRADE: { title: '🐋 Balina işlemi', body: '{actor} {amount} değerinde {token} {side}' },
    TRENDING_TOKEN: { title: '🔥 Trend', body: "{token} Kamby'de trend oldu" },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'İzlediğin coinde büyük işlem: {amount}' },
    TRADE_CONFIRMED: { title: '✅ İşlem onaylandı', body: '{amount} değerinde {token} işlemin tamam' },
    TRADE_FAILED: { title: '❌ İşlem başarısız', body: '{token} işlemin gerçekleşmedi — USDC güvende' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} son bir saatte {pct} hareket etti' },
  },
  ru: {
    USDC_RECEIVED: { title: "💸 Получено {amount}", body: "@{actor} отправил тебе {amount}" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "написал тебе" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "звонит тебе" },
    bought: 'купил', sold: 'продал',
    FOLLOW: { title: 'Новый подписчик', body: '{actor} подписался на вас' },
    LIKE: { title: 'Новый лайк', body: '{actor} лайкнул вашу сделку' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} совершил сделку', body: '{actor} {side} {token} на {amount}' },
    WHALE_TRADE: { title: '🐋 Сделка кита', body: '{actor} {side} {token} на {amount}' },
    TRENDING_TOKEN: { title: '🔥 В тренде', body: '{token} в тренде на Kamby' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'Крупная сделка по монете из избранного: {amount}' },
    TRADE_CONFIRMED: { title: '✅ Сделка подтверждена', body: 'Вы {side} {token} на {amount}' },
    TRADE_FAILED: { title: '❌ Сделка не прошла', body: 'Сделка с {token} не прошла — ваши USDC в безопасности' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} изменился на {pct} за последний час' },
  },
  es: {
    USDC_RECEIVED: { title: "💸 Recibiste {amount}", body: "@{actor} te envió {amount}" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "te envió un mensaje" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "te está llamando" },
    bought: 'compró', sold: 'vendió',
    FOLLOW: { title: 'Nuevo seguidor', body: '{actor} empezó a seguirte' },
    LIKE: { title: 'Nuevo me gusta', body: 'A {actor} le gustó tu operación' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} acaba de operar', body: '{actor} {side} {amount} de {token}' },
    WHALE_TRADE: { title: '🐋 Operación de ballena', body: '{actor} {side} {amount} de {token}' },
    TRENDING_TOKEN: { title: '🔥 Tendencia', body: '{token} es tendencia en Kamby' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'Gran operación en una moneda que sigues: {amount}' },
    TRADE_CONFIRMED: { title: '✅ Operación confirmada', body: 'Operación de {amount} en {token} confirmada' },
    TRADE_FAILED: { title: '❌ Operación fallida', body: 'Tu operación de {token} no se completó — tus USDC están a salvo' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} se movió {pct} en la última hora' },
  },
  pt: {
    USDC_RECEIVED: { title: "💸 {amount} recebidos", body: "@{actor} te enviou {amount}" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "te enviou uma mensagem" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "está te ligando" },
    bought: 'comprou', sold: 'vendeu',
    FOLLOW: { title: 'Novo seguidor', body: '{actor} começou a seguir você' },
    LIKE: { title: 'Nova curtida', body: '{actor} curtiu sua operação' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} acabou de operar', body: '{actor} {side} {amount} de {token}' },
    WHALE_TRADE: { title: '🐋 Operação de baleia', body: '{actor} {side} {amount} de {token}' },
    TRENDING_TOKEN: { title: '🔥 Em alta', body: '{token} está em alta na Kamby' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'Grande operação em uma moeda que você acompanha: {amount}' },
    TRADE_CONFIRMED: { title: '✅ Operação confirmada', body: 'Operação de {amount} em {token} confirmada' },
    TRADE_FAILED: { title: '❌ Operação falhou', body: 'Sua operação de {token} não passou — seus USDC estão seguros' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} variou {pct} na última hora' },
  },
  vi: {
    USDC_RECEIVED: { title: "💸 Đã nhận {amount}", body: "@{actor} đã gửi bạn {amount}" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "đã nhắn tin cho bạn" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "đang gọi cho bạn" },
    bought: 'mua', sold: 'bán',
    FOLLOW: { title: 'Người theo dõi mới', body: '{actor} đã theo dõi bạn' },
    LIKE: { title: 'Lượt thích mới', body: '{actor} đã thích giao dịch của bạn' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} vừa giao dịch', body: '{actor} {side} {amount} {token}' },
    WHALE_TRADE: { title: '🐋 Giao dịch cá voi', body: '{actor} {side} {amount} {token}' },
    TRENDING_TOKEN: { title: '🔥 Thịnh hành', body: '{token} đang thịnh hành trên Kamby' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'Giao dịch lớn ở coin bạn theo dõi: {amount}' },
    TRADE_CONFIRMED: { title: '✅ Giao dịch đã xác nhận', body: 'Bạn đã {side} {amount} {token}' },
    TRADE_FAILED: { title: '❌ Giao dịch thất bại', body: 'Giao dịch {token} không thành công — USDC của bạn vẫn an toàn' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} biến động {pct} trong 1 giờ qua' },
  },
  id: {
    USDC_RECEIVED: { title: "💸 {amount} diterima", body: "@{actor} mengirimimu {amount}" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "mengirimimu pesan" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "sedang meneleponmu" },
    bought: 'membeli', sold: 'menjual',
    FOLLOW: { title: 'Pengikut baru', body: '{actor} mulai mengikutimu' },
    LIKE: { title: 'Suka baru', body: '{actor} menyukai trade-mu' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} baru trading', body: '{actor} {side} {token} senilai {amount}' },
    WHALE_TRADE: { title: '🐋 Trade paus', body: '{actor} {side} {token} senilai {amount}' },
    TRENDING_TOKEN: { title: '🔥 Trending', body: '{token} sedang trending di Kamby' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'Trade besar di koin yang kamu pantau: {amount}' },
    TRADE_CONFIRMED: { title: '✅ Trade terkonfirmasi', body: 'Trade {token} senilai {amount} berhasil' },
    TRADE_FAILED: { title: '❌ Trade gagal', body: 'Trade {token}-mu tidak berhasil — USDC-mu aman' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} bergerak {pct} dalam satu jam terakhir' },
  },
  th: {
    USDC_RECEIVED: { title: "💸 ได้รับ {amount}", body: "@{actor} ส่ง {amount} ให้คุณ" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "ส่งข้อความถึงคุณ" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "กำลังโทรหาคุณ" },
    bought: 'ซื้อ', sold: 'ขาย',
    FOLLOW: { title: 'ผู้ติดตามใหม่', body: '{actor} เริ่มติดตามคุณ' },
    LIKE: { title: 'ถูกใจใหม่', body: '{actor} ถูกใจเทรดของคุณ' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} เพิ่งเทรด', body: '{actor} {side} {token} มูลค่า {amount}' },
    WHALE_TRADE: { title: '🐋 เทรดของวาฬ', body: '{actor} {side} {token} มูลค่า {amount}' },
    TRENDING_TOKEN: { title: '🔥 เทรนด์', body: '{token} กำลังเป็นเทรนด์บน Kamby' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'เทรดใหญ่ในเหรียญที่คุณเฝ้าดู: {amount}' },
    TRADE_CONFIRMED: { title: '✅ ยืนยันเทรดแล้ว', body: 'เทรด {token} มูลค่า {amount} สำเร็จ' },
    TRADE_FAILED: { title: '❌ เทรดล้มเหลว', body: 'เทรด {token} ของคุณไม่สำเร็จ — USDC ของคุณปลอดภัย' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} เปลี่ยนแปลง {pct} ในชั่วโมงที่ผ่านมา' },
  },
  de: {
    USDC_RECEIVED: { title: "💸 {amount} erhalten", body: "@{actor} hat dir {amount} geschickt" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "hat dir geschrieben" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "ruft dich an" },
    bought: 'kaufte', sold: 'verkaufte',
    FOLLOW: { title: 'Neuer Follower', body: '{actor} folgt dir jetzt' },
    LIKE: { title: 'Neues Like', body: '{actor} gefällt dein Trade' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} hat getradet', body: '{actor} {side} {token} für {amount}' },
    WHALE_TRADE: { title: '🐋 Wal-Trade', body: '{actor} {side} {token} für {amount}' },
    TRENDING_TOKEN: { title: '🔥 Im Trend', body: '{token} ist im Trend auf Kamby' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'Großer Trade bei einem beobachteten Coin: {amount}' },
    TRADE_CONFIRMED: { title: '✅ Trade bestätigt', body: 'Dein {token}-Trade über {amount} ist durch' },
    TRADE_FAILED: { title: '❌ Trade fehlgeschlagen', body: 'Dein {token}-Trade ging nicht durch — dein USDC ist sicher' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} hat sich in der letzten Stunde um {pct} bewegt' },
  },
  fr: {
    USDC_RECEIVED: { title: "💸 {amount} reçus", body: "@{actor} t'a envoyé {amount}" },
    DM_MESSAGE: { title: "💬 @{actor}", body: "t'a envoyé un message" },
    CALL_INCOMING: { title: "📞 @{actor}", body: "t'appelle" },
    bought: 'a acheté', sold: 'a vendu',
    FOLLOW: { title: 'Nouvel abonné', body: '{actor} te suit maintenant' },
    LIKE: { title: 'Nouveau j’aime', body: '{actor} a aimé ton trade' },
    FOLLOWED_TRADER_TRADE: { title: '{actor} vient de trader', body: '{actor} {side} {amount} de {token}' },
    WHALE_TRADE: { title: '🐋 Trade de baleine', body: '{actor} {side} {amount} de {token}' },
    TRENDING_TOKEN: { title: '🔥 Tendance', body: '{token} est en tendance sur Kamby' },
    WATCHED_TOKEN_ACTIVITY: { title: '👀 {token}', body: 'Gros trade sur un coin que tu suis : {amount}' },
    TRADE_CONFIRMED: { title: '✅ Trade confirmé', body: 'Ton trade {token} de {amount} est passé' },
    TRADE_FAILED: { title: '❌ Trade échoué', body: 'Ton trade {token} n’est pas passé — tes USDC sont en sécurité' },
    PRICE_MOVE: { title: '{arrow} {token} {pct}', body: '{token} a bougé de {pct} sur la dernière heure' },
  },
};

export function pushCopy(locale: string, type: NotificationType, facts: PushFacts): { title: string; body: string } {
  const lang = COPY[locale] ?? EN;
  const entry = lang[type] ?? EN[type];
  const side = facts.side === 'SELL' ? (lang.sold ?? EN.sold) : (lang.bought ?? EN.bought);
  const fill = (text: string) =>
    text
      .replaceAll('{actor}', facts.actor)
      .replaceAll('{token}', facts.token)
      .replaceAll('{amount}', facts.amount)
      .replaceAll('{pct}', facts.pct)
      .replaceAll('{side}', side)
      .replaceAll('{arrow}', facts.arrow ?? '')
      .trim();
  return { title: fill(entry.title), body: fill(entry.body) };
}

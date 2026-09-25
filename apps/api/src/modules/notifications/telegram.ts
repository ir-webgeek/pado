import { env } from "../../config";

/** Telegram Bot API sendMessage. The shop links its chat by messaging the bot and saving the chat id in settings. */
export async function sendTelegram(chatId: string, text: string, button?: { text: string; url: string }) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, skipped: true };
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(button ? { reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] } } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok };
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

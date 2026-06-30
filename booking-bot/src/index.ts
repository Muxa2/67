// Точка входа: поднимает бота на long polling.

import "dotenv/config";
import { BookingStore } from "./db";
import { seed } from "./seed";
import { createBot } from "./bot";

function main(): void {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error(
      "Не задан BOT_TOKEN. Получи токен у @BotFather и положи его в .env\n" +
        "(см. .env.example).",
    );
    process.exit(1);
  }

  const store = new BookingStore();
  // Для удобства первого запуска — автосид, если база пустая.
  seed(store);

  const bot = createBot(token, store);

  bot.catch((err) => console.error("Ошибка бота:", err));

  process.once("SIGINT", () => {
    store.close();
    bot.stop();
  });
  process.once("SIGTERM", () => {
    store.close();
    bot.stop();
  });

  console.log("Бот запущен. Открой Telegram и напиши боту /start");
  bot.start();
}

main();

// Логика Telegram-бота (сторона игрока). Сценарий:
// выбор вида спорта → площадка → дата → свободный слот → бронь.
// Плюс просмотр и отмена своих броней.

import { Bot, InlineKeyboard } from "grammy";
import { BookingStore } from "./db";
import {
  Court,
  SPORT_LABELS,
  Slot,
  Sport,
  availableDates,
  formatDateLabel,
  formatPrice,
  isSlotFree,
  isSport,
  parseSlotKey,
  toDateString,
} from "./domain";
import { registerOwnerHandlers } from "./owner";

export function createBot(token: string, store: BookingStore): Bot {
  const bot = new Bot(token);

  // Сторона владельца площадки (/owner и связанные экраны).
  registerOwnerHandlers(bot, store);

  // --- Экраны -------------------------------------------------------------

  const sportMenu = (): InlineKeyboard => {
    const kb = new InlineKeyboard();
    (Object.keys(SPORT_LABELS) as Sport[]).forEach((s) => {
      kb.text(SPORT_LABELS[s], `s:${s}`).row();
    });
    return kb;
  };

  const greeting =
    "👋 Привет! Я помогу забронировать корт или поле.\n\nВыбери вид спорта:";

  bot.command("start", async (ctx) => {
    await ctx.reply(greeting, { reply_markup: sportMenu() });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Команды:\n" +
        "/start — выбрать спорт и забронировать слот\n" +
        "/mybookings — мои брони и отмена\n" +
        "/owner — кабинет владельца площадки\n" +
        "/help — эта справка",
    );
  });

  bot.command("mybookings", (ctx) => showMyBookings(ctx));

  // Выбор вида спорта → список площадок.
  bot.callbackQuery(/^s:(.+)$/, async (ctx) => {
    const sport = ctx.match![1];
    if (!isSport(sport)) return ctx.answerCallbackQuery();
    const venues = store.venuesBySport(sport);
    await ctx.answerCallbackQuery();

    if (venues.length === 0) {
      return ctx.editMessageText(
        `${SPORT_LABELS[sport]}\n\nПока нет доступных площадок 😔`,
        { reply_markup: new InlineKeyboard().text("⬅️ Назад", "home") },
      );
    }

    const kb = new InlineKeyboard();
    for (const v of venues) {
      kb.text(`${v.name} · ${v.city}`, `v:${v.id}:${sport}`).row();
    }
    kb.text("⬅️ Назад", "home");
    await ctx.editMessageText(
      `${SPORT_LABELS[sport]}\n\nВыбери площадку:`,
      { reply_markup: kb },
    );
  });

  // Назад в главное меню.
  bot.callbackQuery("home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(greeting, { reply_markup: sportMenu() });
  });

  // Выбор площадки → выбор даты.
  bot.callbackQuery(/^v:(\d+):(.+)$/, async (ctx) => {
    const venueId = Number(ctx.match![1]);
    const sport = ctx.match![2];
    if (!isSport(sport)) return ctx.answerCallbackQuery();
    const venue = store.getVenue(venueId);
    await ctx.answerCallbackQuery();
    if (!venue) return;

    const kb = new InlineKeyboard();
    const dates = availableDates();
    dates.forEach((d, i) => {
      kb.text(formatDateLabel(d), `d:${venueId}:${sport}:${d}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text("⬅️ Назад", `s:${sport}`);

    await ctx.editMessageText(
      `${SPORT_LABELS[sport]}\n📍 ${venue.name}, ${venue.address}\n\nВыбери день:`,
      { reply_markup: kb },
    );
  });

  // Выбор даты → список свободных слотов по кортам.
  bot.callbackQuery(/^d:(\d+):([^:]+):(.+)$/, async (ctx) => {
    const venueId = Number(ctx.match![1]);
    const sport = ctx.match![2];
    const date = ctx.match![3];
    if (!isSport(sport)) return ctx.answerCallbackQuery();
    const venue = store.getVenue(venueId);
    await ctx.answerCallbackQuery();
    if (!venue) return;

    const slots = store.slotsForDay(venueId, sport, date);
    const byCourt = groupByCourt(slots);

    const kb = new InlineKeyboard();
    const lines: string[] = [
      `${SPORT_LABELS[sport]}`,
      `📍 ${venue.name}`,
      `🗓 ${formatDateLabel(date)}\n`,
    ];

    const now = new Date();
    for (const { court, slots: courtSlots } of byCourt) {
      const free = courtSlots.filter(
        (s) => isSlotFree(s) && !isPast(s.start_iso, now),
      );
      lines.push(`🏟 ${court.name} · ${court.surface} · ${formatPrice(court.price_per_hour)}`);
      if (free.length === 0) {
        lines.push("   нет свободных слотов\n");
        continue;
      }
      lines.push(`   свободно часов: ${free.length}\n`);
      free.forEach((s, i) => {
        kb.text(`${court.name.split(" ")[0]} ${labelHour(s.hour)}`, `b:${court.id}:${s.start_iso}`);
        if (i % 3 === 2) kb.row();
      });
      kb.row();
    }

    kb.text("⬅️ Назад", `v:${venueId}:${sport}`);
    await ctx.editMessageText(lines.join("\n"), { reply_markup: kb });
  });

  // Бронирование слота.
  bot.callbackQuery(/^b:(\d+):(.+)$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    const startIso = ctx.match![2];
    const court = store.getCourt(courtId);
    if (!court) return ctx.answerCallbackQuery({ text: "Корт не найден" });

    if (isPast(startIso, new Date())) {
      return ctx.answerCallbackQuery({ text: "Это время уже прошло", show_alert: true });
    }

    const user = ctx.from!;
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Игрок";
    const res = store.book(courtId, startIso, user.id, name);

    if (!res.ok) {
      // Гонку перехватил UNIQUE-констрейнт в БД. Предлагаем обновить список.
      await ctx.answerCallbackQuery({ text: "Увы, слот только что заняли 🙈", show_alert: true });
      const venue = store.getVenue(court.venue_id)!;
      const { date } = parseSlotKey(startIso);
      return ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text(
          "🔄 Обновить свободные слоты",
          `d:${venue.id}:${court.sport}:${date}`,
        ),
      });
    }

    const venue = store.getVenue(court.venue_id)!;
    await ctx.answerCallbackQuery({ text: "Забронировано! ✅" });
    await ctx.editMessageText(
      "✅ <b>Бронь подтверждена</b>\n\n" +
        `${SPORT_LABELS[court.sport]}\n` +
        `📍 ${venue.name}, ${venue.address}\n` +
        `🏟 ${court.name} (${court.surface})\n` +
        `🗓 ${formatDateLabel(parseSlotKey(startIso).date)}, ${labelHour(parseSlotKey(startIso).hour)}\n` +
        `💳 ${formatPrice(court.price_per_hour)}\n\n` +
        "Управлять бронями — /mybookings",
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("📋 Мои брони", "my")
          .text("🏠 В меню", "home"),
      },
    );
  });

  // Мои брони (через кнопку).
  bot.callbackQuery("my", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMyBookings(ctx, true);
  });

  // Отмена брони.
  bot.callbackQuery(/^c:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match![1]);
    const ok = store.cancel(bookingId, ctx.from!.id);
    await ctx.answerCallbackQuery({ text: ok ? "Бронь отменена" : "Не получилось отменить" });
    await showMyBookings(ctx, true);
  });

  // --- Вспомогательное для «Мои брони» ------------------------------------

  async function showMyBookings(ctx: any, edit = false): Promise<void> {
    const fromIso = `${toDateString(new Date())}T00`;
    const bookings = store.userBookings(ctx.from!.id, fromIso);

    if (bookings.length === 0) {
      const text = "У тебя пока нет броней. Нажми /start, чтобы забронировать слот.";
      return edit ? ctx.editMessageText(text) : ctx.reply(text);
    }

    const lines = ["📋 <b>Твои брони:</b>\n"];
    const kb = new InlineKeyboard();
    for (const b of bookings) {
      const { date, hour } = parseSlotKey(b.start_iso);
      lines.push(
        `• ${SPORT_LABELS[b.court.sport]}\n` +
          `  ${b.venue.name} — ${b.court.name}\n` +
          `  ${formatDateLabel(date)}, ${labelHour(hour)} · ${formatPrice(b.court.price_per_hour)}`,
      );
      kb.text(`❌ Отменить ${formatDateLabel(date)} ${labelHour(hour)}`, `c:${b.id}`).row();
    }
    const text = lines.join("\n");
    if (edit) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
    else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  }

  return bot;
}

// --- Чистые помощники ------------------------------------------------------

function groupByCourt(slots: Slot[]): { court: Court; slots: Slot[] }[] {
  const map = new Map<number, { court: Court; slots: Slot[] }>();
  for (const s of slots) {
    if (!map.has(s.court.id)) map.set(s.court.id, { court: s.court, slots: [] });
    map.get(s.court.id)!.slots.push(s);
  }
  return [...map.values()];
}

function labelHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

// Слот в прошлом, если его дата+час раньше текущего момента.
function isPast(startIso: string, now: Date): boolean {
  const { date, hour } = parseSlotKey(startIso);
  const dt = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`);
  return dt.getTime() <= now.getTime();
}

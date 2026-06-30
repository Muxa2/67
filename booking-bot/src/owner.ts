// Сторона владельца площадки. Спроектировано под скорость:
//  • расписание свободных слотов генерится автоматически из кортов —
//    владельцу НЕ нужно заводить каждый слот;
//  • добавление корта — в один тап по шаблону (спорт → дефолтные
//    покрытие и цена, правятся позже);
//  • блокировка часа (техработы/турнир) — один тап по сетке часов.

import { Bot, Context, InlineKeyboard } from "grammy";
import { BookingStore } from "./db";
import {
  Court,
  SLOT_HOURS,
  SPORT_DEFAULTS,
  SPORT_LABELS,
  SPORT_SHORT,
  SPORTS,
  Sport,
  Venue,
  availableDates,
  formatDateLabel,
  formatPrice,
  isSport,
  parseSlotKey,
  slotKey,
  toDateString,
} from "./domain";

// Ожидаемый от владельца текстовый ввод (в памяти процесса).
type Pending =
  | { type: "venue" }
  | { type: "price"; courtId: number }
  | { type: "name"; courtId: number };

const pending = new Map<number, Pending>();

export function registerOwnerHandlers(bot: Bot, store: BookingStore): void {
  // --- Дашборд ------------------------------------------------------------

  bot.command("owner", (ctx) => showDashboard(ctx, store, false));
  bot.callbackQuery("o:home", (ctx) => showDashboard(ctx, store, true));

  // Добавить площадку — просим одно сообщение «Название, Город, Адрес».
  bot.callbackQuery("o:newv", async (ctx) => {
    pending.set(ctx.from!.id, { type: "venue" });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Отправь одной строкой: <b>Название, Город, Адрес</b>\n" +
        "Например: <i>Спорт-Холл, Москва, ул. Ленина 5</i>\n\n" +
        "Достаточно одного названия — город и адрес можно дописать позже.",
      { parse_mode: "HTML" },
    );
  });

  // --- Площадка -----------------------------------------------------------

  bot.callbackQuery(/^o:v:(\d+)$/, async (ctx) => {
    const venueId = Number(ctx.match![1]);
    if (!store.ownsVenue(venueId, ctx.from!.id)) return denied(ctx);
    await ctx.answerCallbackQuery();
    await renderVenue(ctx, store, venueId, true);
  });

  // Быстрое добавление корта по шаблону спорта — в один тап.
  bot.callbackQuery(/^o:addc:(\d+):([a-z]+)$/, async (ctx) => {
    const venueId = Number(ctx.match![1]);
    const sport = ctx.match![2];
    if (!isSport(sport)) return ctx.answerCallbackQuery();
    if (!store.ownsVenue(venueId, ctx.from!.id)) return denied(ctx);

    const n = store.countCourtsBySport(venueId, sport) + 1;
    const def = SPORT_DEFAULTS[sport];
    store.insertCourt({
      venue_id: venueId,
      sport,
      name: `${SPORT_SHORT[sport]} №${n}`,
      surface: def.surface,
      price_per_hour: def.price,
    });
    await ctx.answerCallbackQuery({ text: `Добавлен: ${SPORT_SHORT[sport]} №${n} ✅` });
    await renderVenue(ctx, store, venueId, true);
  });

  // Брони игроков по площадке (на сегодня и вперёд).
  bot.callbackQuery(/^o:today:(\d+)$/, async (ctx) => {
    const venueId = Number(ctx.match![1]);
    if (!store.ownsVenue(venueId, ctx.from!.id)) return denied(ctx);
    await ctx.answerCallbackQuery();

    const fromIso = `${toDateString(new Date())}T00`;
    const list = store.venueBookings(venueId, fromIso);
    const venue = store.getVenue(venueId)!;
    const lines = [`📅 <b>Брони · ${venue.name}</b>\n`];
    if (list.length === 0) lines.push("Пока нет предстоящих броней.");
    else
      for (const b of list) {
        const { date, hour } = parseSlotKey(b.start_iso);
        lines.push(
          `• ${formatDateLabel(date)} ${hh(hour)} — ${b.court.name}\n  👤 ${b.user_name}`,
        );
      }
    await safeEdit(ctx, lines.join("\n"), backKb(`o:v:${venueId}`));
  });

  // --- Корт ---------------------------------------------------------------

  bot.callbackQuery(/^o:court:(\d+)$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    const court = store.ownerCourt(courtId, ctx.from!.id);
    if (!court) return denied(ctx);
    await ctx.answerCallbackQuery();
    await renderCourt(ctx, store, court, true);
  });

  bot.callbackQuery(/^o:price:(\d+)$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    if (!store.ownerCourt(courtId, ctx.from!.id)) return denied(ctx);
    pending.set(ctx.from!.id, { type: "price", courtId });
    await ctx.answerCallbackQuery();
    await ctx.reply("Пришли новую цену за час числом в рублях, например 2800");
  });

  bot.callbackQuery(/^o:name:(\d+)$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    if (!store.ownerCourt(courtId, ctx.from!.id)) return denied(ctx);
    pending.set(ctx.from!.id, { type: "name", courtId });
    await ctx.answerCallbackQuery();
    await ctx.reply("Пришли новое название корта, например «Корт №3 (грунт)»");
  });

  bot.callbackQuery(/^o:dup:(\d+)$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    const court = store.ownerCourt(courtId, ctx.from!.id);
    if (!court) return denied(ctx);
    const n = store.countCourtsBySport(court.venue_id, court.sport) + 1;
    store.duplicateCourt(courtId, `${SPORT_SHORT[court.sport]} №${n}`);
    await ctx.answerCallbackQuery({ text: "Копия создана ✅" });
    await renderVenue(ctx, store, court.venue_id, true);
  });

  bot.callbackQuery(/^o:del:(\d+)$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    const court = store.ownerCourt(courtId, ctx.from!.id);
    if (!court) return denied(ctx);
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      `Удалить «${court.name}»? Все его брони и блокировки тоже удалятся.`,
      new InlineKeyboard()
        .text("🗑 Да, удалить", `o:delok:${courtId}`)
        .text("Отмена", `o:court:${courtId}`),
    );
  });

  bot.callbackQuery(/^o:delok:(\d+)$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    const court = store.ownerCourt(courtId, ctx.from!.id);
    if (!court) return denied(ctx);
    const venueId = court.venue_id;
    store.deleteCourt(courtId);
    await ctx.answerCallbackQuery({ text: "Корт удалён" });
    await renderVenue(ctx, store, venueId, true);
  });

  // --- Блокировка часов ---------------------------------------------------

  bot.callbackQuery(/^o:block:(\d+)$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    const court = store.ownerCourt(courtId, ctx.from!.id);
    if (!court) return denied(ctx);
    await ctx.answerCallbackQuery();

    const kb = new InlineKeyboard();
    availableDates().forEach((d, i) => {
      kb.text(formatDateLabel(d), `o:bday:${courtId}:${d}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text("⬅️ Назад", `o:court:${courtId}`);
    await safeEdit(
      ctx,
      `🚫 <b>${court.name}</b>\nВыбери день, чтобы заблокировать часы:`,
      kb,
    );
  });

  bot.callbackQuery(/^o:bday:(\d+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    const date = ctx.match![2];
    const court = store.ownerCourt(courtId, ctx.from!.id);
    if (!court) return denied(ctx);
    await ctx.answerCallbackQuery();
    await renderBlockGrid(ctx, store, court, date);
  });

  // Тумблер блокировки часа.
  bot.callbackQuery(/^o:btgl:(\d+):(.+)$/, async (ctx) => {
    const courtId = Number(ctx.match![1]);
    const startIso = ctx.match![2];
    const court = store.ownerCourt(courtId, ctx.from!.id);
    if (!court) return denied(ctx);

    if (store.unblock(courtId, startIso)) {
      await ctx.answerCallbackQuery({ text: "Час открыт" });
    } else {
      const res = store.block(courtId, startIso, ctx.from!.id, "Недоступно");
      if (!res.ok) {
        await ctx.answerCallbackQuery({
          text: "Этот час уже забронирован игроком — сначала отмени бронь",
          show_alert: true,
        });
      } else {
        await ctx.answerCallbackQuery({ text: "Час заблокирован" });
      }
    }
    await renderBlockGrid(ctx, store, court, parseSlotKey(startIso).date);
  });

  // Занятый игроком час в сетке блокировок — просто поясняем.
  bot.callbackQuery("o:busy", (ctx) =>
    ctx.answerCallbackQuery({ text: "Час забронирован игроком", show_alert: true }),
  );
  bot.callbackQuery("o:noop", (ctx) => ctx.answerCallbackQuery());

  // --- Текстовый ввод владельца -------------------------------------------

  bot.on("message:text", async (ctx, next) => {
    const p = pending.get(ctx.from!.id);
    if (!p) return next(); // не наш ввод — пропускаем дальше

    const text = ctx.message.text.trim();

    if (p.type === "venue") {
      const [name, city, address] = text.split(",").map((s) => s.trim());
      if (!name) {
        return ctx.reply("Название не может быть пустым. Пришли ещё раз.");
      }
      const venueId = store.insertVenue({
        name,
        city: city || "—",
        address: address || "—",
        owner_id: ctx.from!.id,
      });
      pending.delete(ctx.from!.id);
      await ctx.reply("Площадка создана ✅ Теперь добавь корты:");
      return renderVenue(ctx, store, venueId, false);
    }

    if (p.type === "price") {
      const price = Number(text.replace(/[^\d]/g, ""));
      if (!Number.isFinite(price) || price <= 0) {
        return ctx.reply("Нужно положительное число, например 2800. Пришли ещё раз.");
      }
      const court = store.ownerCourt(p.courtId, ctx.from!.id);
      if (!court) {
        pending.delete(ctx.from!.id);
        return ctx.reply("Корт не найден.");
      }
      store.updateCourtPrice(p.courtId, price);
      pending.delete(ctx.from!.id);
      await ctx.reply(`Цена обновлена: ${formatPrice(price)} ✅`);
      return renderCourt(ctx, store, store.getCourt(p.courtId)!, false);
    }

    if (p.type === "name") {
      const name = text.slice(0, 60);
      if (!name) return ctx.reply("Название пустое. Пришли ещё раз.");
      const court = store.ownerCourt(p.courtId, ctx.from!.id);
      if (!court) {
        pending.delete(ctx.from!.id);
        return ctx.reply("Корт не найден.");
      }
      store.updateCourtName(p.courtId, name);
      pending.delete(ctx.from!.id);
      await ctx.reply("Название обновлено ✅");
      return renderCourt(ctx, store, store.getCourt(p.courtId)!, false);
    }
  });
}

// --- Экраны ----------------------------------------------------------------

async function showDashboard(ctx: Context, store: BookingStore, edit: boolean): Promise<void> {
  if (edit) await ctx.answerCallbackQuery().catch(() => {});
  const venues = store.venuesByOwner(ctx.from!.id);

  if (venues.length === 0) {
    const text =
      "🏟 <b>Кабинет владельца</b>\n\n" +
      "У тебя пока нет площадок. Создай первую — это 10 секунд.";
    const kb = new InlineKeyboard().text("➕ Создать площадку", "o:newv");
    return send(ctx, text, kb, edit);
  }

  const lines = ["🏟 <b>Кабинет владельца</b>\n", "Твои площадки:"];
  const kb = new InlineKeyboard();
  for (const v of venues) {
    const courts = store.courtsByVenue(v.id).length;
    kb.text(`${v.name} · кортов: ${courts}`, `o:v:${v.id}`).row();
  }
  kb.text("➕ Добавить площадку", "o:newv");
  await send(ctx, lines.join("\n"), kb, edit);
}

async function renderVenue(
  ctx: Context,
  store: BookingStore,
  venueId: number,
  edit: boolean,
): Promise<void> {
  const venue = store.getVenue(venueId) as Venue;
  const courts = store.courtsByVenue(venueId);

  const lines = [
    `📍 <b>${venue.name}</b>`,
    `${venue.city}, ${venue.address}\n`,
    courts.length ? `Корты (${courts.length}):` : "Кортов пока нет — добавь по кнопкам ниже.",
  ];
  for (const c of courts) {
    lines.push(`• ${emoji(c.sport)} ${c.name} — ${formatPrice(c.price_per_hour)}`);
  }
  lines.push("\nБыстро добавить корт:");

  const kb = new InlineKeyboard();
  // Ряд шаблонов: один тап = новый корт с дефолтами.
  SPORTS.forEach((s) => kb.text(`+ ${emoji(s)}`, `o:addc:${venueId}:${s}`));
  kb.row();
  for (const c of courts) {
    kb.text(`⚙️ ${c.name}`, `o:court:${c.id}`).row();
  }
  kb.text("📅 Брони", `o:today:${venueId}`).text("⬅️ Площадки", "o:home");

  await send(ctx, lines.join("\n"), kb, edit);
}

async function renderCourt(
  ctx: Context,
  store: BookingStore,
  court: Court,
  edit: boolean,
): Promise<void> {
  const text =
    `⚙️ <b>${court.name}</b>\n` +
    `${SPORT_LABELS[court.sport]}\n` +
    `Покрытие: ${court.surface}\n` +
    `Цена: ${formatPrice(court.price_per_hour)}\n\n` +
    "Слоты по 1 часу (08:00–22:00) создаются автоматически.\n" +
    "Заблокируй отдельные часы, если корт занят под турнир/ремонт.";
  const kb = new InlineKeyboard()
    .text("💸 Цена", `o:price:${court.id}`)
    .text("✏️ Название", `o:name:${court.id}`)
    .row()
    .text("📑 Дубликат", `o:dup:${court.id}`)
    .text("🚫 Заблокировать часы", `o:block:${court.id}`)
    .row()
    .text("🗑 Удалить", `o:del:${court.id}`)
    .row()
    .text("⬅️ К площадке", `o:v:${court.venue_id}`);
  await send(ctx, text, kb, edit);
}

async function renderBlockGrid(
  ctx: Context,
  store: BookingStore,
  court: Court,
  date: string,
): Promise<void> {
  const slots = store.slotsForDay(court.venue_id, court.sport, date);
  const mine = slots.filter((s) => s.court.id === court.id);
  const now = new Date();

  const kb = new InlineKeyboard();
  mine.forEach((s, i) => {
    const past = isPast(s.start_iso, now);
    if (s.isBooked) {
      kb.text(`🔒${s.hour}`, "o:busy");
    } else if (past) {
      kb.text(`·${s.hour}`, "o:noop");
    } else if (s.isBlocked) {
      kb.text(`🚫${s.hour}`, `o:btgl:${court.id}:${s.start_iso}`);
    } else {
      kb.text(`🟢${s.hour}`, `o:btgl:${court.id}:${s.start_iso}`);
    }
    if (i % 4 === 3) kb.row();
  });
  kb.row().text("⬅️ Другой день", `o:block:${court.id}`).text("К корту", `o:court:${court.id}`);

  const text =
    `🚫 <b>${court.name}</b> · ${formatDateLabel(date)}\n\n` +
    "🟢 свободно (тап — заблокировать)\n" +
    "🚫 заблокировано (тап — открыть)\n" +
    "🔒 занято игроком · · прошло";
  await safeEdit(ctx, text, kb);
}

// --- Утилиты ---------------------------------------------------------------

function emoji(sport: Sport): string {
  return SPORT_LABELS[sport].split(" ")[0];
}

function hh(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function backKb(data: string): InlineKeyboard {
  return new InlineKeyboard().text("⬅️ Назад", data);
}

function denied(ctx: Context): Promise<unknown> {
  return ctx.answerCallbackQuery({ text: "Нет доступа к этому объекту", show_alert: true });
}

function isPast(startIso: string, now: Date): boolean {
  const { date, hour } = parseSlotKey(startIso);
  return new Date(`${date}T${hh(hour)}:00`).getTime() <= now.getTime();
}

// Отправить новое сообщение или отредактировать текущее (для callback-экранов).
async function send(
  ctx: Context,
  text: string,
  kb: InlineKeyboard,
  edit: boolean,
): Promise<void> {
  if (edit) await safeEdit(ctx, text, kb);
  else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

// Редактирование, устойчивое к «message is not modified».
async function safeEdit(ctx: Context, text: string, kb: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (e: any) {
    if (!String(e?.description || e?.message).includes("message is not modified")) {
      // Если редактировать нельзя (например, сообщение слишком старое) — шлём новое.
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    }
  }
}

export { slotKey };

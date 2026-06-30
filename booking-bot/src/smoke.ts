// Дымовой тест логики бронирования без Telegram. Проверяет главное:
// слоты считаются корректно и один слот нельзя забронировать дважды.
// Запуск: npm run smoke

import fs from "node:fs";
import path from "node:path";
import { BookingStore } from "./db";
import { seed } from "./seed";
import { availableDates, slotKey, SLOT_HOURS } from "./domain";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`✅ ${msg}`);
}

function main(): void {
  const tmp = path.join(process.cwd(), "smoke-test.db");
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const store = new BookingStore(tmp);
  seed(store, true);

  // 1. Площадки по спорту.
  const padelVenues = store.venuesBySport("padel");
  assert(padelVenues.length === 2, "Падел доступен на 2 площадках");

  const tennisVenues = store.venuesBySport("tennis");
  assert(tennisVenues.length === 2, "Теннис доступен на 2 площадках");

  // 2. Слоты на день для площадки.
  const venue = padelVenues[0];
  const date = availableDates()[1]; // завтра, чтобы не было «прошедших» часов
  const slotsBefore = store.slotsForDay(venue.id, "padel", date);
  const courtsCount = store.courtsByVenueAndSport(venue.id, "padel").length;
  assert(
    slotsBefore.length === courtsCount * SLOT_HOURS.length,
    `Слотов = кортов(${courtsCount}) × часов(${SLOT_HOURS.length}) = ${slotsBefore.length}`,
  );
  assert(slotsBefore.every((s) => !s.isBooked), "До броней все слоты свободны");

  // 3. Бронирование слота.
  const court = store.courtsByVenueAndSport(venue.id, "padel")[0];
  const start = slotKey(date, 18);
  const r1 = store.book(court.id, start, 1001, "Алиса");
  assert(r1.ok, "Первая бронь слота 18:00 проходит");

  // 4. Двойное бронирование того же слота должно быть отклонено.
  const r2 = store.book(court.id, start, 2002, "Боб");
  assert(!r2.ok, "Повторная бронь того же слота отклонена (защита от двойного бронирования)");

  // 5. Слот теперь помечен занятым.
  const slotsAfter = store.slotsForDay(venue.id, "padel", date);
  const booked = slotsAfter.find((s) => s.court.id === court.id && s.start_iso === start);
  assert(!!booked?.isBooked, "Слот 18:00 отмечен как занятый");

  // 6. Соседний час свободен.
  const next = slotsAfter.find((s) => s.court.id === court.id && s.start_iso === slotKey(date, 19));
  assert(!!next && !next.isBooked, "Слот 19:00 остаётся свободным");

  // 7. Мои брони и отмена.
  const mine = store.userBookings(1001, `${date}T00`);
  assert(mine.length === 1, "У Алисы 1 будущая бронь");

  const cancelledOther = store.cancel(mine[0].id, 9999);
  assert(!cancelledOther, "Чужой пользователь не может отменить бронь");

  const cancelled = store.cancel(mine[0].id, 1001);
  assert(cancelled, "Владелец отменяет свою бронь");

  // 8. После отмены слот снова свободен и доступен для брони.
  const r3 = store.book(court.id, start, 2002, "Боб");
  assert(r3.ok, "После отмены слот снова можно забронировать");

  store.close();
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log("\n🎉 Все проверки пройдены.");
}

main();

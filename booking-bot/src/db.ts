// Слой доступа к данным поверх SQLite. Полностью независим от Telegram,
// поэтому всю логику бронирования можно тестировать отдельно (см. smoke.ts).

import Database from "better-sqlite3";
import path from "node:path";
import {
  Booking,
  Court,
  Slot,
  Sport,
  SLOT_HOURS,
  Venue,
  parseSlotKey,
  slotKey,
} from "./domain";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data.db");

export class BookingStore {
  private db: Database.Database;

  constructor(filename: string = DB_PATH) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS venues (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        name    TEXT NOT NULL,
        city    TEXT NOT NULL,
        address TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS courts (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        venue_id       INTEGER NOT NULL REFERENCES venues(id),
        sport          TEXT NOT NULL,
        name           TEXT NOT NULL,
        surface        TEXT NOT NULL,
        price_per_hour INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        court_id   INTEGER NOT NULL REFERENCES courts(id),
        user_id    INTEGER NOT NULL,
        user_name  TEXT NOT NULL,
        start_iso  TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        -- Ключевая защита: один и тот же слот нельзя забронировать дважды.
        UNIQUE (court_id, start_iso)
      );

      CREATE INDEX IF NOT EXISTS idx_courts_sport ON courts(sport);
      CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
    `);
  }

  // --- Площадки и корты ---------------------------------------------------

  insertVenue(v: Omit<Venue, "id">): number {
    const r = this.db
      .prepare("INSERT INTO venues (name, city, address) VALUES (?, ?, ?)")
      .run(v.name, v.city, v.address);
    return Number(r.lastInsertRowid);
  }

  insertCourt(c: Omit<Court, "id">): number {
    const r = this.db
      .prepare(
        `INSERT INTO courts (venue_id, sport, name, surface, price_per_hour)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(c.venue_id, c.sport, c.name, c.surface, c.price_per_hour);
    return Number(r.lastInsertRowid);
  }

  countVenues(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM venues").get() as { n: number }).n;
  }

  getVenue(id: number): Venue | undefined {
    return this.db.prepare("SELECT * FROM venues WHERE id = ?").get(id) as Venue | undefined;
  }

  getCourt(id: number): Court | undefined {
    return this.db.prepare("SELECT * FROM courts WHERE id = ?").get(id) as Court | undefined;
  }

  // Площадки, у которых есть хотя бы один корт для выбранного вида спорта.
  venuesBySport(sport: Sport): Venue[] {
    return this.db
      .prepare(
        `SELECT DISTINCT v.* FROM venues v
         JOIN courts c ON c.venue_id = v.id
         WHERE c.sport = ?
         ORDER BY v.name`,
      )
      .all(sport) as Venue[];
  }

  courtsByVenueAndSport(venueId: number, sport: Sport): Court[] {
    return this.db
      .prepare(
        `SELECT * FROM courts WHERE venue_id = ? AND sport = ? ORDER BY name`,
      )
      .all(venueId, sport) as Court[];
  }

  // --- Слоты и бронирования ----------------------------------------------

  // Все слоты на день для площадки+спорта с отметкой занятости.
  slotsForDay(venueId: number, sport: Sport, date: string): Slot[] {
    const courts = this.courtsByVenueAndSport(venueId, sport);
    const booked = new Set(
      (
        this.db
          .prepare(
            `SELECT b.court_id, b.start_iso FROM bookings b
             JOIN courts c ON c.id = b.court_id
             WHERE c.venue_id = ? AND c.sport = ? AND b.start_iso LIKE ?`,
          )
          .all(venueId, sport, `${date}T%`) as { court_id: number; start_iso: string }[]
      ).map((r) => `${r.court_id}|${r.start_iso}`),
    );

    const slots: Slot[] = [];
    for (const court of courts) {
      for (const hour of SLOT_HOURS) {
        const start = slotKey(date, hour);
        slots.push({
          court,
          start_iso: start,
          hour,
          isBooked: booked.has(`${court.id}|${start}`),
        });
      }
    }
    return slots;
  }

  // Создание брони. Возвращает {ok:true, booking} либо {ok:false} если слот
  // уже занят — гонку перехватывает UNIQUE-констрейнт, а не проверка в коде.
  book(
    courtId: number,
    startIso: string,
    userId: number,
    userName: string,
  ): { ok: true; booking: Booking } | { ok: false; reason: "taken" } {
    try {
      const r = this.db
        .prepare(
          `INSERT INTO bookings (court_id, user_id, user_name, start_iso)
           VALUES (?, ?, ?, ?)`,
        )
        .run(courtId, userId, userName, startIso);
      const booking = this.db
        .prepare("SELECT * FROM bookings WHERE id = ?")
        .get(Number(r.lastInsertRowid)) as Booking;
      return { ok: true, booking };
    } catch (e: any) {
      if (String(e?.code).includes("SQLITE_CONSTRAINT")) {
        return { ok: false, reason: "taken" };
      }
      throw e;
    }
  }

  // Будущие брони пользователя (по дате слота), от ближайшей к дальней.
  userBookings(userId: number, fromIso: string): (Booking & {
    court: Court;
    venue: Venue;
  })[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM bookings
         WHERE user_id = ? AND start_iso >= ?
         ORDER BY start_iso`,
      )
      .all(userId, fromIso) as Booking[];
    return rows.map((b) => {
      const court = this.getCourt(b.court_id)!;
      const venue = this.getVenue(court.venue_id)!;
      return { ...b, court, venue };
    });
  }

  // Отмена брони — только своей (защита от отмены чужих по чужому id).
  cancel(bookingId: number, userId: number): boolean {
    const r = this.db
      .prepare("DELETE FROM bookings WHERE id = ? AND user_id = ?")
      .run(bookingId, userId);
    return r.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export { slotKey, parseSlotKey };

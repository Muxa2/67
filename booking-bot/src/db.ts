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
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        name     TEXT NOT NULL,
        city     TEXT NOT NULL,
        address  TEXT NOT NULL,
        owner_id INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS courts (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        venue_id       INTEGER NOT NULL REFERENCES venues(id),
        sport          TEXT NOT NULL,
        name           TEXT NOT NULL,
        surface        TEXT NOT NULL,
        price_per_hour INTEGER NOT NULL
      );

      -- Один стол занятости слотов: и брони игроков (kind='booking'),
      -- и блокировки владельца (kind='block'). UNIQUE(court_id,start_iso)
      -- разом гарантирует, что слот нельзя ни забронировать дважды,
      -- ни заблокировать уже забронированный (и наоборот).
      CREATE TABLE IF NOT EXISTS bookings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        court_id   INTEGER NOT NULL REFERENCES courts(id),
        user_id    INTEGER NOT NULL,
        user_name  TEXT NOT NULL,
        start_iso  TEXT NOT NULL,
        kind       TEXT NOT NULL DEFAULT 'booking',
        reason     TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (court_id, start_iso)
      );

      CREATE INDEX IF NOT EXISTS idx_courts_sport ON courts(sport);
      CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
      CREATE INDEX IF NOT EXISTS idx_venues_owner ON venues(owner_id);
    `);

    // Мягкие миграции для баз, созданных предыдущей версией схемы.
    this.addColumnIfMissing("venues", "owner_id", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("bookings", "kind", "TEXT NOT NULL DEFAULT 'booking'");
    this.addColumnIfMissing("bookings", "reason", "TEXT");
  }

  private addColumnIfMissing(table: string, column: string, ddl: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }

  // --- Площадки и корты ---------------------------------------------------

  insertVenue(v: Omit<Venue, "id">): number {
    const r = this.db
      .prepare("INSERT INTO venues (name, city, address, owner_id) VALUES (?, ?, ?, ?)")
      .run(v.name, v.city, v.address, v.owner_id);
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

  // Все слоты на день для площадки+спорта с отметками брони и блокировки.
  slotsForDay(venueId: number, sport: Sport, date: string): Slot[] {
    const courts = this.courtsByVenueAndSport(venueId, sport);
    const rows = this.db
      .prepare(
        `SELECT b.court_id, b.start_iso, b.kind FROM bookings b
         JOIN courts c ON c.id = b.court_id
         WHERE c.venue_id = ? AND c.sport = ? AND b.start_iso LIKE ?`,
      )
      .all(venueId, sport, `${date}T%`) as {
      court_id: number;
      start_iso: string;
      kind: string;
    }[];
    const occupancy = new Map<string, string>();
    for (const r of rows) occupancy.set(`${r.court_id}|${r.start_iso}`, r.kind);

    const slots: Slot[] = [];
    for (const court of courts) {
      for (const hour of SLOT_HOURS) {
        const start = slotKey(date, hour);
        const kind = occupancy.get(`${court.id}|${start}`);
        slots.push({
          court,
          start_iso: start,
          hour,
          isBooked: kind === "booking",
          isBlocked: kind === "block",
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
          `INSERT INTO bookings (court_id, user_id, user_name, start_iso, kind)
           VALUES (?, ?, ?, ?, 'booking')`,
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

  // Будущие брони пользователя (только реальные брони, не блокировки).
  userBookings(userId: number, fromIso: string): (Booking & {
    court: Court;
    venue: Venue;
  })[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM bookings
         WHERE user_id = ? AND kind = 'booking' AND start_iso >= ?
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
      .prepare("DELETE FROM bookings WHERE id = ? AND user_id = ? AND kind = 'booking'")
      .run(bookingId, userId);
    return r.changes > 0;
  }

  // --- Сторона владельца --------------------------------------------------

  venuesByOwner(ownerId: number): Venue[] {
    return this.db
      .prepare("SELECT * FROM venues WHERE owner_id = ? ORDER BY name")
      .all(ownerId) as Venue[];
  }

  ownsVenue(venueId: number, ownerId: number): boolean {
    const v = this.getVenue(venueId);
    return !!v && v.owner_id === ownerId;
  }

  // Корт принадлежит владельцу, если принадлежит его площадке.
  ownerCourt(courtId: number, ownerId: number): Court | undefined {
    const court = this.getCourt(courtId);
    if (!court) return undefined;
    return this.ownsVenue(court.venue_id, ownerId) ? court : undefined;
  }

  courtsByVenue(venueId: number): Court[] {
    return this.db
      .prepare("SELECT * FROM courts WHERE venue_id = ? ORDER BY sport, name")
      .all(venueId) as Court[];
  }

  countCourtsBySport(venueId: number, sport: Sport): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM courts WHERE venue_id = ? AND sport = ?")
        .get(venueId, sport) as { n: number }
    ).n;
  }

  updateCourtPrice(courtId: number, price: number): void {
    this.db.prepare("UPDATE courts SET price_per_hour = ? WHERE id = ?").run(price, courtId);
  }

  updateCourtName(courtId: number, name: string): void {
    this.db.prepare("UPDATE courts SET name = ? WHERE id = ?").run(name, courtId);
  }

  // Копия корта с тем же спортом/покрытием/ценой и автоинкрементом в имени.
  duplicateCourt(courtId: number, newName: string): number {
    const c = this.getCourt(courtId)!;
    return this.insertCourt({
      venue_id: c.venue_id,
      sport: c.sport,
      name: newName,
      surface: c.surface,
      price_per_hour: c.price_per_hour,
    });
  }

  // Удаление корта вместе с его бронями и блокировками (одной транзакцией).
  deleteCourt(courtId: number): void {
    const tx = this.db.transaction((id: number) => {
      this.db.prepare("DELETE FROM bookings WHERE court_id = ?").run(id);
      this.db.prepare("DELETE FROM courts WHERE id = ?").run(id);
    });
    tx(courtId);
  }

  // Блокировка слота владельцем (техработы/турнир). Падает, если слот занят.
  block(
    courtId: number,
    startIso: string,
    ownerId: number,
    reason: string,
  ): { ok: true } | { ok: false; reason: "taken" } {
    try {
      this.db
        .prepare(
          `INSERT INTO bookings (court_id, user_id, user_name, start_iso, kind, reason)
           VALUES (?, ?, 'Владелец', ?, 'block', ?)`,
        )
        .run(courtId, ownerId, startIso, reason);
      return { ok: true };
    } catch (e: any) {
      if (String(e?.code).includes("SQLITE_CONSTRAINT")) {
        return { ok: false, reason: "taken" };
      }
      throw e;
    }
  }

  unblock(courtId: number, startIso: string): boolean {
    const r = this.db
      .prepare("DELETE FROM bookings WHERE court_id = ? AND start_iso = ? AND kind = 'block'")
      .run(courtId, startIso);
    return r.changes > 0;
  }

  // Будущие брони игроков по всей площадке — для дашборда владельца.
  venueBookings(venueId: number, fromIso: string): (Booking & { court: Court })[] {
    const rows = this.db
      .prepare(
        `SELECT b.* FROM bookings b
         JOIN courts c ON c.id = b.court_id
         WHERE c.venue_id = ? AND b.kind = 'booking' AND b.start_iso >= ?
         ORDER BY b.start_iso`,
      )
      .all(venueId, fromIso) as Booking[];
    return rows.map((b) => ({ ...b, court: this.getCourt(b.court_id)! }));
  }

  close(): void {
    this.db.close();
  }
}

export { slotKey, parseSlotKey };

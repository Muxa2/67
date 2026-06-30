// Доменные типы и константы приложения для бронирования кортов.

export type Sport = "tennis" | "padel" | "football" | "volleyball";

export const SPORTS: Sport[] = ["tennis", "padel", "football", "volleyball"];

// Человекочитаемые подписи для интерфейса (с эмодзи для Telegram).
export const SPORT_LABELS: Record<Sport, string> = {
  tennis: "🎾 Большой теннис",
  padel: "🟦 Падел",
  football: "⚽ Футбол",
  volleyball: "🏐 Волейбол",
};

export function isSport(value: string): value is Sport {
  return (SPORTS as string[]).includes(value);
}

// Короткие подписи для автоназвания кортов в админке.
export const SPORT_SHORT: Record<Sport, string> = {
  tennis: "Корт",
  padel: "Падел-корт",
  football: "Поле",
  volleyball: "Зал",
};

// Дефолты для быстрого добавления корта в один тап: владельцу не нужно
// сразу заполнять покрытие и цену — они подставляются и правятся позже.
export const SPORT_DEFAULTS: Record<Sport, { surface: string; price: number }> = {
  tennis: { surface: "Хард", price: 2500 },
  padel: { surface: "Стекло/искусств.", price: 3000 },
  football: { surface: "Искусств. газон", price: 5000 },
  volleyball: { surface: "Паркет", price: 3200 },
};

// Часы работы площадок (одинаковые для прототипа): слоты по 1 часу с 8:00 до 22:00.
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 22; // последний слот начинается в 21:00
export const SLOT_HOURS: number[] = Array.from(
  { length: CLOSE_HOUR - OPEN_HOUR },
  (_, i) => OPEN_HOUR + i,
);

// На сколько дней вперёд можно бронировать.
export const BOOKING_HORIZON_DAYS = 7;

export interface Venue {
  id: number;
  name: string;
  city: string;
  address: string;
  owner_id: number; // Telegram-id владельца; 0 — демо-площадки из сида.
}

export interface Court {
  id: number;
  venue_id: number;
  sport: Sport;
  name: string;
  surface: string;
  price_per_hour: number;
}

export interface Booking {
  id: number;
  court_id: number;
  user_id: number;
  user_name: string;
  // start_iso — момент начала слота в формате YYYY-MM-DDTHH (локальное время площадки).
  start_iso: string;
  kind: "booking" | "block";
  reason: string | null;
  created_at: string;
}

// Слот = конкретный корт + конкретный час.
// Свободен, если не забронирован игроком и не заблокирован владельцем.
export interface Slot {
  court: Court;
  start_iso: string;
  hour: number;
  isBooked: boolean;
  isBlocked: boolean;
}

export function isSlotFree(s: Slot): boolean {
  return !s.isBooked && !s.isBlocked;
}

export function formatPrice(rub: number): string {
  return `${rub.toLocaleString("ru-RU")} ₽/час`;
}

// Ключ слота вида "2026-07-01T09" из даты (YYYY-MM-DD) и часа.
export function slotKey(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}`;
}

// Разбор ключа слота обратно в дату и час.
export function parseSlotKey(key: string): { date: string; hour: number } {
  const [date, hh] = key.split("T");
  return { date, hour: Number(hh) };
}

// Список доступных для брони дат (сегодня + горизонт), формат YYYY-MM-DD.
export function availableDates(today = new Date()): string[] {
  const dates: string[] = [];
  for (let i = 0; i < BOOKING_HORIZON_DAYS; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(toDateString(d));
  }
  return dates;
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

// Подпись даты для кнопки: "Сегодня", "Завтра" или "пн, 1 июл".
export function formatDateLabel(date: string, today = new Date()): string {
  const d = new Date(`${date}T00:00:00`);
  const todayStr = toDateString(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date === todayStr) return "Сегодня";
  if (date === toDateString(tomorrow)) return "Завтра";
  const months = [
    "янв", "фев", "мар", "апр", "май", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек",
  ];
  return `${WEEKDAYS_RU[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

// Наполнение базы тестовыми площадками и кортами. Сторону администратора
// в этом MVP не делаем, поэтому данные заводим скриптом.

import "dotenv/config";
import { BookingStore } from "./db";

export function seed(store: BookingStore, force = false): void {
  if (!force && store.countVenues() > 0) {
    console.log("База уже наполнена, пропускаю сид. Запусти с --force чтобы перезалить.");
    return;
  }

  const arena = store.insertVenue({
    name: "Спорт-Арена Центр",
    city: "Москва",
    address: "ул. Спортивная, 1",
  });
  const park = store.insertVenue({
    name: "Парк-Клуб Север",
    city: "Москва",
    address: "Северный бульвар, 14",
  });
  const river = store.insertVenue({
    name: "Ривер Падел",
    city: "Санкт-Петербург",
    address: "наб. Реки, 7",
  });

  // Спорт-Арена Центр: теннис + волейбол
  store.insertCourt({ venue_id: arena, sport: "tennis", name: "Корт №1 (хард)", surface: "Хард", price_per_hour: 2500 });
  store.insertCourt({ venue_id: arena, sport: "tennis", name: "Корт №2 (грунт)", surface: "Грунт", price_per_hour: 2800 });
  store.insertCourt({ venue_id: arena, sport: "volleyball", name: "Зал A", surface: "Паркет", price_per_hour: 3200 });

  // Парк-Клуб Север: футбол + падел
  store.insertCourt({ venue_id: park, sport: "football", name: "Поле 5x5 (крытое)", surface: "Искусств. газон", price_per_hour: 4500 });
  store.insertCourt({ venue_id: park, sport: "football", name: "Поле 7x7", surface: "Искусств. газон", price_per_hour: 6000 });
  store.insertCourt({ venue_id: park, sport: "padel", name: "Падел-корт 1", surface: "Стекло/искусств.", price_per_hour: 3000 });

  // Ривер Падел: падел + теннис
  store.insertCourt({ venue_id: river, sport: "padel", name: "Корт Panorama", surface: "Стекло/искусств.", price_per_hour: 3400 });
  store.insertCourt({ venue_id: river, sport: "padel", name: "Корт Classic", surface: "Стекло/искусств.", price_per_hour: 3100 });
  store.insertCourt({ venue_id: river, sport: "tennis", name: "Корт у воды", surface: "Хард", price_per_hour: 2600 });

  console.log("Готово: 3 площадки и 9 кортов добавлены.");
}

if (require.main === module) {
  const force = process.argv.includes("--force");
  const store = new BookingStore();
  seed(store, force);
  store.close();
}

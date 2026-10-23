# Antigravity Region Patch

PowerShell-скрипт для снятия локального регионального гейта в `language_server.exe` Antigravity (Windows x64).

## Что делает

Antigravity 2.25.0 перед показом «not available in your location» проверяет локальный boolean. Скрипт ищет x64-гейт:

```text
80 78 08 00 74 ?? 48 8B ?? 24 ?? 48 89 ?? 60
```

и заменяет первые 6 байт на:

```text
C6 40 08 01 90 90
```

Это `mov byte [rax+8],1; nop; nop` — проверка всегда проходит. Серверные проверки аккаунта, региона и квоты не затрагиваются. Скрипт не открывает платные функции и не обходит лимиты usage.

Протестировано на 2.25.0. Поиск идёт по сигнатуре, а не по фиксированному смещению; если Google изменит код, скрипт ничего не запишет и завершится с ошибкой.

## Требования

- Windows x64, PowerShell 5.1+
- Antigravity в стандартной пользовательской установке (или укажи `-Path`)
- Antigravity полностью закрыт

## Использование

Проверка без изменений:

```powershell
powershell -ExecutionPolicy Bypass -File .\patch.ps1 -DryRun
```

Патч:

```powershell
powershell -ExecutionPolicy Bypass -File .\patch.ps1
```

Оригинал сохраняется рядом как `language_server.exe.orig-backup`. Если приложение запущено, скрипт откажется работать. После патча запусти Antigravity.

Откат:

```powershell
powershell -ExecutionPolicy Bypass -File .\patch.ps1 -Restore
```

Другой путь:

```powershell
.\patch.ps1 -Path "D:\Antigravity\resources\bin\language_server.exe"
```

## Автообновление

Обновление Antigravity заменяет `language_server.exe` и стирает патч. Чтобы этого не было:

```powershell
powershell -ExecutionPolicy Bypass -File .\disable-autoupdate.ps1
```

Скрипт пишет `autoCheckForUpdates=false` в `%APPDATA%\Antigravity\app_storage.json`. Antigravity должен быть закрыт; настройка применится при следующем запуске. Вернуть:

```powershell
.\disable-autoupdate.ps1 -Enable
```

Учти: отключение автообновления останавливает и security-обновления.

## Риски

- Может нарушать Google ToS; аккаунт могут пометить.
- Серверная проверка доступности и квоты может всё равно блокировать запросы.
- Новая версия может изменить сигнатуру — скрипт безопасно откажется.
- Патч бинарника — всегда риск. Держи бэкап и делай `-Restore` перед удалением приложения.
- Без гарантий.

## Как это устроено

1. Читает `language_server.exe`.
2. Ищет ровно одно совпадение гейта (wildcard-байты не проверяются).
3. Создаёт `.orig-backup`.
4. Записывает 6 байт и проверяет результат.
5. При `-Restore` возвращает бэкап и печатает SHA256.

## Проверенные версии

| Версия | SHA256 оригинала | SHA256 после патча |
| --- | --- | --- |
| 2.25.0 | `4C90EB2318805FEF35B09CA6329A1CD04494CA15D2858331CED95F1B613D9481` | `CBA321C50EE59A3E379F33DADC434D6C49D54EAA381D776FE91B92A20F26B8FE` |

## Связь

Telegram: [@ultravibecoder](https://t.me/ultravibecoder)
